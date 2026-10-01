import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
  encoding: 'utf8',
});
const [{ files }] = JSON.parse(output);
const allowed = [
  'LICENSE',
  'README.md',
  'ElasticOtelReactNative.podspec',
  'babel-plugin.cjs',
  'package.json',
  'react-native.config.js',
];

for (const { path } of files) {
  if (/(^|\/)(build|fixture|tests?|__tests__)(\/|$)/i.test(path)) {
    throw new Error(`Forbidden npm package file: ${path}`);
  }
  if (
    !allowed.includes(path) &&
    path !== 'android/library/build.gradle' &&
    !path.startsWith('android/library/src/main/') &&
    !path.startsWith('bin/') &&
    !path.startsWith('docs/') &&
    !path.startsWith('ios/Sources/') &&
    !path.startsWith('lib/') &&
    !path.startsWith('src/')
  ) {
    throw new Error(`Unexpected npm package file: ${path}`);
  }
}

const required = [
  'LICENSE',
  'README.md',
  'ElasticOtelReactNative.podspec',
  'babel-plugin.cjs',
  'android/library/src/main/java/co/elastic/otel/reactnative/ManualTelemetry.kt',
  'android/library/src/main/java/co/elastic/otel/reactnative/Bootstrap.kt',
  'bin/elastic-otel-react-native.mjs',
  'docs/docset.yml',
  'docs/reference/edot-react-native/manual-instrumentation.md',
  'docs/reference/edot-react-native/getting-started.md',
  'docs/release-notes/known-issues.md',
  'ios/Sources/Bootstrap.swift',
  'ios/Sources/ElasticOtelReactNativeModule.m',
  'ios/Sources/ElasticOtelReactNativeModule.swift',
  'lib/index.d.ts',
  'src/index.ts',
];
for (const requiredPath of required) {
  if (!files.some(({ path }) => path === requiredPath)) {
    throw new Error(`The npm package is missing ${requiredPath}.`);
  }
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
for (const dependencyGroup of [
  packageJson.dependencies,
  packageJson.devDependencies,
  packageJson.peerDependencies,
  packageJson.optionalDependencies,
]) {
  for (const name of Object.keys(dependencyGroup ?? {})) {
    if (name.startsWith('@opentelemetry/')) {
      throw new Error(`Forbidden JavaScript OpenTelemetry dependency: ${name}`);
    }
  }
}

const declarations = await readFile('lib/index.d.ts', 'utf8');
for (const declaration of [
  'export type StartSpanOptions',
  'parentSpanHandle?: string',
  'export type EmitLogOptions',
  'spanHandle?: string',
  'export type RecordWidgetClickOptions',
  'widgetId: string',
  'timestamp: number',
]) {
  if (!declarations.includes(declaration)) {
    throw new Error(`Packed declarations are missing ${declaration}.`);
  }
}

if ((statSync('bin/elastic-otel-react-native.mjs').mode & 0o111) === 0) {
  throw new Error('The setup command is not executable.');
}

const podspec = await readFile('ElasticOtelReactNative.podspec', 'utf8');
for (const requiredPodspecContent of [
  "url: 'https://github.com/elastic/apm-agent-ios.git'",
  "kind: 'exactVersion'",
  "version: '1.4.0'",
  "products: ['ElasticApm']",
]) {
  if (!podspec.includes(requiredPodspecContent)) {
    throw new Error(`The packed podspec is missing ${requiredPodspecContent}.`);
  }
}
if (podspec.includes('../apm-agent-ios')) {
  throw new Error('The packed podspec must not use a sibling EDOT iOS path.');
}

const reactNativeConfig = await readFile('react-native.config.js', 'utf8');
if (!/ios:\s*\{\}/.test(reactNativeConfig)) {
  throw new Error('The packed package does not enable iOS autolinking.');
}

const iosModule = await readFile(
  'ios/Sources/ElasticOtelReactNativeModule.swift',
  'utf8',
);
for (const contract of [
  'E_ELASTIC_OTEL_REACT_NATIVE',
  'func getStatus(',
  'func startSpan(',
  'func endSpan(',
  'func emitLog(',
  'func recordWidgetClick(',
]) {
  if (!iosModule.includes(contract)) {
    throw new Error(`The packed iOS module is missing ${contract}.`);
  }
}

const iosShim = await readFile(
  'ios/Sources/ElasticOtelReactNativeModule.m',
  'utf8',
);
for (const exportedMethod of [
  'RCT_EXTERN_METHOD(getStatus',
  'RCT_EXTERN_METHOD(startSpan',
  'RCT_EXTERN_METHOD(endSpan',
  'RCT_EXTERN_METHOD(emitLog',
  'RCT_EXTERN_METHOD(recordWidgetClick',
]) {
  if (!iosShim.includes(exportedMethod)) {
    throw new Error(`The packed iOS export shim is missing ${exportedMethod}.`);
  }
}
