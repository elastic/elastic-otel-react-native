import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  APPLY_PLUGIN_LINES,
  CLASSPATH_LINES,
  CONFIG_SCRIPT_LINE,
  PLUGIN_PORTAL_LINE,
} from '../setup-edits.cjs';
import { readEdotIosVersion } from './check-edot-versions.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EDOT_IOS_VERSION = await readEdotIosVersion();
const REQUIRED = [
  'docs/docset.yml',
  'docs/redirects.yml',
  'docs/reference/edot-react-native/toc.yml',
  'docs/reference/edot-react-native/index.md',
  'docs/reference/edot-react-native/getting-started.md',
  'docs/reference/edot-react-native/configuration.md',
  'docs/reference/edot-react-native/automatic-instrumentation.md',
  'docs/reference/edot-react-native/manual-instrumentation.md',
  'docs/release-notes/toc.yml',
  'docs/release-notes/index.md',
  'docs/release-notes/known-issues.md',
];
const MARKDOWN = [
  'README.md',
  ...REQUIRED.filter((path) => path.endsWith('.md')),
];
const ALLOWED_BRIDGE_EXPORTS = new Set([
  'emitLog',
  'endSpan',
  'getStatus',
  'recordWidgetClick',
  'startSpan',
]);

async function load(path) {
  try {
    return await readFile(join(ROOT, path), 'utf8');
  } catch (error) {
    throw new Error(
      `Cannot read required documentation file ${path}: ${error.message}`,
    );
  }
}

