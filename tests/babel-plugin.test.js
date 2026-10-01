const { transformSync } = require('@babel/core');
const plugin = require('../babel-plugin.cjs');

function transform(source, options = {}) {
  return transformSync(source, {
    babelrc: false,
    configFile: false,
    plugins: [[plugin, options]],
    parserOpts: { plugins: ['jsx'] },
  }).code;
}

test('instruments supported named and aliased imports and handler forms', () => {
  const output = transform(
    `
      import { Button, Pressable as TapTarget } from 'react-native';
      const handler = () => 1;
      const object = { handler };
      export const screen = <>
        <Button testID="save" onPress={() => handler()} />
        <TapTarget testID={'retry'} onPress={handler} />
        <TapTarget testID="member" onPress={object.handler} />
      </>;
    `,
    { includeAccessibilityLabel: true },
  );

  expect(output.match(/elasticOtelWrapPressHandler/g)).toHaveLength(4);
  expect(output).toContain('"save", null');
  expect(output).toContain('"retry", null');
  expect(output).toContain('"member", null');
});

test('includes only an explicitly enabled static accessibility label', () => {
  const source = `
    import { Pressable } from 'react-native';
    <Pressable testID="save" accessibilityLabel="Save order" onPress={save}>
      Visible private text
    </Pressable>;
  `;

  expect(transform(source)).toContain('"save", null');
  const enabled = transform(source, { includeAccessibilityLabel: true });
  expect(enabled).toContain('"save", "Save order"');
  expect(enabled.match(/Visible private text/g)).toHaveLength(1);
});

test('requires an own boolean accessibility-label option', () => {
  const source = `
    import { Pressable } from 'react-native';
    <Pressable testID="save" accessibilityLabel="Save order" onPress={save} />;
  `;

  expect(transform(source)).toContain('"save", null');
  expect(
    transform(source, Object.create({ includeAccessibilityLabel: true })),
  ).toContain('"save", null');
  expect(transform(source, { includeAccessibilityLabel: false })).toContain(
    '"save", null',
  );
  expect(transform(source, { includeAccessibilityLabel: true })).toContain(
    '"save", "Save order"',
  );
  expect(() => transform(source, { includeAccessibilityLabel: 'yes' })).toThrow(
    /accepts only/,
  );
});

test('uses only static identity after the final JSX spread', () => {
  const output = transform(`
    import { Pressable } from 'react-native';
    <>
      <Pressable testID="overridden" {...props} onPress={save} />
      <Pressable {...props} testID="stable" onPress={save} />
    </>;
  `);

  expect(output).not.toMatch(
    /elasticOtelWrapPressHandler\(save, "overridden", null\)/,
  );
  expect(output).toMatch(/elasticOtelWrapPressHandler\(save, "stable", null\)/);
  expect(output.match(/elasticOtelWrapPressHandler/g)).toHaveLength(2);
});

test('leaves unsupported, dynamic, ambiguous, and unrelated JSX unchanged', () => {
  const output = transform(`
    import { Pressable as NativePressable } from 'react-native';
    import { Button } from './components';
    const id = 'dynamic';
    <>
      <NativePressable onPress={save} />
      <NativePressable testID={id} onPress={save} />
      <NativePressable testID=" " onPress={save} />
      <NativePressable {...props} />
      <NativePressable testID="save" onPress={save()} />
      <Button testID="custom" onPress={save} />
      <View testID="view" onPress={save} />
    </>;
  `);

  expect(output).not.toContain('__wrapPressHandler');
  expect(output).not.toContain('@elastic/otel-react-native');
});

test('does not duplicate wrapping on a second transform', () => {
  const once = transform(`
    import { Pressable } from 'react-native';
    <Pressable testID="save" onPress={save} />;
  `);
  const twice = transform(once);

  expect(twice.match(/elasticOtelWrapPressHandler/g)).toHaveLength(2);
  expect(
    twice.match(/_elasticOtelWrapPressHandler\(save, "save", null\)/g),
  ).toHaveLength(1);
});

test('rejects unsupported plugin option shapes', () => {
  expect(() => transform('const value = 1;', { unknown: true })).toThrow(
    /accepts only/,
  );
});
