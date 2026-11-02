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
  ['MIT OR ???', false],
  ['??? OR MIT', false],
  ['MIT OR /', false],
  ['/ OR MIT', false],
  ['MIT OR GPL-3.0-only;', false],
  ['GPL-3.0-only; OR MIT', false],
  ['MIT OR Unknown-1.0', true],
  ['MIT OR LicenseRef-Custom', true],
  ['MIT OR DocumentRef-Package:LicenseRef-Custom', true],
  ['MIT OR GPL-2.0+', true],
  ['MIT OR (GPL-2.0-only WITH Classpath-exception-2.0)', true],
  ['(GPL-2.0-only WITH Classpath-exception-2.0) OR MIT', true],
  ['GPL-2.0-only WITH Classpath-exception-2.0 OR MIT', true],
  ['MIT WITH Classpath-exception-2.0', false],
  ['GPL-2.0-only WITH Classpath-exception-2.0', false],
  ['MIT AND (GPL-2.0-only WITH Classpath-exception-2.0)', false],
  ['MIT OR (GPL-2.0-only WITH)', false],
  ['MIT OR GPL-2.0-only WITH', false],
  ['GPL-2.0-only WITH OR MIT', false],
  ['MIT OR GPL-2.0-only WITH (Classpath-exception-2.0)', false],
  [
    'MIT OR GPL-2.0-only WITH Classpath-exception-2.0 WITH Other-exception',
    false,
  ],
  ['MIT OR (GPL-2.0-only WITH AND MIT)', false],
  ['WITH OR MIT', false],
  ['(MIT OR GPL-2.0-only) WITH Classpath-exception-2.0', false],
  ['MIT OR (GPL-2.0-only WITH Classpath-exception-2.0) trailing', false],
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
        timeout: 10000,
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

test('header check covers untracked files but not ignored or deleted ones', () => {
  withScriptFixture('check-license-headers.mjs', (root, run) => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(root, '.gitignore'), 'ignored/\n');
    mkdirSync(join(root, 'ignored'));
    writeFileSync(join(root, 'ignored/probe.js'), 'export {};\n');
    writeFileSync(join(root, 'deleted.js'), 'export {};\n');
    execFileSync('git', ['add', '--', 'deleted.js'], { cwd: root });
    rmSync(join(root, 'deleted.js'));
    run();

    writeFileSync(join(root, 'probe.js'), 'export {};\n');
    expect(() => run()).toThrow();
    run('--fix');
    run();
  });
});

