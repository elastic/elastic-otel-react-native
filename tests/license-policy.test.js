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
