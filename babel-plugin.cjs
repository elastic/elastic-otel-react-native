'use strict';

const { relative } = require('node:path');

const PACKAGE_NAME = '@elastic/otel-react-native';
const WRAPPER_EXPORT = '__wrapPressHandler';
const CONTENT_EXPORT = '__widgetContent';
const REPORT_PREFIX = '[elastic-otel-react-native]';
const CONTENT_MACRO = '@content';
const COMPONENT_MACRO = '@component';
const MACROS = [CONTENT_MACRO, COMPONENT_MACRO];

// The instrumentation vocabulary the plugin owns, with each one's defaults.
const INSTRUMENTATIONS = {
  click: { handlers: ['onPress'] },
};

const DEFAULT_WIDGET_ID = [
  'widget-id',
  'testID',
  'accessibilityLabel',
  COMPONENT_MACRO,
];
const DEFAULT_WIDGET_NAME = [CONTENT_MACRO];

const BUILT_IN_COMPONENTS = [
  {
    name: 'Button',
    from: 'react-native',
    widgetName: ['title'],
    instrumentations: { click: { handlers: ['onPress'] } },
  },
  ...[
    'Pressable',
    'TouchableOpacity',
    'TouchableHighlight',
    'TouchableWithoutFeedback',
    'TouchableNativeFeedback',
  ].map((name) => ({
    name,
    from: 'react-native',
    instrumentations: { click: { handlers: ['onPress'] } },
  })),
];

const PLUGIN_KEYS = ['debug', 'interactions'];
const INTERACTIONS_KEYS = ['enabled', 'widgetId', 'widgetName', 'components'];
const COMPONENT_KEYS = [
  'name',
  'from',
  'enabled',
  'widgetId',
  'widgetName',
  'instrumentations',
];
const CLICK_KEYS = ['handlers'];

const processedElements = new WeakSet();

module.exports = function elasticOtelReactNativeBabelPlugin({ types: t }) {
  return {
    name: 'elastic-otel-react-native-interactions',
    visitor: {
      Program: {
        enter(path, state) {
          state.elasticOtel = {
            config: normalizeOptions(state.opts),
            program: path,
            imports: new Map(),
          };
        },
        exit(path, state) {
          const { imports } = state.elasticOtel;
          if (imports.size === 0) {
            return;
          }

          path.unshiftContainer(
            'body',
            t.importDeclaration(
              [...imports].map(([exportName, local]) =>
                t.importSpecifier(t.cloneNode(local), t.identifier(exportName)),
              ),
              t.stringLiteral(PACKAGE_NAME),
            ),
          );
        },
      },
      JSXOpeningElement(path, state) {
        const { config } = state.elasticOtel;
        if (!config.enabled || processedElements.has(path.node)) {
          return;
        }
        processedElements.add(path.node);

        const nameNode = path.node.name;
        if (nameNode.type === 'JSXMemberExpression') {
          if (config.trackedNames.has(nameNode.property.name)) {
            report(
              state,
              path,
              `${jsxName(nameNode)} skipped: namespace members are not matched`,
            );
          }
          return;
        }

        const component = resolveComponent(path);
        const entry = component && findEntry(config.entries, component);
        if (entry && !insideDeclarationOf(path, config.declarationNames)) {
          instrument(t, state, path, component.name, entry);
        }
      },
    },
  };
};

