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

const { execFileSync } = require('node:child_process');
const {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

test.each([
  ['MIT', true],
  ['MPL-2.0', false],
  ['AGPL-3.0-only', false],
  ['MIT OR GPL-3.0-only', true],
  ['MIT AND GPL-3.0-only', false],
  ['(MIT OR GPL-3.0-only) AND (Apache-2.0 OR MPL-2.0)', true],
  ['MIT AND (MPL-2.0 OR AGPL-3.0-only)', false],
  [undefined, false],
  ['', false],
  ['MIT OR', false],
  ['(MIT', false],
  ['MIT GPL-3.0-only', false],
])('license expression %p is Green: %p', (expression, expected) => {
  const result = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import { isGreenLicense } from './scripts/generate-notice.mjs'; process.stdout.write(JSON.stringify(isGreenLicense(JSON.parse(process.argv[1]))));",
      JSON.stringify(expression ?? null),
    ],
    { encoding: 'utf8' },
  );
  expect(JSON.parse(result)).toBe(expected);
});

function withScriptFixture(script, action) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'license-policy-')));
  try {
    mkdirSync(join(root, 'scripts'));
    copyFileSync(
      join(__dirname, '../scripts', script),
      join(root, 'scripts', script),
    );
    const run = (...args) =>
      execFileSync(process.execPath, [join(root, 'scripts', script), ...args], {
        cwd: root,
        encoding: 'utf8',
      });
    action(root, run);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test.each([
  ['probe.sh', '#!/bin/sh', '#', true],
  ['probe.swift', '// swift-tools-version: 5.9', '//', false],
  [
    'android/app/src/main/res/drawable/rn_edit_text_material.xml',
    '<?xml version="1.0"?>',
    '<!--',
    false,
  ],
])(
  'header repair preserves required first line in %s',
  (name, directive, opener, executable) => {
    withScriptFixture('check-license-headers.mjs', (root, run) => {
      execFileSync('git', ['init', '-q'], { cwd: root });
      const file = join(root, name);
      mkdirSync(join(file, '..'), { recursive: true });
      for (const ending of ['', '\n']) {
        writeFileSync(file, directive + ending);
        execFileSync('git', ['add', '--', name], { cwd: root });
        expect(() => run()).toThrow();
        run('--fix');
        const repaired = readFileSync(file, 'utf8');
        expect(repaired.startsWith(directive + '\n' + opener)).toBe(true);
        expect(repaired.split(directive)).toHaveLength(2);
        expect(repaired).not.toContain(directive + '\n\n' + opener);
        run();
        run('--fix');
        expect(readFileSync(file, 'utf8')).toBe(repaired);
        if (executable) {
          chmodSync(file, 0o755);
          expect(execFileSync(file, { encoding: 'utf8' })).toBe('');
        }
      }
    });
  },
);

test('notice includes every license text deterministically and retains fallbacks', () => {
  withScriptFixture('generate-notice.mjs', (root, run) => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        dependencies: { dual: '1.0.0' },
      }),
    );
    const dependency = join(root, 'node_modules/dual');
    mkdirSync(dependency, { recursive: true });
    writeFileSync(
      join(dependency, 'package.json'),
      JSON.stringify({
        name: 'dual',
        version: '1.0.0',
        license: 'Apache-2.0 AND MIT',
      }),
    );
    const apache = 'Distinct Apache license text\n';
    const mit = 'Distinct MIT license text\n';
    writeFileSync(join(dependency, 'LICENSE.MIT'), mit);
    writeFileSync(join(dependency, 'LICENSE.Apache-2.0'), apache);
    writeFileSync(
      join(dependency, 'NOTICE.extra'),
      'Other notice must not be selected',
    );
    writeFileSync(join(dependency, 'NOTICE'), 'Selected notice text');
    run('--check');
    run('--generate');
    const notice = readFileSync(join(root, 'NOTICE.txt'), 'utf8');
    for (const text of [apache, mit])
      expect(notice.split(text)).toHaveLength(2);
    expect(notice.indexOf(apache)).toBeLessThan(notice.indexOf(mit));
    expect(notice).toContain('Selected notice text');
    expect(notice).not.toContain('Other notice must not be selected');
    run('--generate');
    expect(readFileSync(join(root, 'NOTICE.txt'), 'utf8')).toBe(notice);
    rmSync(join(dependency, 'LICENSE.Apache-2.0'));
    rmSync(join(dependency, 'LICENSE.MIT'));
    writeFileSync(
      join(dependency, 'README.md'),
      '# Package\n\n## License\n\nREADME fallback license text\n\n## Usage\nNot a license\n',
    );
    run('--check');
    run('--generate');
    const fallback = readFileSync(join(root, 'NOTICE.txt'), 'utf8');
    expect(fallback).toContain('README fallback license text');
    expect(fallback).not.toContain('Not a license');
  });
});
