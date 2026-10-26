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

import { readFileSync } from 'node:fs';

import { readEdotIosVersion } from './check-edot-versions.mjs';

const packageList = readFileSync(
  'build/external-fixture/android/app/build/generated/autolinking/src/main/java/com/facebook/react/PackageList.java',
  'utf8',
);

if (
  !packageList.includes('ElasticOtelReactNativePackage') ||
  !packageList.includes(
    'new co.elastic.otel.reactnative.ElasticOtelReactNativePackage()',
  )
) {
  throw new Error(
    'The external fixture did not autolink ElasticOtelReactNativePackage.',
  );
}

const podfileLock = readFileSync(
  'build/external-fixture/ios/Podfile.lock',
  'utf8',
);
if (!podfileLock.includes('ElasticOtelReactNative (0.0.0)')) {
  throw new Error(
    'The external fixture did not autolink the ElasticOtelReactNative pod.',
  );
}

const podsProject = readFileSync(
  'build/external-fixture/ios/Pods/Pods.xcodeproj/project.pbxproj',
  'utf8',
);
if (
  !podsProject.includes('https://github.com/elastic/apm-agent-ios.git') ||
  !podsProject.includes('productName = ElasticApm;') ||
  !podsProject.includes('kind = exactVersion;') ||
  !podsProject.includes(`version = ${await readEdotIosVersion()};`)
) {
  throw new Error(
    'The external fixture did not attach the remote ElasticApm Swift package product.',
  );
}
