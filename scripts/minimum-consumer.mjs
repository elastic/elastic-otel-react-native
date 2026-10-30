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
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [host, platform, mode] = process.argv.slice(2);
if (
  !['bare', 'expo'].includes(host) ||
  !['android', 'ios'].includes(platform) ||
  (mode && mode !== '--baseline')
) {
  console.error(
    'Usage: node scripts/minimum-consumer.mjs bare|expo android|ios [--baseline]',
  );
  process.exit(2);
}
const baseline = mode === '--baseline';
const label = `minimum ${host}/${platform}${baseline ? ' baseline' : ''}`;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolchains = JSON.parse(
  readFileSync(join(root, 'minimum-fixtures/toolchains.json')),
);
const environment = {
  ...process.env,
  CI: '1',
  ORG_GRADLE_PROJECT_reactNativeArchitectures: 'arm64-v8a',
  EXPO_NO_TELEMETRY: '1',
  USE_FRAMEWORKS: 'dynamic',
  LANG: process.env.LANG || 'en_US.UTF-8',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'safe.bareRepository',
  GIT_CONFIG_VALUE_0: 'all',
};
function run(command, args, cwd, capture = false) {
  console.log(`[${label}] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    if (capture)
      process.stderr.write(`${result.stdout || ''}${result.stderr || ''}`);
    throw new Error(
      `${command} failed (${result.status ?? result.error?.message ?? result.signal ?? 'unknown status'})`,
    );
  }
  return result.stdout;
}
function edit(path, before, after) {
  const source = readFileSync(path, 'utf8');
  if (!source.includes(before))
    throw new Error(`Missing template anchor ${before} in ${path}`);
  writeFileSync(path, source.replace(before, after));
}
try {
  if (platform === 'android') {
    const java = run('java', ['--version'], root, true);
    if (!/^(openjdk|java) 17[. ]/.test(java))
      throw new Error(`Select JDK 17 with JAVA_HOME; selected ${java.trim()}.`);
    console.log(`[${label}] ${java.trim()}`);
  }
  if (platform === 'ios') {
    const version = toolchains.xcode[host];
    const key =
      host === 'bare'
        ? 'MINIMUM_BARE_DEVELOPER_DIR'
        : 'MINIMUM_EXPO_DEVELOPER_DIR';
    environment.DEVELOPER_DIR =
      process.env[key] ||
      `/Applications/Xcode_${version}.app/Contents/Developer`;
    if (!existsSync(environment.DEVELOPER_DIR))
      throw new Error(
        `Install Xcode ${version} and set ${key} to its Contents/Developer directory (missing ${environment.DEVELOPER_DIR}).`,
      );
    const actual = run('xcodebuild', ['-version'], root, true);
    if (!actual.startsWith(`Xcode ${version}\n`))
      throw new Error(
        `Expected Xcode ${version}; selected ${actual.trim()}. Set ${key} to the matching toolchain.`,
      );
    console.log(`[${label}] ${actual.trim()}`);
    try {
      run('pod', [`_${toolchains.cocoaPods}_`, '--version'], root, true);
    } catch (error) {
      throw new Error(
        `Install CocoaPods with gem install cocoapods --version ${toolchains.cocoaPods} --no-document. ${error.message}`,
      );
    }
  }
  mkdirSync(join(root, 'build'), { recursive: true });
  const work = mkdtempSync(join(root, 'build', `minimum-${host}-${platform}-`));
  console.log(`[${label}] work directory: ${work}`);
  const app = join(work, 'app');
  cpSync(join(root, 'minimum-fixtures', host), app, { recursive: true });
  run('npm', ['ci', '--no-audit', '--no-fund'], app);
  let appName = 'EDOTMinimumExpo';
  if (host === 'bare') {
    appName = 'HelloWorld';
    const template = join(
      app,
      'node_modules',
      '@react-native-community',
      'template',
      'template',
    );
    for (const input of [
      'android',
      'ios',
      'app.json',
      'metro.config.js',
      'babel.config.js',
    ])
      cpSync(join(template, input), join(app, input), { recursive: true });
    // RN 0.80.0 template; these two inputs implement the documented host requirements.
    edit(
      join(app, 'android/build.gradle'),
      'compileSdkVersion = 35',
      'compileSdkVersion = 36',
    );
    edit(
      join(app, 'android/build.gradle'),
      'minSdkVersion = 24',
      'minSdkVersion = 26',
    );
    cpSync(join(app, 'ios/_xcode.env'), join(app, 'ios/.xcode.env'));
  }
  if (!baseline) {
    const packageDirectory = join(work, 'package');
    mkdirSync(packageDirectory);
    const manifest = JSON.parse(readFileSync(join(root, 'package.json')));
    for (const input of [...manifest.files, 'package.json']) {
      if (input !== 'lib')
        cpSync(join(root, input), join(packageDirectory, input), {
          recursive: true,
        });
    }
    // Lifecycle scripts compile the snapshot with shared read-only development tools.
    cpSync(
      join(root, 'tsconfig.json'),
      join(packageDirectory, 'tsconfig.json'),
    );
    symlinkSync(
      join(root, 'node_modules'),
      join(packageDirectory, 'node_modules'),
      'dir',
    );
    const packed = JSON.parse(
      run(
        'npm',
        ['pack', '--json', '--pack-destination', work],
        packageDirectory,
        true,
      ),
    );
    run(
      'npm',
      ['install', '--no-audit', '--no-fund', join(work, packed[0].filename)],
      app,
    );
    const sdk = JSON.parse(
      readFileSync(
        join(app, 'node_modules/@elastic/otel-react-native/package.json'),
      ),
    );
    console.log(
      `[${label}] SDK ${sdk.version}; react-native ${JSON.parse(readFileSync(join(app, 'node_modules/react-native/package.json'))).version}${host === 'expo' ? `; expo ${JSON.parse(readFileSync(join(app, 'node_modules/expo/package.json'))).version}` : ''}`,
    );
    cpSync(
      join(root, 'minimum-fixtures/elastic-otel-config.json'),
      join(app, 'elastic-otel-config.json'),
    );
  }
  const sdkImport = baseline
    ? ''
    : "import { getStatus } from '@elastic/otel-react-native';\nvoid getStatus;\n";
  writeFileSync(
    join(app, 'index.js'),
    sdkImport +
      (host === 'bare'
        ? "import { AppRegistry } from 'react-native';\nAppRegistry.registerComponent('HelloWorld', () => () => null);\n"
        : "import { registerRootComponent } from 'expo';\nregisterRootComponent(() => null);\n"),
  );
  if (host === 'bare' && !baseline) {
    const cli = join(
      app,
      'node_modules/@elastic/otel-react-native/bin/elastic-otel-react-native.mjs',
    );
    run(
      'node',
      [cli, platform === 'android' ? 'setup-android' : 'setup-ios'],
      app,
    );
    if (platform === 'android') {
      const kotlin = join(
        app,
        'android/app/src/main/java/com/helloworld/MainApplication.kt',
      );
      edit(
        kotlin,
        'import android.app.Application',
        'import android.app.Application\nimport co.elastic.otel.reactnative.ElasticOtelReactNative',
      );
      edit(
        kotlin,
        'super.onCreate()',
        'super.onCreate()\n    ElasticOtelReactNative.initialize(this)',
      );
    } else {
      const swift = join(app, 'ios/HelloWorld/AppDelegate.swift');
      edit(
        swift,
        'import UIKit',
        'import UIKit\nimport ElasticOtelReactNative',
      );
      edit(
        swift,
        'let delegate = ReactNativeDelegate()',
        'do { try ElasticOtelReactNative.initialize() } catch { fatalError("EDOT bootstrap failed: \\(error)") }\n    let delegate = ReactNativeDelegate()',
      );
    }
    edit(
      join(app, 'babel.config.js'),
      "presets: ['module:@react-native/babel-preset'],",
      "presets: ['module:@react-native/babel-preset'],\n  plugins: ['@elastic/otel-react-native/babel-plugin'],",
    );
  }
  if (host === 'expo') {
    if (baseline) {
      const config = JSON.parse(readFileSync(join(app, 'app.json')));
      config.expo.plugins = config.expo.plugins.filter(
        (plugin) => plugin !== '@elastic/otel-react-native',
      );
      writeFileSync(join(app, 'app.json'), JSON.stringify(config, null, 2));
    }
    writeFileSync(
      join(app, 'babel.config.js'),
      `module.exports = { presets: ['babel-preset-expo']${baseline ? '' : ", plugins: ['@elastic/otel-react-native/babel-plugin']"} };\n`,
    );
    run(
      'node',
      [
        join(app, 'node_modules/expo/bin/cli'),
        'prebuild',
        '--clean',
        '--no-install',
        '--platform',
        platform,
        '--template',
        join(app, 'node_modules/expo/template.tgz'),
      ],
      app,
    );
  }
  if (platform === 'android') {
    run(
      './gradlew',
      [':app:assembleRelease', '--console=plain'],
      join(app, 'android'),
    );
  } else {
    run('pod', [`_${toolchains.cocoaPods}_`, 'install'], join(app, 'ios'));
    run(
      'xcodebuild',
      [
        'build',
        '-workspace',
        `${appName}.xcworkspace`,
        '-scheme',
        appName,
        '-configuration',
        'Release',
        '-destination',
        'generic/platform=iOS Simulator',
        '-derivedDataPath',
        join(work, 'derived-data'),
        'CODE_SIGNING_ALLOWED=NO',
      ],
      join(app, 'ios'),
    );
  }
  console.log(`[${label}] Release build passed.`);
} catch (error) {
  console.error(`[${label}] ${error.message}`);
  process.exitCode = 1;
}
