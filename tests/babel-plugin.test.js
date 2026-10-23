/*
 * Copyright Elastic Technologies Inc. and/or licensed to
 * Elastic Technologies Inc. under one or more contributor license
 * agreements. See the NOTICE file distributed with this work for
 * additional information regarding copyright ownership.
 * Elastic Technologies Inc. licenses this file to you under the Apache
 * License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const { transformSync } = require('@babel/core');
const plugin = require('../babel-plugin.cjs');

const BUILT_INS = [
  'Button',
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'TouchableNativeFeedback',
];

function transform(source, options) {
  return transformSync(source, {
    babelrc: false,
    configFile: false,
    filename: 'src/Screen.jsx',
    cwd: '/app',
    plugins: [options === undefined ? plugin : [plugin, options]],
    parserOpts: { plugins: ['jsx'] },
  }).code;
}

function wrapCalls(output) {
  return output.match(/_elasticOtelWrapPressHandler\(/g) ?? [];
}

function components(...entries) {
  return { interactions: { components: entries } };
}

const click = { click: {} };

afterEach(() => {
  jest.restoreAllMocks();
});

test('instruments the six built-ins and an aliased built-in with zero config', () => {
  const output = transform(`
    import { ${BUILT_INS.join(', ')}, Pressable as TapTarget } from 'react-native';
    <>
      ${BUILT_INS.map((name) => `<${name} onPress={tap} />`).join('\n')}
      <TapTarget onPress={tap} />
    </>;
  `);

  expect(wrapCalls(output)).toHaveLength(7);
  for (const name of BUILT_INS) {
    expect(output).toContain(
      `<${name} onPress={_elasticOtelWrapPressHandler(tap, "${name}", ["${name}"], [])} />`,
    );
  }
  expect(output).toContain(
    '<TapTarget onPress={_elasticOtelWrapPressHandler(tap, "Pressable", ["Pressable"], [])} />',
  );
  expect(output).toContain(
    'import { __wrapPressHandler as _elasticOtelWrapPressHandler } from "@elastic/otel-react-native";',
  );
});

test('emits identity candidates in order with @content parts and @component', () => {
  const output = transform(`
    import { Button, Pressable } from 'react-native';
    <>
      <Pressable widget-id={ids.save} testID="save" accessibilityLabel={label}
        onPress={save}>
        <Text>Save {count}</Text> items{' '}
        <Text>{\`now\`}</Text>
        {icon && <Icon />}
        <Icon />
        {/* comment */}
      </Pressable>
      <Button title={title} onPress={submit} />
    </>;
  `);

  expect(output).toContain(
    '_elasticOtelWrapPressHandler(save, "Pressable", [ids.save, "save", label, "Pressable"], [_elasticOtelWidgetContent("Save", count, "items", \' \', `now`)])',
  );
  expect(output).toContain(
    '_elasticOtelWrapPressHandler(submit, "Button", ["Button"], [title])',
  );
  expect(output).toContain('widget-id={ids.save}');
});

test('@content copies side-effect-free expressions at any depth', () => {
  const output = transform(`
    import { Pressable } from 'react-native';
    <Pressable onPress={save}>
      Order {'#'}{42} {count}
      <View>
        <Text>{order.items.length} {labels['total']} {this.props.unit}</Text>
        <Text>{\`\${count} items\`} {busy ? 'Saving' : 'Save'} {label || 'Save'}</Text>
        <Text>{-total} {count + 1} {user?.name}</Text>
      </View>
    </Pressable>;
  `);

  expect(output).toContain(
    "[_elasticOtelWidgetContent(\"Order\", '#', 42, count, order.items.length, labels['total'], this.props.unit, `${count} items`, busy ? 'Saving' : 'Save', label || 'Save', -total, count + 1, user?.name)]",
  );
});

