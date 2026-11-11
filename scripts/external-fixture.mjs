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

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'fixture');
export const EXTERNAL_FIXTURE = join(ROOT, 'build', 'external-fixture');

export async function copyFixture(destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(dirname(destination), { recursive: true });
  await cp(FIXTURE, destination, {
    recursive: true,
    filter(source) {
      return !['node_modules', '.gradle', '.kotlin', 'build', '.cxx'].includes(
        source.split('/').at(-1),
      );
    },
  });
}

async function adjustExternalPackageLink() {
  const packagePath = join(EXTERNAL_FIXTURE, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  packageJson.dependencies['@elastic/otel-react-native'] = 'file:../..';
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const lockPath = join(EXTERNAL_FIXTURE, 'package-lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.packages[''].dependencies['@elastic/otel-react-native'] = 'file:../..';
  lock.packages['../..'] = lock.packages['..'];
  delete lock.packages['..'];
  lock.packages['node_modules/@elastic/otel-react-native'].resolved = '../..';
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

export function assertPackedFixture() {
  const installedPackage = realpathSync(
    join(EXTERNAL_FIXTURE, 'node_modules', '@elastic', 'otel-react-native'),
  );
  const installedRelative = relative(EXTERNAL_FIXTURE, installedPackage);
  if (
    isAbsolute(installedRelative) ||
    installedRelative === '..' ||
    installedRelative.startsWith(`..${sep}`)
  ) {
    throw new Error(
      'The fixture must build the packed npm package, not a sibling checkout.',
    );
  }
}

// Platform setup and builds stay in test-setup-android.mjs and
// build-ios-fixture.mjs; neither group depends on the other's output.
export async function prepareExternalFixture(environment = process.env) {
  const run = (arguments_, cwd = EXTERNAL_FIXTURE) => {
    const execution = spawnSync('npm', arguments_, {
      cwd,
      env: environment,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    });
    if (execution.status !== 0) {
      throw new Error(
        `npm ${arguments_.join(' ')} failed.\n${execution.stderr || execution.stdout}`,
      );
    }
    return execution.stdout;
  };
  await copyFixture(EXTERNAL_FIXTURE);
  await adjustExternalPackageLink();
  run(['ci', '--no-audit', '--no-fund']);
  const [{ filename }] = JSON.parse(
    run(['pack', '--json', '--pack-destination', join(ROOT, 'build')], ROOT),
  );
  const tarball = join(ROOT, 'build', filename);
  try {
    run([
      'install',
      '--no-save',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      tarball,
    ]);
  } finally {
    await rm(tarball, { force: true });
  }
  assertPackedFixture();
  return join(
    EXTERNAL_FIXTURE,
    'node_modules',
    '.bin',
    process.platform === 'win32'
      ? 'elastic-otel-react-native.cmd'
      : 'elastic-otel-react-native',
  );
}