function instrument(t, state, path, componentName, entry) {
  const attributes = path.get('attributes');

  // A spread after a handler or a widget id prop, such as widget-id or
  // testID, can override its value.
  const guardedNames = [
    ...entry.click.handlers,
    ...entry.widgetId.filter((source) => !MACROS.includes(source)),
  ];
  const lastSpread = attributes.findLastIndex((attribute) =>
    attribute.isJSXSpreadAttribute(),
  );
  const overridden = attributes
    .slice(0, Math.max(lastSpread, 0))
    .find((attribute) => guardedNames.includes(attributeName(attribute)));
  if (overridden) {
    report(
      state,
      path,
      `${componentName} skipped: a spread attribute follows ${attributeName(overridden)}`,
    );
    return;
  }

  const handlers = attributes
    .filter((attribute) =>
      entry.click.handlers.includes(attributeName(attribute)),
    )
    .map((attribute) => attribute.get('value'))
    .filter(
      (value) =>
        value.isJSXExpressionContainer() &&
        !value.get('expression').isJSXEmptyExpression() &&
        !alreadyWrapped(path, value.node.expression),
    );
  if (handlers.length === 0) {
    return;
  }

  // The expressions the wrapper evaluates when the element renders, in source
  // order: prop values as written, the visible text, or the component name.
  // A prop value is copied only when it is side-effect-free, so the element
  // and the wrapper read the same value from one render, and only when no
  // spread follows it, so the spread cannot replace the value.
  const reportedSources = new Set();
  const notRead = (source, reason) => {
    if (!reportedSources.has(source)) {
      reportedSources.add(source);
      report(
        state,
        path,
        `${componentName} source ${source} ${reason}; not read`,
      );
    }
    return [];
  };
  const candidates = (sources) =>
    sources.flatMap((source) => {
      if (source === COMPONENT_MACRO) {
        return [t.stringLiteral(componentName)];
      }
      if (source === CONTENT_MACRO) {
        const parts = contentParts(t, path.parent.children);
        return parts.length === 0
          ? []
          : [t.callExpression(importedName(t, state, CONTENT_EXPORT), parts)];
      }
      const index = attributes.findLastIndex(
        (candidate) => attributeName(candidate) === source,
      );
      const value = index !== -1 && propValue(attributes[index].node.value);
      if (!value) {
        return [];
      }
      if (index < lastSpread) {
        return notRead(source, 'is followed by a spread attribute');
      }
      const form = impureForm(value);
      if (form) {
        return notRead(source, `is ${article(form)} ${form}`);
      }
      return [t.cloneNode(value, true)];
    });
  const widgetId = candidates(entry.widgetId);
  const widgetName = candidates(entry.widgetName);

  for (const value of handlers) {
    value.replaceWith(
      t.jsxExpressionContainer(
        t.callExpression(importedName(t, state, WRAPPER_EXPORT), [
          value.node.expression,
          t.stringLiteral(componentName),
          t.arrayExpression(widgetId.map((node) => t.cloneNode(node, true))),
          t.arrayExpression(widgetName.map((node) => t.cloneNode(node, true))),
        ]),
      ),
    );
  }
}

// A handler that a previous transform already wrapped calls the wrapper through
// its import binding.
function alreadyWrapped(path, expression) {
  if (
    expression.type !== 'CallExpression' ||
    expression.callee.type !== 'Identifier'
  ) {
    return false;
  }

  const binding = path.scope.getBinding(expression.callee.name);
  return Boolean(
    binding &&
      binding.path.isImportSpecifier() &&
      exportedName(binding.path.node) === WRAPPER_EXPORT &&
      binding.path.parent.source.value === PACKAGE_NAME,
  );
}

function importedName(t, state, exportName) {
  const { imports, program } = state.elasticOtel;
  if (!imports.has(exportName)) {
    imports.set(
      exportName,
      program.scope.generateUidIdentifier(
        exportName === WRAPPER_EXPORT
          ? 'elasticOtelWrapPressHandler'
          : 'elasticOtelWidgetContent',
      ),
    );
  }
  return t.cloneNode(imports.get(exportName));
}

// Components match by exported name through the file's import binding; default
// imports and components defined in the same file match by JSX name.
// Namespace members and `require` bindings do not match.
function resolveComponent(path) {
  const name = path.node.name;
  if (name.type !== 'JSXIdentifier') {
    return null;
  }

  const declaration = path.scope.getBinding(name.name)?.path;
  if (!declaration) {
    return null;
  }
  if (declaration.isImportSpecifier()) {
    return {
      name: exportedName(declaration.node),
      from: declaration.parent.source.value,
    };
  }
  if (declaration.isImportDefaultSpecifier()) {
    return { name: name.name, from: declaration.parent.source.value };
  }
  if (
    declaration.isFunctionDeclaration() ||
    declaration.isClassDeclaration() ||
    (declaration.isVariableDeclarator() &&
      declaration.node.id.type === 'Identifier' &&
      !isRequire(declaration.node.init))
  ) {
    return { name: name.name, from: null };
  }
  return null;
}