test.each([
  ['a call', '{t("save")}'],
  ['a call inside a conditional', '{busy ? t("saving") : "Save"}'],
  ['an assignment', '{(label = "Save")}'],
  ['an update', '{count++}'],
  ['a new expression', '{new Label()}'],
  ['a JSX element in an expression container', '{<Text>Save</Text>}'],
  ['a computed member with a call key', '{labels[key()]}'],
])('@content ignores %s, so nothing runs twice per render', (_name, child) => {
  const output = transform(`
    import { Pressable } from 'react-native';
    <Pressable onPress={save}>${child}</Pressable>;
  `);

  expect(output).toContain(
    'onPress={_elasticOtelWrapPressHandler(save, "Pressable", ["Pressable"], [])}',
  );
  expect(output).not.toContain('_elasticOtelWidgetContent');
});

test('copies a side-effect-free identity prop and skips one with side effects', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const source = `
    import { Pressable } from 'react-native';
    <>
      <Pressable testID={\`row-\${index}\`} accessibilityLabel={nextLabel()}
        onPress={select}>Row</Pressable>
      <Pressable testID={nextId()} accessibilityLabel={ready ? label : 'Wait'}
        onPress={retry} />
    </>;
  `;

  const quiet = transform(source);
  expect(warn).not.toHaveBeenCalled();
  expect(quiet).toContain(
    '_elasticOtelWrapPressHandler(select, "Pressable", [`row-${index}`, "Pressable"], [_elasticOtelWidgetContent("Row")])',
  );
  expect(quiet).toContain(
    '_elasticOtelWrapPressHandler(retry, "Pressable", [ready ? label : \'Wait\', "Pressable"], [])',
  );
  // Each call stays on the element only, so it runs once per render.
  expect(quiet.match(/nextLabel\(\)/g)).toHaveLength(1);
  expect(quiet.match(/nextId\(\)/g)).toHaveLength(1);

  expect(transform(source, { debug: true })).toBe(quiet);
  expect(warn.mock.calls).toEqual([
    [
      '[elastic-otel-react-native] src/Screen.jsx:4 Pressable source accessibilityLabel is a call expression; not read',
    ],
    [
      '[elastic-otel-react-native] src/Screen.jsx:6 Pressable source testID is a call expression; not read',
    ],
  ]);
});

test('honors top-level and entry-level identity source lists', () => {
  const output = transform(
    `
      import { Pressable } from 'react-native';
      import { Button } from 'react-native-paper';
      <>
        <Pressable testID="pressable" accessibilityLabel="Label" onPress={a}>Text</Pressable>
        <Button label="Paper" testID="paper" onPress={b}>Text</Button>
      </>;
    `,
    {
      interactions: {
        widgetId: ['accessibilityLabel'],
        widgetName: ['@component'],
        components: [
          {
            name: 'Button',
            from: 'react-native-paper',
            widgetId: ['label', '@component'],
            widgetName: [],
            instrumentations: click,
          },
        ],
      },
    },
  );

  expect(output).toContain('(a, "Pressable", ["Label"], ["Pressable"])');
  expect(output).toContain('(b, "Button", ["Paper", "Button"], [])');
});

test('instruments a listed custom component with a custom handler', () => {
  const output = transform(
    `
      import { MyButton } from './MyButton';
      <MyButton testID="custom" myClick={go} onPress={other} />;
    `,
    components({
      name: 'MyButton',
      instrumentations: { click: { handlers: ['myClick', 'onTap'] } },
    }),
  );

  expect(output).toContain(
    'myClick={_elasticOtelWrapPressHandler(go, "MyButton", ["custom", "MyButton"], [])}',
  );
  expect(output).toContain('onPress={other}');
  expect(wrapCalls(output)).toHaveLength(1);
});

test('matches a third-party component through from, including an alias', () => {
  const output = transform(
    `
      import { Button } from 'react-native-paper';
      import { Button as PaperButton } from 'react-native-paper';
      import { Button as OtherButton } from 'other-library';
      <>
        <Button onPress={a} />
        <PaperButton onPress={b} />
        <OtherButton onPress={c} />
      </>;
    `,
    components({
      name: 'Button',
      from: 'react-native-paper',
      instrumentations: click,
    }),
  );

  expect(output).toContain('(a, "Button"');
  expect(output).toContain('(b, "Button"');
  expect(output).toContain('onPress={c}');
  expect(wrapCalls(output)).toHaveLength(2);
});

