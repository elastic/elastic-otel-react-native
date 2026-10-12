const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const fileName = path.join(root, 'tests', 'babel-config-types.ts');
const source = `
import type { PluginOptions } from '@elastic/otel-react-native/babel-plugin';

export const valid: PluginOptions = {
  debug: true,
  interactions: {
    widgetId: ['widget-id', '@component'],
    components: [
      { name: 'AppButton', instrumentations: { click: {} } },
      { name: 'Pressable', from: 'react-native', enabled: false },
    ],
  },
};

// @ts-expect-error click takes an object, not true
export const invalid: PluginOptions = { interactions: { components: [{ name: 'A', instrumentations: { click: true } }] } };
`;

// Type-checks a config through the package's own `./babel-plugin` export, as
// an app would import it.
function diagnostics(options) {
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = (name) => (name === fileName ? source : readFile(name));
  host.fileExists = (name) => name === fileName || fileExists(name);
  const program = ts.createProgram([fileName], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    );
}

test.each([
  [
    'bundler',
    {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  ],
  [
    'node16',
    {
      module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node16,
    },
  ],
])(
  'PluginOptions resolves through the babel-plugin export under %s',
  (_name, options) => {
    expect(
      diagnostics({ ...options, strict: true, noEmit: true, types: [] }),
    ).toEqual([]);
  },
);