function slug(heading) {
  return heading
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function headings(markdown) {
  return new Set(
    markdown
      .split(/\r?\n/)
      .filter((line) => /^#{1,6}\s+/.test(line))
      .map((line) =>
        slug(line.replace(/^#{1,6}\s+/, '').replace(/\s+\[[^\]]+\]$/, '')),
      ),
  );
}

for (const path of REQUIRED) {
  await load(path);
}

const referenceToc = await load('docs/reference/edot-react-native/toc.yml');
for (const page of [
  'index.md',
  'getting-started.md',
  'configuration.md',
  'automatic-instrumentation.md',
  'manual-instrumentation.md',
]) {
  if (!referenceToc.includes(`- file: ${page}`)) {
    throw new Error(`Reference navigation is missing ${page}.`);
  }
}
for (const platform of ['android', 'ios']) {
  const troubleshootingCrosslink = `crosslink: docs-content://troubleshoot/ingest/opentelemetry/edot-sdks/${platform}/index.md`;
  if (!referenceToc.includes(troubleshootingCrosslink)) {
    throw new Error(
      `Reference navigation is missing the EDOT ${platform} troubleshooting crosslink.`,
    );
  }
}

const releaseToc = await load('docs/release-notes/toc.yml');
for (const page of ['index.md', 'known-issues.md']) {
  if (!releaseToc.includes(`- file: ${page}`)) {
    throw new Error(`Release-note navigation is missing ${page}.`);
  }
}

const markdownCache = new Map();
for (const path of MARKDOWN) {
  markdownCache.set(path, await load(path));
}

for (const [path, markdown] of markdownCache) {
  for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const destination = match[1];
    if (
      destination.startsWith('#') ||
      /^[a-z][a-z0-9+.-]*:\/\//i.test(destination)
    ) {
      continue;
    }
    const [fileDestination, fragment] = destination.split('#', 2);
    const resolved = normalize(join(dirname(path), fileDestination));
    if (!resolved.startsWith('docs/') && resolved !== 'README.md') {
      throw new Error(
        `${path} links outside the documentation payload: ${destination}`,
      );
    }
    const target = markdownCache.get(resolved) ?? (await load(resolved));
    if (fragment && !headings(target).has(fragment)) {
      throw new Error(`${path} links to missing heading ${destination}.`);
    }
  }
}

const allDocumentation = [...markdownCache.values()].join('\n');
for (const forbidden of ['EDOT Collector', 'APM Server']) {
  if (allDocumentation.includes(forbidden)) {
    throw new Error(
      `Documentation contains forbidden stale terminology: ${forbidden}`,
    );
  }
}
for (const staleExample of ['import { crash }', 'await crash()']) {
  if (allDocumentation.includes(staleExample)) {
    throw new Error(
      `Documentation contains an unavailable crash example: ${staleExample}`,
    );
  }
}

const expectedCommands = [
  'npx elastic-otel-react-native setup-android',
  'npx elastic-otel-react-native setup-ios',
];
for (const path of [
  'README.md',
  'docs/reference/edot-react-native/getting-started.md',
]) {
  for (const expectedCommand of expectedCommands) {
    if (!markdownCache.get(path).includes(expectedCommand)) {
      throw new Error(`${path} is missing ${expectedCommand}.`);
    }
  }
}

const gettingStarted = markdownCache.get(
  'docs/reference/edot-react-native/getting-started.md',
);
const testedVersionRows = new Map(
  gettingStarted
    .split(/\r?\n/)
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells.length === 2),
);
// The Expo rows come from the Expo fixture, so a fixture bump that skips the
// docs fails here. npm resolves @expo/cli from expo's own node_modules first.
const expoFixture = JSON.parse(
  await readFile(join(ROOT, 'expo-fixture/package.json'), 'utf8'),
);
const expoLockPackages = JSON.parse(
  await readFile(join(ROOT, 'expo-fixture/package-lock.json'), 'utf8'),
).packages;
const expoVersion = expoFixture.dependencies.expo;
const expoCliVersion = (
  expoLockPackages['node_modules/expo/node_modules/@expo/cli'] ??
  expoLockPackages['node_modules/@expo/cli']
).version;
for (const [component, version] of [
  ['Node.js', '22.23.2'],
  ['React', '19.2.3'],
  ['React Native', '0.87.1 with Hermes and the New Architecture'],
  ['Android Gradle Plugin', '9.2.1'],
  ['Gradle', '9.4.1'],
  ['Kotlin', '2.2.0'],
  ['JDK', 'Amazon Corretto 21.0.9'],
  ['Android API', 'compile 37 / target 36 / minimum 26'],
  // The EDOT Android row is checked by scripts/check-edot-versions.mjs.
  ['Xcode', '27.0'],
  ['CocoaPods', '1.16.2'],
  ['iOS deployment target', '16.0'],
  ['EDOT iOS', `${EDOT_IOS_VERSION} (\`ElasticApm\` SwiftPM product)`],
  [
    'Expo SDK',
    `${expoVersion.split('.')[0]} (\`expo\` ${expoVersion}, \`@expo/cli\` ${expoCliVersion})`,
  ],
  ['React Native for Expo', expoFixture.dependencies['react-native']],
]) {
  if (testedVersionRows.get(component) !== version) {
    throw new Error(
      `The canonical tested-version table is missing ${component}.`,
    );
  }
}

if (!gettingStarted.includes('\n## Set up an Expo app\n')) {
  throw new Error('The getting-started guide is missing the Expo section.');
}

const manualFallback = gettingStarted.slice(
  gettingStarted.indexOf('## Manual host setup fallback'),
  gettingStarted.indexOf('## Bootstrap before React Native'),
);
for (const line of [
  PLUGIN_PORTAL_LINE,
  ...CLASSPATH_LINES,
  ...APPLY_PLUGIN_LINES,
  CONFIG_SCRIPT_LINE,
]) {
  if (!manualFallback.includes(line)) {
    throw new Error(`The getting-started manual fallback is missing ${line}.`);
  }
}
if (!markdownCache.get('README.md').includes(CONFIG_SCRIPT_LINE)) {
  throw new Error(`README.md is missing ${CONFIG_SCRIPT_LINE}.`);
}

const configSchema = JSON.parse(await load('elastic-otel-config.schema.json'));
const configurationDoc = markdownCache.get(
  'docs/reference/edot-react-native/configuration.md',
);
const tableKeys = configurationDoc
  .split(/\r?\n/)
  .map((line) => line.match(/^\|\s*`([^`]+)`\s*\|/)?.[1])
  .filter(Boolean);
const schemaKeys = Object.keys(configSchema.properties);
if (tableKeys.sort().join() !== [...schemaKeys].sort().join()) {
  throw new Error(
    `The configuration key table lists ${tableKeys.join(', ')}; the schema defines ${schemaKeys.join(', ')}.`,
  );
}
const configExamples = [
  ...configurationDoc.matchAll(/^```json\r?\n([\s\S]*?)^```$/gm),
].map((match) => match[1]);
const ajv = new Ajv2020();
const validateConfig = ajv.compile(configSchema);
if (configExamples.length === 0) {
  throw new Error('The configuration doc has no configuration file example.');
}
for (const example of configExamples) {
  let parsed;
  try {
    parsed = JSON.parse(example);
  } catch (error) {
    throw new Error(
      `The configuration file example is not valid JSON: ${error.message}`,
    );
  }
  if (!validateConfig(parsed)) {
    throw new Error(
      `The configuration file example does not match the schema: ${ajv.errorsText(validateConfig.errors)}`,
    );
  }
}

for (const [path, markdown] of markdownCache) {
  for (const match of markdown.matchAll(
    /import\s*\{([\s\S]*?)\}\s*from '@elastic\/otel-react-native';/g,
  )) {
    const imports = match[1]
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    for (const imported of imports) {
      if (!ALLOWED_BRIDGE_EXPORTS.has(imported)) {
        throw new Error(
          `${path} imports an unavailable bridge API: ${imported}`,
        );
      }
    }
  }
}

const packageJson = JSON.parse(await load('package.json'));
if (
  packageJson.bin?.['elastic-otel-react-native'] !==
  'bin/elastic-otel-react-native.mjs'
) {
  throw new Error(
    'package.json does not expose the canonical setup executable.',
  );
}
for (const path of REQUIRED) {
  if (!['.md', '.yml'].includes(extname(path))) {
    throw new Error(`Unexpected documentation file type: ${path}`);
  }
}

console.log(`Validated ${REQUIRED.length} docs files and local navigation.`);
