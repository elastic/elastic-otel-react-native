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

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  APPLY_PLUGIN_LINES,
  CLASSPATH_LINES,
  CONFIG_SCRIPT_LINE,
  PLUGIN_PORTAL_LINE,
} from '../setup-edits.cjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARKDOWN = [
  'README.md',
  ...(
    await readdir(join(ROOT, 'docs'), {
      recursive: true,
      withFileTypes: true,
    })
  )
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)))
    .sort(),
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

// Returns the body of the section that starts at the exact heading line, up to
// the next heading of the same or a higher level.
function section(markdown, heading) {
  const level = heading.match(/^#+/)[0].length;
  const lines = markdown.split(/\r?\n/);
  const start = lines.indexOf(heading);
  if (start === -1) {
    throw new Error(
      `The getting-started guide is missing the heading "${heading}".`,
    );
  }
  const end = lines.findIndex(
    (line, index) =>
      index > start &&
      /^#{1,6}\s/.test(line) &&
      line.match(/^#+/)[0].length <= level,
  );
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
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

const referenceToc = await load('docs/reference/edot-react-native/toc.yml');
if (
  !referenceToc.includes(
    'crosslink: docs-content://troubleshoot/ingest/opentelemetry/edot-sdks/index.md',
  )
) {
  throw new Error(
    'Reference navigation is missing the EDOT SDKs troubleshooting crosslink.',
  );
}

const markdownCache = new Map();
for (const path of MARKDOWN) {
  markdownCache.set(path, await load(path));
}

for (const match of markdownCache
  .get('README.md')
  .matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
  const destination = match[1];
  if (
    destination.startsWith('#') ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(destination)
  ) {
    continue;
  }
  const [fileDestination, fragment] = destination.split('#', 2);
  const resolved = normalize(fileDestination);
  if (!resolved.startsWith('docs/') && resolved !== 'README.md') {
    throw new Error(
      `README.md links outside the documentation payload: ${destination}`,
    );
  }
  const target = markdownCache.get(resolved) ?? (await load(resolved));
  if (fragment && !headings(target).has(fragment)) {
    throw new Error(`README.md links to missing heading ${destination}.`);
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

const gettingStarted = markdownCache.get(
  'docs/reference/edot-react-native/getting-started.md',
);
for (const heading of [
  '## Requirements',
  '## Set up an Expo app',
  '## Manual host setup fallback',
  '## Bootstrap before React Native',
  '## Start sending telemetry',
  '### Visualize telemetry',
]) {
  section(gettingStarted, heading);
}
for (const packageLink of [
  'integration-docs://reference/otel_android_dashboards.md',
  'integration-docs://reference/otel_ios_dashboards.md',
]) {
  if (
    !section(gettingStarted, '### Visualize telemetry').includes(packageLink)
  ) {
    throw new Error(
      `The getting-started Visualize telemetry section is missing ${packageLink}.`,
    );
  }
}
for (const expectedCommand of [
  'npx elastic-otel-react-native setup-android',
  'npx elastic-otel-react-native setup-ios',
]) {
  if (!gettingStarted.includes(expectedCommand)) {
    throw new Error(`The getting-started guide is missing ${expectedCommand}.`);
  }
}
const packageJson = JSON.parse(await load('package.json'));

// The Expo section's app.json example must list the same plugins and build
// properties as the Expo fixture, whose build proves them.
const expoSection = section(gettingStarted, '## Set up an Expo app');
const expoJsonBlocks = [...expoSection.matchAll(/```json\n([\s\S]*?)```/g)];
if (expoJsonBlocks.length !== 1) {
  throw new Error(
    `The Expo section must hold one app.json example, found ${expoJsonBlocks.length}.`,
  );
}
const expoFixtureApp = JSON.parse(
  await readFile(join(ROOT, 'expo-fixture/app.json'), 'utf8'),
);
if (
  !isDeepStrictEqual(
    JSON.parse(expoJsonBlocks[0][1]).expo?.plugins,
    expoFixtureApp.expo.plugins,
  )
) {
  throw new Error(
    "The Expo section's app.json example lists different expo.plugins than expo-fixture/app.json.",
  );
}

const manualFallback = section(gettingStarted, '## Manual host setup fallback');
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

if (
  packageJson.bin?.['elastic-otel-react-native'] !==
  'bin/elastic-otel-react-native.mjs'
) {
  throw new Error(
    'package.json does not expose the canonical setup executable.',
  );
}
console.log(
  `Validated content in ${MARKDOWN.length} Markdown files and README links.`,
);
