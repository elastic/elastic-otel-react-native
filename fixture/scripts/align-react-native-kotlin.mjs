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

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Gradle 9.9.2 publishes Kotlin metadata 2.4.0. React Native 0.88.1 compiles
// its included Gradle plugin with Kotlin 2.2.0, which can read metadata only
// through 2.3.0. The app kotlinVersion does not select this compiler.
const REQUIRED = [2, 3, 0];
const catalogPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'node_modules',
  '@react-native',
  'gradle-plugin',
  'gradle',
  'libs.versions.toml',
);

function parts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(
      `Unsupported Kotlin version '${version}' in ${catalogPath}`,
    );
  }
  return match.slice(1).map(Number);
}

function compare(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

const source = readFileSync(catalogPath, 'utf8');
const match = /^kotlin = "([^"]+)"$/m.exec(source);
if (!match) {
  throw new Error(`Kotlin version pin not found in ${catalogPath}`);
}
if (compare(parts(match[1]), REQUIRED) >= 0) {
  process.exit(0);
}
writeFileSync(catalogPath, source.replace(match[0], 'kotlin = "2.3.0"'));
