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

import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const green = new Set([
  '0BSD',
  'Apache-1.1',
  'Apache-2.0',
  'Artistic-1.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BSL-1.0',
  'CC-BY-1.0',
  'CC-BY-2.0',
  'CC-BY-2.5',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'curl',
  'HPND',
  'ICU',
  'ISC',
  'MIT',
  'MIT-CMU',
  'OpenSSL',
  'PHP-3.0',
  'PHP-3.01',
  'PSF-2.0',
  'Python-2.0',
  'Unicode-3.0',
  'Unlicense',
  'WTFPL',
  'ZPL-2.1',
  'Zlib',
  'zlib-acknowledgement',
]);

export function isGreenLicense(expression) {
  if (typeof expression !== 'string' || !expression.trim()) return false;
  const tokens = expression.match(/\(|\)|[^\s()]+/g);
  let cursor = 0;
  function operand() {
    const token = tokens[cursor++];
    if (token === '(') {
      const result = or();
      if (tokens[cursor++] !== ')') throw new Error('Unclosed license group');
      return result;
    }
    if (
      !token ||
      ['AND', 'OR', 'WITH', ')'].includes(token) ||
      !/^(?:[A-Za-z0-9.-]+\+?|DocumentRef-[A-Za-z0-9.-]+:LicenseRef-[A-Za-z0-9.-]+)$/.test(
        token,
      )
    ) {
      throw new Error('Expected license');
    }
    if (tokens[cursor] === 'WITH') {
      cursor++;
      const exception = tokens[cursor++];
      if (
        !exception ||
        !/^[A-Za-z0-9.-]+$/.test(exception) ||
        ['AND', 'OR', 'WITH'].includes(exception)
      ) {
        throw new Error('Expected license exception');
      }
      // An exception changes the terms; no such combination is approved Green.
      return false;
    }
    return green.has(token);
  }
  function and() {
    let result = operand();
    while (tokens[cursor] === 'AND') {
      cursor++;
      const next = operand();
      result = result && next;
    }
    return result;
  }
  function or() {
    let result = and();
    while (tokens[cursor] === 'OR') {
      cursor++;
      const next = and();
      result = result || next;
    }
    return result;
  }
  try {
    const result = or();
    return cursor === tokens.length && result;
  } catch {
    return false;
  }
}

function readMatching(directory, pattern) {
  return readdirSync(directory)
    .sort()
    .filter((name) => pattern.test(name))
    .map((name) => readFileSync(join(directory, name), 'utf8'));
}

function readLicense(directory) {
  const licenses = readMatching(
    directory,
    /^(LICENSE|LICENCE|UNLICENSE|COPYING)([.-].*)?$/i,
  ).filter((text) => text.trim());
  if (licenses.length) return licenses.join('\n\n');
  const [readme] = readMatching(directory, /^README\.md$/i);
  const match = readme?.match(
    /^## License\s*\r?\n([\s\S]*?)(?=^#{1,2} |$(?![\s\S]))/im,
  );
  return match?.[1]?.trim() ? match[1] : null;
}

function packageDirectory(name, from, optional = false) {
  let directory = from;
  while (true) {
    const candidate = join(directory, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json')))
      return realpathSync(candidate);
    const parent = dirname(directory);
    if (parent === directory) {
      if (optional) return null;
      throw new Error(`${name}: installed package not found`);
    }
    directory = parent;
  }
}

function runtimePackages() {
  const packages = new Map();
  const visited = new Set([realpathSync(root)]);
  function visit(directory) {
    const manifest = JSON.parse(
      readFileSync(join(directory, 'package.json'), 'utf8'),
    );
    const runtime = {
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    };
    for (const name of Object.keys(runtime)) {
      const installed = packageDirectory(
        name,
        directory,
        Object.hasOwn(manifest.optionalDependencies ?? {}, name),
      );
      if (!installed || visited.has(installed)) continue;
      visited.add(installed);
      const dependency = JSON.parse(
        readFileSync(join(installed, 'package.json'), 'utf8'),
      );
      const label = `${name}@${dependency.version}`;
      if (!dependency.license) throw new Error(`${label}: missing license`);
      if (!isGreenLicense(dependency.license)) {
        throw new Error(
          `${label}: license is not Green: ${dependency.license}`,
        );
      }
      const licenseText = readLicense(installed);
      if (!licenseText) throw new Error(`${label}: no license text found`);
      const repository =
        typeof dependency.repository === 'string'
          ? dependency.repository
          : dependency.repository?.url;
      packages.set(label, {
        label,
        license: dependency.license,
        licenseText,
        repository: repository ?? dependency.homepage ?? '',
        notice: readMatching(installed, /^NOTICE(\..*)?$/i)[0] ?? null,
      });
      visit(installed);
    }
  }
  visit(root);
  return [...packages.values()].sort((a, b) =>
    a.label < b.label ? -1 : a.label > b.label ? 1 : 0,
  );
}

function generateNotice(packages) {
  const separator = '#'.repeat(80);
  const groups = new Map();
  for (const item of packages) {
    if (!groups.has(item.license)) groups.set(item.license, []);
    groups.get(item.license).push(item);
  }
  const parts = [
    'Elastic Distribution of OpenTelemetry React Native\nCopyright 2026 Elastic Technologies Inc.',
    separator,
    [...groups.keys()]
      .sort()
      .map(
        (license) =>
          `This product depends on software licensed under '${license}' from the following npm packages:\n` +
          groups
            .get(license)
            .map((item) => ` - ${item.label} (${item.repository})`)
            .join('\n'),
      )
      .join('\n-\n'),
    separator,
  ];
  for (const item of packages) {
    parts.push(item.label);
    if (item.notice) parts.push(item.notice);
    parts.push(item.licenseText);
  }
  return `${parts.join('\n\n').replace(/\n*$/, '')}\n`;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const mode = process.argv[2];
    if (
      process.argv.length !== 3 ||
      !['--check', '--generate'].includes(mode)
    ) {
      throw new Error(
        'Usage: node scripts/generate-notice.mjs --check|--generate',
      );
    }
    const packages = runtimePackages();
    if (mode === '--generate') {
      writeFileSync(join(root, 'NOTICE.txt'), generateNotice(packages));
    }
    console.log(
      `${packages.length} runtime package licenses are Green and have license text.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