function isRequire(node) {
  let current = node;
  while (current?.type === 'MemberExpression') {
    current = current.object;
  }
  return (
    current?.type === 'CallExpression' &&
    current.callee.type === 'Identifier' &&
    current.callee.name === 'require'
  );
}

// An entry whose `from` equals the element's import source wins over an entry
// without `from`.
function findEntry(entries, component) {
  const match =
    entries.find(
      (entry) =>
        entry.name === component.name &&
        entry.from !== null &&
        entry.from === component.from,
    ) ??
    entries.find(
      (entry) => entry.name === component.name && entry.from === null,
    );
  return match?.enabled && match.click ? match : null;
}

// A listed component forwards its handler to the elements it renders, which
// would otherwise emit a second event for the same tap.
function insideDeclarationOf(path, names) {
  return Boolean(
    path.findParent(
      (ancestor) =>
        ((ancestor.isFunctionDeclaration() || ancestor.isClassDeclaration()) &&
          ancestor.node.id &&
          names.has(ancestor.node.id.name)) ||
        (ancestor.isVariableDeclarator() &&
          ancestor.node.id.type === 'Identifier' &&
          names.has(ancestor.node.id.name)),
    ),
  );
}

// The text pieces inside an element, at any depth of its JSX children. Only
// side-effect-free expressions are copied, so nothing runs twice per render.
function contentParts(t, children) {
  return children.flatMap((child) => {
    switch (child.type) {
      case 'JSXText': {
        const text = child.value.replace(/\s+/g, ' ').trim();
        return text ? [t.stringLiteral(text)] : [];
      }
      case 'JSXExpressionContainer':
        return child.expression.type === 'JSXEmptyExpression' ||
          impureForm(child.expression)
          ? []
          : [t.cloneNode(child.expression, true)];
      case 'JSXElement':
      case 'JSXFragment':
        return contentParts(t, child.children);
      default:
        return [];
    }
  });
}

// The purity rule for every expression the plugin copies: it returns null for
// a side-effect-free expression, or the form of the first part that is not.
// Literals, template literals, identifiers, member reads with literal computed
// keys, and conditional, logical, unary, and binary expressions of such parts
// are side-effect-free; type-only wrappers are transparent.
function impureForm(node) {
  switch (node.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
    case 'NullLiteral':
    case 'BigIntLiteral':
    case 'Identifier':
    case 'ThisExpression':
      return null;
    case 'TemplateLiteral':
      return firstImpure(node.expressions);
    case 'MemberExpression':
    case 'OptionalMemberExpression':
      if (
        node.computed &&
        !['StringLiteral', 'NumericLiteral'].includes(node.property.type)
      ) {
        return 'computed member expression';
      }
      return impureForm(node.object);
    case 'ConditionalExpression':
      return firstImpure([node.test, node.consequent, node.alternate]);
    case 'LogicalExpression':
    case 'BinaryExpression':
      return firstImpure([node.left, node.right]);
    case 'UnaryExpression':
      return node.operator === 'delete'
        ? 'delete expression'
        : impureForm(node.argument);
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    case 'TypeCastExpression':
      return impureForm(node.expression);
    default:
      return formName(node.type);
  }
}

function firstImpure(nodes) {
  for (const node of nodes) {
    const form = impureForm(node);
    if (form) {
      return form;
    }
  }
  return null;
}

