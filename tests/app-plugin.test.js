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

const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

// Capture the registered native-file callbacks without running Expo prebuild.
jest.mock(
  'expo/config-plugins',
  () => ({
    withMainApplication: (config, action) => ({
      ...config,
      mainApplication: action,
    }),
    withAppDelegate: (config, action) => ({ ...config, appDelegate: action }),
    withAppBuildGradle: (config) => config,
    withProjectBuildGradle: (config) => config,
    withXcodeProject: (config) => config,
  }),
  { virtual: true },
);

const withPlugin = require('../app.plugin.js');

let projectRoot;

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'edot-expo-plugin-'));
  writeFileSync(join(projectRoot, 'elastic-otel-config.json'), '{}');
});

afterAll(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

const cases = [
  {
    mod: 'mainApplication',
    required: 'Kotlin',
    unsupported: 'java',
    path: 'android/app/src/main/java/com/example/MainApplication.java',
    contents: 'package com.example;\npublic class MainApplication {}\n',
    bootstrap:
      'import co.elastic.otel.reactnative.ElasticOtelReactNative;\nElasticOtelReactNative.initialize(this);\n',
    supported: 'kt',
    supportedPath: 'android/app/src/main/java/com/example/MainApplication.kt',
    source: `package com.example
import android.app.Application

class MainApplication : Application() {
  override fun onCreate() {
    super.onCreate()
  }
}
`,
    initialized: `  override fun onCreate() {
    super.onCreate()
    ElasticOtelReactNative.initialize(this)
`,
    imported: 'import co.elastic.otel.reactnative.ElasticOtelReactNative\n',
  },
  {
    mod: 'appDelegate',
    required: 'Swift',
    unsupported: 'objc',
    path: 'ios/Example/AppDelegate.mm',
    contents: '#import "AppDelegate.h"\n@implementation AppDelegate\n@end\n',
    bootstrap:
      'import ElasticOtelReactNative\ntry ElasticOtelReactNative.initialize()\n',
    supported: 'swift',
    supportedPath: 'ios/Example/AppDelegate.swift',
    source: `import UIKit

class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    return true
  }
}
`,
    initialized: `  ) -> Bool {
    do {
      try ElasticOtelReactNative.initialize()
    } catch {
      fatalError("EDOT iOS bootstrap failed: \\(error)")
    }
    return true
`,
    imported: 'import ElasticOtelReactNative\n',
  },
];

describe.each(cases)('$mod language support', (sample) => {
  test.each([false, true])(
    'rejects an unsupported language before mutation (bootstrap present: %s)',
    (hasBootstrap) => {
      const contents = sample.contents + (hasBootstrap ? sample.bootstrap : '');
      const config = {
        modRequest: { projectRoot },
        modResults: {
          language: sample.unsupported,
          path: join(projectRoot, sample.path),
          contents,
        },
      };
      const edit = withPlugin({})[sample.mod];

      expect(() => edit(config)).toThrow(
        new Error(
          `${sample.path} is not ${sample.required}. The Expo config plugin requires an Expo-generated ${sample.required} file. Regenerate the native projects with npx expo prebuild --clean. This replaces the generated native directories and discards manual changes there.`,
        ),
      );
      expect(config.modResults.contents).toBe(contents);
    },
  );

  test('bootstraps a supported source once', () => {
    const config = {
      modRequest: { projectRoot },
      modResults: {
        language: sample.supported,
        path: join(projectRoot, sample.supportedPath),
        contents: sample.source,
      },
    };
    const edit = withPlugin({})[sample.mod];

    expect(edit(config)).toBe(config);
    expect(config.modResults.contents).toContain(sample.imported);
    expect(config.modResults.contents).toContain(sample.initialized);
    const initialized = config.modResults.contents;
    expect(edit(config)).toBe(config);
    expect(config.modResults.contents).toBe(initialized);
  });
});
