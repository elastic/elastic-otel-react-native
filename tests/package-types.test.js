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

const path = require('node:path');
const ts = require('@typescript/typescript6');

const root = path.resolve(__dirname, '..');
const fileName = path.join(root, 'tests', 'consumer-types.ts');
const source = `
import { getStatus, startSpan, endSpan, emitLog, recordWidgetClick } from '@elastic/otel-react-native';
import type { PluginOptions } from '@elastic/otel-react-native/babel-plugin';

export async function telemetry() {
  const status: { ready: boolean } = await getStatus();
  const handle: string = await startSpan('screen', { parentSpanHandle: 'parent' });
  await emitLog('screen opened', 'info', { spanHandle: handle });
  await recordWidgetClick({ widgetId: 'save', widgetName: 'Save', timestamp: 123 });
  await endSpan(handle);
  return status;
}

// @ts-expect-error severity must be a supported level
emitLog('screen opened', 'verbose');
// @ts-expect-error span handles are opaque strings
startSpan('screen', { parentSpanHandle: 123 });
// @ts-expect-error widget clicks require a timestamp
recordWidgetClick({ widgetId: 'save' });

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

// @ts-expect-error an enabled entry lists its instrumentations
export const noInstrumentations: PluginOptions = { interactions: { components: [{ name: 'A' }] } };

// @ts-expect-error an enabled entry lists click
export const noClick: PluginOptions = { interactions: { components: [{ name: 'A', instrumentations: {} }] } };
`;

// Type-checks an app's imports through the package exports.
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
])('Published SDK and plugin types resolve under %s', (_name, options) => {
  expect(
    diagnostics({ ...options, strict: true, noEmit: true, types: [] }),
  ).toEqual([]);
});
