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
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Each lockfile must be exactly what npm regenerates from its package.json.
// The check regenerates it in a temporary copy, so it never edits the
// worktree. The fixtures link the package through `file:..`, so their copies
// keep the root package.json one directory above them.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCKFILES = [
  { directory: '.', fixes: 'npm install --package-lock-only' },
  {
    directory: 'fixture',
    fixes: 'npm --prefix fixture install --package-lock-only',
  },
  {
    directory: 'expo-fixture',
    fixes: 'npm --prefix expo-fixture install --package-lock-only',
  },
];

const scratch = await mkdtemp(join(tmpdir(), 'edot-rn-lockfiles-'));
const stale = [];
try {
  await cp(join(ROOT, 'package.json'), join(scratch, 'package.json'));
  for (const { directory, fixes } of LOCKFILES) {
    const copy = join(scratch, directory);
    for (const file of ['package.json', 'package-lock.json']) {
      await cp(join(ROOT, directory, file), join(copy, file));
    }
    const run = spawnSync(
      'npm',
      [
        'install',
        '--package-lock-only',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
      ],
      { cwd: copy, encoding: 'utf8' },
    );
    if (run.status !== 0) {
      throw new Error(
        `npm could not regenerate ${join(directory, 'package-lock.json')}:\n${run.stderr}`,
      );
    }
    const [committed, regenerated] = await Promise.all([
      readFile(join(ROOT, directory, 'package-lock.json'), 'utf8'),
      readFile(join(copy, 'package-lock.json'), 'utf8'),
    ]);
    if (committed !== regenerated) {
      stale.push(`${join(directory, 'package-lock.json')} (run \`${fixes}\`)`);
    }
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

if (stale.length > 0) {
  console.error(
    `Lockfiles are out of date with their package.json:\n  ${stale.join('\n  ')}`,
  );
  process.exitCode = 1;
} else {
  console.log('Lockfiles match their package.json.');
}