test('notice includes dot and hyphen license filenames deterministically and retains fallbacks', () => {
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
    writeFileSync(join(dependency, 'LICENSE-APACHE'), apache);
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
    writeFileSync(join(dependency, 'LICENSE.MIT'), 'CRLF\r\nand CR\rtext\r\n');
    run('--generate');
    const normalized = readFileSync(join(root, 'NOTICE.txt'), 'utf8');
    expect(normalized).toContain('CRLF\nand CR\ntext');
    expect(normalized).not.toContain('\r');
    rmSync(join(dependency, 'LICENSE-APACHE'));
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

test('notice skips absent optionals and checks installed dependencies', () => {
  withScriptFixture('generate-notice.mjs', (root, run) => {
    const manifest = {
      name: 'fixture',
      version: '1.0.0',
      optionalDependencies: { optional: '1.0.0' },
    };
    const writeManifest = () =>
      writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
    writeManifest();
    run('--check');
    run('--generate');
    expect(readFileSync(join(root, 'NOTICE.txt'), 'utf8')).not.toContain(
      'optional@',
    );

    manifest.dependencies = { required: '1.0.0' };
    writeManifest();
    for (const mode of ['--check', '--generate'])
      expect(() => run(mode)).toThrow(/required: installed package not found/);
    delete manifest.dependencies;
    writeManifest();
    const directory = join(root, 'node_modules/optional');
    mkdirSync(directory, { recursive: true });
    const optional = { name: 'optional', version: '1.0.0', license: 'MIT' };
    writeFileSync(join(directory, 'package.json'), JSON.stringify(optional));
    writeFileSync(join(directory, 'LICENSE'), 'Optional MIT license text\n');
    run('--check');
    run('--generate');
    expect(readFileSync(join(root, 'NOTICE.txt'), 'utf8')).toContain(
      'optional@1.0.0',
    );
    optional.license = 'AGPL-3.0-only';
    writeFileSync(join(directory, 'package.json'), JSON.stringify(optional));
    for (const mode of ['--check', '--generate'])
      expect(() => run(mode)).toThrow(/optional@1.0.0: license is not Green/);
  });
});

test('notice follows runtime manifests through shared packages and cycles, excluding peers', () => {
  withScriptFixture('generate-notice.mjs', (root, run) => {
    const writePackage = (
      directory,
      name,
      dependencies = {},
      license = 'MIT',
      version = '1.0.0',
      peers = {},
    ) => {
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({
          name,
          version,
          license,
          dependencies,
          peerDependencies: peers,
        }),
      );
      writeFileSync(
        join(directory, 'LICENSE'),
        `${name}@${version} distinct license text\n`,
      );
    };
    writePackage(root, 'fixture', { beta: '1.0.0' }, 'MIT', '1.0.0', {
      alpha: '1.0.0',
    });
    writePackage(
      join(root, 'node_modules/alpha'),
      'alpha',
      { shared: '1.0.0' },
      'AGPL-3.0-only',
    );
    writePackage(join(root, 'node_modules/beta'), 'beta', { gamma: '1.0.0' });
    writePackage(join(root, 'node_modules/gamma'), 'gamma', {
      shared: '1.0.0',
    });
    const shared = join(root, 'node_modules/shared');
    const leaf = join(root, 'node_modules/leaf');
    writePackage(shared, 'shared', { leaf: '1.0.0' });
    writePackage(leaf, 'leaf');
    const expectNotice = (labels) => {
      const notice = readFileSync(join(root, 'NOTICE.txt'), 'utf8');
      for (const label of labels)
        expect(notice.split(`${label} distinct license text`)).toHaveLength(2);
      expect(notice).not.toContain('alpha@1.0.0');
      expect(notice).not.toContain('fixture@1.0.0');
      return notice;
    };
    const labels = ['beta@1.0.0', 'gamma@1.0.0', 'shared@1.0.0', 'leaf@1.0.0'];
    run('--check');
    run('--generate');
    const first = expectNotice(labels);
    run('--generate');
    expect(expectNotice(labels)).toBe(first);
    writePackage(leaf, 'leaf', {}, 'AGPL-3.0-only');
    for (const mode of ['--check', '--generate'])
      expect(() => run(mode)).toThrow(/leaf@1.0.0: license is not Green/);

    writePackage(leaf, 'leaf');
    writePackage(shared, 'shared', { leaf: '1.0.0', beta: '1.0.0' });
    run('--check');
    run('--generate');
    expectNotice(labels);

    // A second installed version has its own runtime dependencies and checks.
    writePackage(
      root,
      'fixture',
      { beta: '1.0.0', delta: '1.0.0' },
      'MIT',
      '1.0.0',
      { alpha: '1.0.0' },
    );
    const delta = join(root, 'node_modules/delta');
    writePackage(delta, 'delta', { shared: '2.0.0' });
    const secondShared = join(delta, 'node_modules/shared');
    const secondLeaf = join(secondShared, 'node_modules/leaf');
    writePackage(secondShared, 'shared', { leaf: '2.0.0' }, 'MIT', '2.0.0');
    writePackage(secondLeaf, 'leaf', {}, 'MIT', '2.0.0');
    run('--check');
    run('--generate');
    expectNotice([...labels, 'delta@1.0.0', 'shared@2.0.0', 'leaf@2.0.0']);
    writePackage(secondLeaf, 'leaf', {}, 'AGPL-3.0-only', '2.0.0');
    for (const mode of ['--check', '--generate'])
      expect(() => run(mode)).toThrow(/leaf@2.0.0: license is not Green/);
  });
});