// `CallExpression` becomes "call expression", `JSXElement` "JSX element".
function formName(type) {
  return type
    .replace(/^JSX/, 'JSX ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^jsx /, 'JSX ');
}

function article(word) {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function propValue(value) {
  if (value?.type === 'StringLiteral') {
    return value;
  }
  if (
    value?.type === 'JSXExpressionContainer' &&
    value.expression.type !== 'JSXEmptyExpression'
  ) {
    return value.expression;
  }
  return null;
}

function attributeName(attribute) {
  return attribute.isJSXAttribute() &&
    attribute.node.name.type === 'JSXIdentifier'
    ? attribute.node.name.name
    : null;
}

function exportedName(specifier) {
  return specifier.imported.type === 'Identifier'
    ? specifier.imported.name
    : specifier.imported.value;
}

function jsxName(node) {
  return node.type === 'JSXMemberExpression'
    ? `${jsxName(node.object)}.${node.property.name}`
    : node.name;
}

function report(state, path, message) {
  if (!state.elasticOtel.config.debug) {
    return;
  }

  const file = state.filename
    ? relative(state.cwd || process.cwd(), state.filename)
    : '<unknown>';
  const line = path.node.loc?.start.line ?? '?';
  console.warn(`${REPORT_PREFIX} ${file}:${line} ${message}`);
}

// Options are validated once per options object. Every error is a TypeError
// that names the offending key.
const normalizedOptions = new WeakMap();

function normalizeOptions(options) {
  if (options !== null && typeof options === 'object') {
    if (!normalizedOptions.has(options)) {
      normalizedOptions.set(options, validateOptions(options));
    }
    return normalizedOptions.get(options);
  }
  return validateOptions(options);
}

function validateOptions(options) {
  const plugin = plainObject(options, 'The Babel plugin options');
  onlyKeys(plugin, PLUGIN_KEYS, '');
  const debug = optionalBoolean(plugin, 'debug', 'debug', false);

  const interactions = has(plugin, 'interactions')
    ? plainObject(plugin.interactions, 'interactions')
    : {};
  onlyKeys(interactions, INTERACTIONS_KEYS, 'interactions');
  const enabled = optionalBoolean(
    interactions,
    'enabled',
    'interactions.enabled',
    true,
  );
  const widgetId = has(interactions, 'widgetId')
    ? sourceList(interactions.widgetId, 'interactions.widgetId')
    : DEFAULT_WIDGET_ID;
  const widgetName = has(interactions, 'widgetName')
    ? sourceList(interactions.widgetName, 'interactions.widgetName')
    : DEFAULT_WIDGET_NAME;

  // An entry for a built-in replaces it entirely.
  const listed = has(interactions, 'components')
    ? componentList(interactions.components)
    : [];
  const builtIns = BUILT_IN_COMPONENTS.filter(
    (builtIn) =>
      !listed.some(
        (entry) => entry.name === builtIn.name && entry.from === builtIn.from,
      ),
  ).map((builtIn) => componentEntry(builtIn, `built-in ${builtIn.name}`));
  const entries = [...listed, ...builtIns].map((entry) => ({
    ...entry,
    widgetId: entry.widgetId ?? widgetId,
    widgetName: entry.widgetName ?? widgetName,
  }));
  const trackedNames = (list) =>
    new Set(
      list.filter((entry) => entry.enabled && entry.click).map((e) => e.name),
    );

  return {
    debug,
    enabled,
    entries,
    trackedNames: trackedNames(entries),
    // A component defined in the same file matches only entries without
    // `from`, so only those entries mark a declaration as a listed component.
    declarationNames: trackedNames(
      entries.filter((entry) => entry.from === null),
    ),
  };
}

function componentList(value) {
  const key = 'interactions.components';
  if (!Array.isArray(value)) {
    throw new TypeError(`${key} must be an array.`);
  }

  const entries = value.map((entry, index) =>
    componentEntry(entry, `${key}[${index}]`),
  );
  entries.forEach((entry, index) => {
    const first = entries.findIndex(
      (other) => other.name === entry.name && other.from === entry.from,
    );
    if (first !== index) {
      const from = entry.from === null ? 'no from' : `from "${entry.from}"`;
      throw new TypeError(
        `${key}[${index}] duplicates ${key}[${first}] (name "${entry.name}", ${from}).`,
      );
    }
  });
  return entries;
}

function componentEntry(value, key) {
  const entry = plainObject(value, key);
  onlyKeys(entry, COMPONENT_KEYS, key);
  if (!has(entry, 'name')) {
    throw new TypeError(`${key}.name is required.`);
  }
  const name = nonEmptyString(entry.name, `${key}.name`);
  const from = has(entry, 'from')
    ? nonEmptyString(entry.from, `${key}.from`)
    : null;
  const enabled = optionalBoolean(entry, 'enabled', `${key}.enabled`, true);

  const instrumentationsKey = `${key}.instrumentations`;
  const instrumentations = has(entry, 'instrumentations')
    ? plainObject(entry.instrumentations, instrumentationsKey)
    : {};
  for (const instrumentation of Object.keys(instrumentations)) {
    if (!has(INSTRUMENTATIONS, instrumentation)) {
      throw new TypeError(
        `Unknown instrumentation ${instrumentationsKey}.${instrumentation}; known instrumentations: ${Object.keys(
          INSTRUMENTATIONS,
        ).join(', ')}.`,
      );
    }
  }
  const click = has(instrumentations, 'click')
    ? clickInstrumentation(
        instrumentations.click,
        `${instrumentationsKey}.click`,
      )
    : null;
  if (!click && enabled) {
    throw new TypeError(
      `${key} must list an instrumentation in instrumentations or set enabled: false.`,
    );
  }

  return {
    name,
    from,
    enabled,
    widgetId: has(entry, 'widgetId')
      ? sourceList(entry.widgetId, `${key}.widgetId`)
      : null,
    widgetName: has(entry, 'widgetName')
      ? sourceList(entry.widgetName, `${key}.widgetName`)
      : null,
    click,
  };
}

function clickInstrumentation(value, key) {
  const click = plainObject(value, key);
  onlyKeys(click, CLICK_KEYS, key);
  if (!has(click, 'handlers')) {
    return { handlers: INSTRUMENTATIONS.click.handlers };
  }

  const handlersKey = `${key}.handlers`;
  if (!Array.isArray(click.handlers) || click.handlers.length === 0) {
    throw new TypeError(
      `${handlersKey} must be a non-empty array of prop names.`,
    );
  }
  return {
    handlers: click.handlers.map((handler, index) =>
      nonEmptyString(handler, `${handlersKey}[${index}]`),
    ),
  };
}

function sourceList(value, key) {
  if (!Array.isArray(value)) {
    throw new TypeError(
      `${key} must be an array of prop names and the macros ${MACROS.join(
        ', ',
      )}.`,
    );
  }

  return value.map((source, index) => {
    const sourceKey = `${key}[${index}]`;
    nonEmptyString(source, sourceKey);
    if (source.startsWith('@') && !MACROS.includes(source)) {
      throw new TypeError(
        `${sourceKey} is the unknown macro "${source}"; use ${MACROS.join(
          ' or ',
        )}.`,
      );
    }
    if (value.slice(0, index).includes(COMPONENT_MACRO)) {
      throw new TypeError(
        `${sourceKey} follows ${COMPONENT_MACRO}, which always has a value, so it is never used.`,
      );
    }
    return source;
  });
}

function plainObject(value, key) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${key} must be an object.`);
  }
  return value;
}

function onlyKeys(object, allowed, key) {
  for (const name of Object.keys(object)) {
    if (!allowed.includes(name)) {
      throw new TypeError(`Unknown option ${key ? `${key}.${name}` : name}.`);
    }
  }
}

function optionalBoolean(object, name, key, fallback) {
  if (!has(object, name)) {
    return fallback;
  }
  if (typeof object[name] !== 'boolean') {
    throw new TypeError(`${key} must be a boolean.`);
  }
  return object[name];
}

function nonEmptyString(value, key) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${key} must be a non-empty string.`);
  }
  return value;
}

function has(object, name) {
  return Object.prototype.hasOwnProperty.call(object, name);
}
