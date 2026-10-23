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
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DERIVED_DATA = join(ROOT, 'build', 'ios-native-tests');
const TEMPORARY = join(ROOT, 'build', 'ios-native-tests-temporary');
rmSync(DERIVED_DATA, { recursive: true, force: true });
mkdirSync(TEMPORARY, { recursive: true });
const environment = {
  ...process.env,
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'safe.bareRepository',
  GIT_CONFIG_VALUE_0: 'all',
  TMPDIR: TEMPORARY,
};
const devicesRun = spawnSync(
  'xcrun',
  ['simctl', 'list', 'devices', 'available', '--json'],
  { encoding: 'utf8', env: environment },
);
if (devicesRun.status !== 0) {
  throw new Error(devicesRun.stderr || devicesRun.stdout);
}

const runtimes = Object.entries(JSON.parse(devicesRun.stdout).devices)
  .filter(([runtime]) => runtime.includes('iOS'))
  .sort(([left], [right]) =>
    right.localeCompare(left, undefined, {
      numeric: true,
    }),
  );
const device = runtimes
  .flatMap(([, devices]) => devices)
  .find(
    (candidate) => candidate.isAvailable && candidate.name.startsWith('iPhone'),
  );
if (!device) {
  throw new Error('No available iPhone simulator was found.');
}

const run = spawnSync(
  'xcodebuild',
  [
    'test',
    '-scheme',
    'ElasticOtelReactNativeCore',
    '-destination',
    `id=${device.udid}`,
    '-derivedDataPath',
    DERIVED_DATA,
    'CODE_SIGNING_ALLOWED=NO',
  ],
  {
    cwd: join(ROOT, 'ios'),
    env: environment,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  },
);
if (run.status !== 0) {
  const output = `${run.stdout}\n${run.stderr}`;
  throw new Error(
    `iOS native tests failed on ${device.name}.\n${output.slice(-8_000)}`,
  );
}

console.log(`iOS native tests passed on ${device.name}.`);
