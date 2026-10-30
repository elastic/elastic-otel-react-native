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

import assert from 'node:assert/strict';
import { lstatSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export function verifyFixtureBabelPlugin(projectRoot) {
  const installedPackage = join(
    projectRoot,
    'node_modules',
    '@elastic',
    'otel-react-native',
  );
  assert.ok(
    lstatSync(installedPackage).isDirectory(),
    'The consumer fixture must install the packed SDK, not link the checkout.',
  );
  const fixtureRequire = createRequire(join(projectRoot, 'package.json'));
  const babel = fixtureRequire('@babel/core');
  const interactionsPlugin = fixtureRequire(
    '@elastic/otel-react-native/babel-plugin',
  );
  const transformed = babel.transformSync(
    `import { Pressable } from 'react-native';
     <Pressable testID="fixture.tap" onPress={handler} />;`,
    {
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ['jsx'] },
      plugins: [interactionsPlugin],
    },
  ).code;
  assert.match(transformed, /__wrapPressHandler/);
  assert.match(transformed, /"fixture.tap"/);
  console.log(
    `Packed SDK instruments a press with fixture Babel ${babel.version}.`,
  );
}