test('matches default imports and same-file components by JSX name only', () => {
  const output = transform(
    `
      import AppButton from './AppButton';
      const LocalButton = (props) => null;
      const { Required } = require('./Required');
      const Other = require('./Other').Other;
      <>
        <AppButton onPress={a} />
        <LocalButton onPress={b} />
        <Required onPress={c} />
        <Other onPress={d} />
      </>;
    `,
    components(
      { name: 'AppButton', instrumentations: click },
      { name: 'LocalButton', instrumentations: click },
      { name: 'Required', instrumentations: click },
      { name: 'Other', instrumentations: click },
    ),
  );

  expect(output).toContain('(a, "AppButton"');
  expect(output).toContain('(b, "LocalButton"');
  expect(output).toContain('onPress={c}');
  expect(output).toContain('onPress={d}');
  expect(wrapCalls(output)).toHaveLength(2);
});

test('an entry for a built-in replaces it entirely', () => {
  const output = transform(
    `
      import { Button } from 'react-native';
      <Button title="Save" testID="save" onLongPress={a} onPress={b} />;
    `,
    components({
      name: 'Button',
      from: 'react-native',
      instrumentations: { click: { handlers: ['onLongPress'] } },
    }),
  );

  expect(output).toContain(
    'onLongPress={_elasticOtelWrapPressHandler(a, "Button", ["save", "Button"], [])}',
  );
  expect(output).toContain('onPress={b}');
});

test('enabled: false on an entry or on interactions transforms nothing', () => {
  const source = `
    import { Pressable, Button } from 'react-native';
    <>
      <Pressable widget-id="kept" onPress={a} />
      <Button onPress={b} />
    </>;
  `;

  const entryOff = transform(
    source,
    components({ name: 'Pressable', from: 'react-native', enabled: false }),
  );
  expect(entryOff).toContain('<Pressable widget-id="kept" onPress={a} />');
  expect(wrapCalls(entryOff)).toHaveLength(1);

  const allOff = transform(source, {
    interactions: { enabled: false, components: [] },
  });
  expect(allOff).not.toContain('@elastic/otel-react-native');
  expect(allOff).toContain('widget-id="kept"');
});

test('instruments nothing inside a listed component declaration', () => {
  const output = transform(
    `
      import { Pressable } from 'react-native';
      export function DemoButton({ onPress, children }) {
        return <Pressable onPress={onPress}>{children}</Pressable>;
      }
      const Wrapped = memo((props) => <Pressable onPress={props.onPress} />);
      export default class ClassButton extends Component {
        render() {
          return <Pressable onPress={this.props.onPress} />;
        }
      }
      function Unlisted({ onPress }) {
        return <Pressable onPress={onPress} />;
      }
      <DemoButton testID="back" onPress={onBack}>Back</DemoButton>;
    `,
    components(
      { name: 'DemoButton', instrumentations: click },
      { name: 'Wrapped', instrumentations: click },
      { name: 'ClassButton', instrumentations: click },
    ),
  );

  expect(wrapCalls(output)).toHaveLength(2);
  expect(output).toContain(
    '_elasticOtelWrapPressHandler(onBack, "DemoButton", ["back", "DemoButton"], [_elasticOtelWidgetContent("Back")])',
  );
  expect(output).toContain(
    '_elasticOtelWrapPressHandler(onPress, "Pressable", ["Pressable"], [])',
  );
});

test('instruments inside a local declaration that only shares a name with an entry from a module', () => {
  const output = transform(
    `
      import { Button as PaperButton } from 'react-native-paper';
      export function Button({ onPress, ...rest }) {
        return <PaperButton {...rest} onPress={onPress} />;
      }
      <Button onPress={pay}>Pay</Button>;
    `,
    components({
      name: 'Button',
      from: 'react-native-paper',
      instrumentations: click,
    }),
  );

  expect(wrapCalls(output)).toHaveLength(1);
  expect(output).toContain(
    '<PaperButton {...rest} onPress={_elasticOtelWrapPressHandler(onPress, "Button", ["Button"], [])} />',
  );
});

