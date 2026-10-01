'use strict';

const PACKAGE_NAME = '@elastic/otel-react-native';
const WRAPPER_EXPORT = '__wrapPressHandler';
const SUPPORTED_COMPONENTS = new Set(['Button', 'Pressable']);

module.exports = function elasticOtelReactNativeBabelPlugin({ types: t }) {
  return {
    name: 'elastic-otel-react-native-interactions',
    visitor: {
      Program: {
        enter(path, state) {
          validateOptions(state.opts);
          state.elasticOtelProgram = path;
          state.elasticOtelWrapperId = null;
        },
        exit(path, state) {
          if (!state.elasticOtelWrapperId) {
            return;
          }

          const declaration = t.importDeclaration(
            [
              t.importSpecifier(
                t.cloneNode(state.elasticOtelWrapperId),
                t.identifier(WRAPPER_EXPORT),
              ),
            ],
            t.stringLiteral(PACKAGE_NAME),
          );
          path.unshiftContainer('body', declaration);
        },
      },
      JSXOpeningElement(path, state) {
        const component = supportedComponent(path);
        if (!component) {
          return;
        }

        const handlerAttribute = singleAttribute(path, 'onPress');
        const idAttribute = staticAttributeAfterLastSpread(path, 'testID');
        if (!handlerAttribute || !idAttribute) {
          return;
        }

        const handler = handlerExpression(handlerAttribute);
        const widgetId = staticNonblankString(idAttribute);
        if (!handler || !widgetId || alreadyWrapped(handler, path)) {
          return;
        }

        let widgetName = null;
        if (
          hasOwnOption(state.opts, 'includeAccessibilityLabel') &&
          state.opts.includeAccessibilityLabel === true
        ) {
          const nameAttribute = staticAttributeAfterLastSpread(
            path,
            'accessibilityLabel',
          );
          widgetName = nameAttribute
            ? staticNonblankString(nameAttribute)
            : null;
        }

        if (!state.elasticOtelWrapperId) {
          state.elasticOtelWrapperId =
            state.elasticOtelProgram.scope.generateUidIdentifier(
              'elasticOtelWrapPressHandler',
            );
        }

        handlerAttribute
          .get('value')
          .replaceWith(
            t.jsxExpressionContainer(
              t.callExpression(t.cloneNode(state.elasticOtelWrapperId), [
                t.cloneNode(handler),
                t.stringLiteral(widgetId),
                widgetName ? t.stringLiteral(widgetName) : t.nullLiteral(),
              ]),
            ),
          );
      },
    },
  };
};

function validateOptions(options) {
  const keys = Object.keys(options || {});
  if (
    keys.some((key) => key !== 'includeAccessibilityLabel') ||
    (hasOwnOption(options, 'includeAccessibilityLabel') &&
      typeof options.includeAccessibilityLabel !== 'boolean')
  ) {
    throw new TypeError(
      'The Babel plugin accepts only a boolean includeAccessibilityLabel option.',
    );
  }
}

function hasOwnOption(options, name) {
  return Object.prototype.hasOwnProperty.call(options || {}, name);
}

function supportedComponent(path) {
  const name = path.node.name;
  if (name.type !== 'JSXIdentifier') {
    return null;
  }

  const binding = path.scope.getBinding(name.name);
  if (
    !binding ||
    !binding.path.isImportSpecifier() ||
    binding.path.parentPath.node.source.value !== 'react-native'
  ) {
    return null;
  }

  const imported = binding.path.node.imported;
  const importedName =
    imported.type === 'Identifier' ? imported.name : imported.value;
  return SUPPORTED_COMPONENTS.has(importedName) ? importedName : null;
}

function singleAttribute(path, name) {
  const matches = path
    .get('attributes')
    .filter(
      (attribute) =>
        attribute.isJSXAttribute() &&
        attribute.node.name.type === 'JSXIdentifier' &&
        attribute.node.name.name === name,
    );
  return matches.length === 1 ? matches[0] : null;
}

function staticAttributeAfterLastSpread(path, name) {
  const attribute = singleAttribute(path, name);
  if (!attribute) {
    return null;
  }

  const attributes = path.get('attributes');
  const attributeIndex = attributes.indexOf(attribute);
  return attributes
    .slice(attributeIndex + 1)
    .some((candidate) => candidate.isJSXSpreadAttribute())
    ? null
    : attribute;
}

function handlerExpression(attribute) {
  const value = attribute.node.value;
  if (!value || value.type !== 'JSXExpressionContainer') {
    return null;
  }

  const expression = value.expression;
  return expression.type === 'ArrowFunctionExpression' ||
    expression.type === 'Identifier' ||
    expression.type === 'MemberExpression'
    ? expression
    : null;
}

function staticNonblankString(attribute) {
  const value = attribute.node.value;
  let text = null;
  if (value?.type === 'StringLiteral') {
    text = value.value;
  } else if (
    value?.type === 'JSXExpressionContainer' &&
    value.expression.type === 'StringLiteral'
  ) {
    text = value.expression.value;
  }
  return text && text.trim() ? text : null;
}

function alreadyWrapped(expression, path) {
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
      binding.path.node.imported.type === 'Identifier' &&
      binding.path.node.imported.name === WRAPPER_EXPORT &&
      binding.path.parentPath.node.source.value === PACKAGE_NAME,
  );
}