test('wraps any handler expression exactly once', () => {
  const output = transform(`
    import { Pressable } from 'react-native';
    <>
      <Pressable onPress={makeHandler()} />
      <Pressable onPress={enabled && save} />
      <Pressable onPress={enabled ? save : undefined} />
      <Pressable onPress={handlers[\`\${name}\`]} />
      <Pressable onPress={function () {}} />
      <Pressable onPress="string" />
      <Pressable onPress />
    </>;
  `);

  for (const expression of [
    'makeHandler()',
    'enabled && save',
    'enabled ? save : undefined',
    'handlers[`${name}`]',
    'function () {}',
  ]) {
    expect(output).toContain(
      `onPress={_elasticOtelWrapPressHandler(${expression}, "Pressable", ["Pressable"], [])}`,
    );
  }
  expect(wrapCalls(output)).toHaveLength(5);
});

test('skips an element when a spread follows the id or handler, reporting under debug', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const source = `
    import { Pressable } from 'react-native';
    import * as Paper from 'react-native-paper';
    <>
      <Pressable testID="overridden" {...props} onPress={a} />
      <Pressable widget-id="w" onPress={b} {...props} />
      <Pressable {...props} testID="stable" onPress={c} />
      <Paper.Pressable onPress={d} />
      <Paper.Card onPress={e} />
      <View onPress={f} />
    </>;
  `;

  const quiet = transform(source);
  expect(warn).not.toHaveBeenCalled();
  expect(wrapCalls(quiet)).toHaveLength(1);
  expect(quiet).toContain('(c, "Pressable", ["stable", "Pressable"]');
  expect(quiet).toContain('<Pressable widget-id="w" onPress={b} {...props} />');

  const reported = transform(source, { debug: true });
  expect(reported).toBe(quiet);
  expect(warn.mock.calls).toEqual([
    [
      '[elastic-otel-react-native] src/Screen.jsx:5 Pressable skipped: a spread attribute follows testID',
    ],
    [
      '[elastic-otel-react-native] src/Screen.jsx:6 Pressable skipped: a spread attribute follows widget-id',
    ],
    [
      '[elastic-otel-react-native] src/Screen.jsx:8 Paper.Pressable skipped: namespace members are not matched',
    ],
  ]);
});

test('does not read a name prop that a spread follows, reporting under debug', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const source = `
    import { Button } from 'react-native';
    <>
      <Button title="Save" {...props} onPress={a} />
      <Button {...props} title="Send" onPress={b} />
    </>;
  `;

  const quiet = transform(source);
  expect(warn).not.toHaveBeenCalled();
  expect(quiet).toContain('(a, "Button", ["Button"], [])');
  expect(quiet).toContain('(b, "Button", ["Button"], ["Send"])');

  expect(transform(source, { debug: true })).toBe(quiet);
  expect(warn.mock.calls).toEqual([
    [
      '[elastic-otel-react-native] src/Screen.jsx:4 Button source title is followed by a spread attribute; not read',
    ],
  ]);
});

test('does not duplicate wrapping on a second transform', () => {
  const once = transform(`
    import { Pressable } from 'react-native';
    <Pressable testID="save" onPress={save}>Save</Pressable>;
  `);
  const twice = transform(once);

  expect(twice).toBe(once);
  expect(wrapCalls(twice)).toHaveLength(1);
});

test.each([
  [
    'the old accessibility option',
    { includeAccessibilityLabel: true },
    /Unknown option includeAccessibilityLabel\./,
  ],
  ['an unknown top-level key', { verbose: true }, /Unknown option verbose\./],
  [
    'interactions.instrumentations',
    { interactions: { instrumentations: {} } },
    /Unknown option interactions\.instrumentations\./,
  ],
  ['a non-boolean debug', { debug: 'yes' }, /debug must be a boolean/],
  [
    'a non-object interactions',
    { interactions: true },
    /interactions must be an object/,
  ],
  [
    'a non-boolean interactions.enabled',
    { interactions: { enabled: 1 } },
    /interactions\.enabled must be a boolean/,
  ],
  [
    'a non-array widgetId',
    { interactions: { widgetId: 'testID' } },
    /interactions\.widgetId must be an array/,
  ],
  [
    'an empty widgetName source',
    { interactions: { widgetName: [''] } },
    /interactions\.widgetName\[0\] must be a non-empty string/,
  ],
  [
    'an unknown macro',
    { interactions: { widgetName: ['@label'] } },
    /interactions\.widgetName\[0\] is the unknown macro "@label"/,
  ],
  [
    'a source after @component in widgetId',
    { interactions: { widgetId: ['@component', 'testID'] } },
    /interactions\.widgetId\[1\] follows @component/,
  ],
  [
    'a source after @component in an entry widgetName',
    components({
      name: 'A',
      widgetName: ['@component', '@content'],
      instrumentations: click,
    }),
    /interactions\.components\[0\]\.widgetName\[1\] follows @component/,
  ],
  [
    'a non-array components',
    { interactions: { components: {} } },
    /interactions\.components must be an array/,
  ],
  [
    'a non-object entry',
    components('Button'),
    /interactions\.components\[0\] must be an object/,
  ],
  [
    'an unknown entry key',
    components({ name: 'A', instrumentations: click, handlers: [] }),
    /Unknown option interactions\.components\[0\]\.handlers\./,
  ],
  [
    'a missing name',
    components({ instrumentations: click }),
    /interactions\.components\[0\]\.name is required/,
  ],
  [
    'a non-string from',
    components({ name: 'A', from: 3, instrumentations: click }),
    /interactions\.components\[0\]\.from must be a non-empty string/,
  ],
  [
    'a non-boolean entry enabled',
    components({ name: 'A', enabled: 'no' }),
    /interactions\.components\[0\]\.enabled must be a boolean/,
  ],
  [
    'an unknown instrumentation',
    components({ name: 'A', instrumentations: { scroll: {} } }),
    /Unknown instrumentation interactions\.components\[0\]\.instrumentations\.scroll/,
  ],
  [
    'a true click shorthand',
    components({ name: 'A', instrumentations: { click: true } }),
    /interactions\.components\[0\]\.instrumentations\.click must be an object/,
  ],
  [
    'an unknown click key',
    components({ name: 'A', instrumentations: { click: { handler: 'x' } } }),
    /Unknown option interactions\.components\[0\]\.instrumentations\.click\.handler\./,
  ],
  [
    'empty handlers',
    components({ name: 'A', instrumentations: { click: { handlers: [] } } }),
    /interactions\.components\[0\]\.instrumentations\.click\.handlers must be a non-empty array/,
  ],
  [
    'an entry without an instrumentation',
    components({ name: 'A' }),
    /interactions\.components\[0\] must list an instrumentation/,
  ],
  [
    'an entry with empty instrumentations',
    components({ name: 'A', instrumentations: {} }),
    /interactions\.components\[0\] must list an instrumentation/,
  ],
  [
    'a duplicate (name, from) entry',
    components(
      { name: 'A', from: 'lib', instrumentations: click },
      { name: 'A', instrumentations: click },
      { name: 'A', from: 'lib', enabled: false },
    ),
    /interactions\.components\[2\] duplicates interactions\.components\[0\] \(name "A", from "lib"\)/,
  ],
])('rejects %s with a TypeError naming the key', (_name, options, message) => {
  const run = () => transform('const value = 1;', options);
  expect(run).toThrow(TypeError);
  expect(run).toThrow(message);
});

test('accepts the full option shape with the effective defaults written out', () => {
  const defaults = {
    debug: false,
    interactions: {
      enabled: true,
      widgetId: ['widget-id', 'testID', 'accessibilityLabel', '@component'],
      widgetName: ['@content'],
      components: [
        {
          name: 'Button',
          from: 'react-native',
          widgetName: ['title'],
          instrumentations: { click: { handlers: ['onPress'] } },
        },
        ...BUILT_INS.slice(1).map((name) => ({
          name,
          from: 'react-native',
          instrumentations: { click: { handlers: ['onPress'] } },
        })),
      ],
    },
  };
  const source = `
    import { ${BUILT_INS.join(', ')} } from 'react-native';
    <>
      <Button title="Save" testID="save" onPress={a} />
      <Pressable accessibilityLabel="Retry" onPress={b}>Retry</Pressable>
    </>;
  `;

  expect(transform(source, defaults)).toBe(transform(source));
});
