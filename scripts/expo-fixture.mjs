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
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { verifyFixtureBabelPlugin } from './verify-fixture-babel-plugin.mjs';

import {
  APPLY_PLUGIN_LINES,
  CLASSPATH_LINES,
  CONFIG_FILE_REFERENCE_PATH,
  CONFIG_SCRIPT_LINE,
  KOTLIN_IMPORT_LINE,
  KOTLIN_INITIALIZE_LINE,
  PLUGIN_PORTAL_LINE,
  SWIFT_IMPORT_LINE,
  SWIFT_INITIALIZE_CALL,
} from '../setup-edits.cjs';

// build: prebuilds the Expo fixture with the packed package's config plugin,
// checks the generated native projects, and builds both Android Release APKs
// or the iOS Release app.
// launch: installs each Release app on the running Android emulator or on a
// temporary iOS simulator and waits for EDOT to report that it is ready.
const [MODE, PLATFORM] = process.argv.slice(2);
if (
  !['build', 'launch'].includes(MODE) ||
  !['android', 'ios'].includes(PLATFORM)
) {
  console.error(
    'Usage: node scripts/expo-fixture.mjs build|launch android|ios',
  );
  process.exit(2);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'expo-fixture');
const APK_OUTPUT = join(ROOT, 'build', 'expo-fixture-apk');
const DERIVED_DATA = join(ROOT, 'build', 'expo-fixture-derived-data');
const TEMPORARY = join(ROOT, 'build', 'expo-fixture-temporary');
const APP_NAME = 'EDOTReactNativeExpoFixture';
const APP_ID = 'co.elastic.otel.reactnative.expofixture';
const CONFIG_FILE = 'elastic-otel-config.json';
const CONFIG_PATH = join(FIXTURE, CONFIG_FILE);
const ROOT_BUILD = 'android/build.gradle';
const APP_BUILD = 'android/app/build.gradle';
const XCODE_PROJECT = `ios/${APP_NAME}.xcodeproj/project.pbxproj`;
const ANDROID_RELEASES = [
  { name: 'unshrunk', minify: false, apk: join(APK_OUTPUT, 'app-release.apk') },
  {
    name: 'minified',
    minify: true,
    apk: join(APK_OUTPUT, 'app-release-minified.apk'),
  },
];
const IOS_APP = join(
  DERIVED_DATA,
  `Build/Products/Release-iphonesimulator/${APP_NAME}.app`,
);
// expo-fixture/index.js logs this line when EDOT is ready.
const READY_LINE = 'EDOT Expo fixture status: {"ready":true}';
const TIMEOUT_SECONDS = 120;
const IOS_MAJOR_VERSION_LIMIT = 27;
const environment = {
  ...process.env,
  CI: '1',
  EXPO_NO_TELEMETRY: '1',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'safe.bareRepository',
  GIT_CONFIG_VALUE_0: 'all',
  LANG: process.env.LANG || 'en_US.UTF-8',
  TMPDIR: TEMPORARY,
};

function run(command, arguments_, cwd = FIXTURE) {
  const execution = spawnSync(command, arguments_, {
    cwd,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  return {
    status: execution.status,
    stdout: execution.stdout,
    output: `${execution.stdout}\n${execution.stderr}`,
  };
}

// Returns the standard output.
function runOrThrow(command, arguments_, cwd) {
  const { status, stdout, output } = run(command, arguments_, cwd);
  assert.equal(
    status,
    0,
    `${command} ${arguments_.join(' ')} failed.\n${output.slice(-8_000)}`,
  );
  return stdout;
}

async function findFile(directory, name) {
  for (const entry of await readdir(directory, {
    withFileTypes: true,
    recursive: true,
  })) {
    if (entry.isFile() && entry.name === name) {
      return relative(FIXTURE, join(entry.parentPath, entry.name));
    }
  }
  throw new Error(`No ${name} under ${relative(FIXTURE, directory)}.`);
}

async function assertOnce(path, expected) {
  const content = await readFile(join(FIXTURE, path), 'utf8');
  const lines = content.split('\n').map((line) => line.trim());
  for (const line of expected) {
    assert.equal(
      lines.filter((candidate) => candidate === line).length,
      1,
      `${path} must contain ${line} exactly once.`,
    );
  }
}

// Each edit of the config plugin appears exactly once.
async function assertEdits() {
  await assertOnce(ROOT_BUILD, [PLUGIN_PORTAL_LINE, ...CLASSPATH_LINES]);
  await assertOnce(APP_BUILD, [...APPLY_PLUGIN_LINES, CONFIG_SCRIPT_LINE]);
  await assertOnce(
    await findFile(
      join(FIXTURE, 'android', 'app', 'src'),
      'MainApplication.kt',
    ),
    [KOTLIN_IMPORT_LINE, KOTLIN_INITIALIZE_LINE],
  );
  await assertOnce(
    await findFile(join(FIXTURE, 'ios', APP_NAME), 'AppDelegate.swift'),
    [SWIFT_IMPORT_LINE, SWIFT_INITIALIZE_CALL],
  );
  assert.equal(
    (await readFile(join(FIXTURE, XCODE_PROJECT), 'utf8')).split(
      CONFIG_FILE_REFERENCE_PATH,
    ).length - 1,
    1,
    `${XCODE_PROJECT} must reference ${CONFIG_FILE_REFERENCE_PATH} exactly once.`,
  );
}

async function verifyAndroidDesugaringRejection() {
  const appJsonPath = join(FIXTURE, 'app.json');
  const original = await readFile(appJsonPath, 'utf8');
  const appJson = JSON.parse(original);
  const buildProperties = appJson.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
  );
  assert.equal(buildProperties[1].android.minSdkVersion, 26);
  buildProperties[1].android.minSdkVersion = 24;
  try {
    await writeFile(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);
    runOrThrow('npx', ['expo', 'prebuild', '--clean', '--no-install']);
    const paths = [APP_BUILD, 'android/gradle.properties'];
    const before = await Promise.all(
      paths.map((path) => readFile(join(FIXTURE, path), 'utf8')),
    );
    for (const content of before) {
      assert.doesNotMatch(content, /coreLibraryDesugaring/);
    }
    const rejected = run(
      './gradlew',
      [':app:processReleaseMainManifest'],
      join(FIXTURE, 'android'),
    );
    assert.notEqual(rejected.status, 0, rejected.output);
    assert.match(
      rejected.output,
      /EDOT React Native: variant 'release' has minSdk 24.*Raise minSdk to 26.*coreLibraryDesugaringEnabled.*coreLibraryDesugaring dependency/,
    );
    assert.doesNotMatch(rejected.output, /Manifest merger failed/);
    assert.deepEqual(
      await Promise.all(
        paths.map((path) => readFile(join(FIXTURE, path), 'utf8')),
      ),
      before,
    );
  } finally {
    await writeFile(appJsonPath, original);
  }
}

// Installs the packed package, as an application would, and checks prebuild.
async function prepareFixture() {
  runOrThrow('npm', ['ci', '--no-audit', '--no-fund']);
  const [{ filename }] = JSON.parse(
    runOrThrow(
      'npm',
      ['pack', '--json', '--pack-destination', join(ROOT, 'build')],
      ROOT,
    ),
  );
  const tarball = join(ROOT, 'build', filename);
  try {
    runOrThrow('npm', [
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

  verifyFixtureBabelPlugin(FIXTURE);

  // Without the configuration file, prebuild fails and names the file.
  const movedConfigFile = join(TEMPORARY, CONFIG_FILE);
  await rename(CONFIG_PATH, movedConfigFile);
  try {
    const rejected = run('npx', [
      'expo',
      'prebuild',
      '--clean',
      '--no-install',
    ]);
    assert.notEqual(rejected.status, 0, 'Prebuild without the file must fail.');
    assert.match(rejected.output, /elastic-otel-config\.json was not found/);
  } finally {
    await rename(movedConfigFile, CONFIG_PATH);
  }

  if (PLATFORM === 'android') {
    await verifyAndroidDesugaringRejection();
  }

  // Pods are installed later, because CocoaPods rewrites the Xcode project
  // file in its own format. A second prebuild over the generated projects
  // keeps each edit once.
  runOrThrow('npx', ['expo', 'prebuild', '--clean', '--no-install']);
  await assertEdits();
  runOrThrow('npx', ['expo', 'prebuild', '--no-clean', '--no-install']);
  await assertEdits();
}

// Builds unshrunk and minified Release APKs with the configuration file.
async function buildAndroid() {
  await rm(APK_OUTPUT, { recursive: true, force: true });
  const android = join(FIXTURE, 'android');
  const mappingDirectory = join(android, 'app/build/outputs/mapping/release');
  const mapping = join(mappingDirectory, 'mapping.txt');
  await rm(mappingDirectory, { recursive: true, force: true });
  const apk = join(android, 'app/build/outputs/apk/release/app-release.apk');
  await mkdir(APK_OUTPUT, { recursive: true });
  for (const release of ANDROID_RELEASES) {
    console.log(`Building Android ${release.name} Release: ${release.apk}`);
    const built = run(
      './gradlew',
      [
        ':app:assembleRelease',
        `-Pandroid.enableMinifyInReleaseBuilds=${release.minify}`,
      ],
      android,
    );
    assert.equal(
      built.status,
      0,
      `Android ${release.name} Release failed.\n${built.output.slice(-8_000)}`,
    );
    assert.doesNotMatch(built.output, /EDOT React Native:/);
    assert.equal(
      existsSync(mapping),
      release.minify,
      `Android ${release.name} Release must ${release.minify ? '' : 'not '}produce ${mapping}.`,
    );
    console.log(
      `Android ${release.name} Release: mapping.txt ${release.minify ? 'produced' : 'absent'}.`,
    );
    assert.match(
      runOrThrow('unzip', ['-l', apk]),
      /\sassets\/elastic-otel-config\.json\n/,
    );
    await cp(apk, release.apk);
  }
}

// Builds the Release simulator app, which holds the configuration file and
// the JavaScript bundle.
async function buildIos() {
  await rm(DERIVED_DATA, { recursive: true, force: true });
  const ios = join(FIXTURE, 'ios');
  runOrThrow('pod', ['install'], ios);
  runOrThrow(
    'xcodebuild',
    [
      'build',
      '-workspace',
      `${APP_NAME}.xcworkspace`,
      '-scheme',
      APP_NAME,
      '-configuration',
      'Release',
      '-destination',
      'generic/platform=iOS Simulator',
      '-derivedDataPath',
      DERIVED_DATA,
      'CODE_SIGNING_ALLOWED=NO',
    ],
    ios,
  );
  assert.equal(
    await readFile(join(IOS_APP, CONFIG_FILE), 'utf8'),
    await readFile(CONFIG_PATH, 'utf8'),
    `The app bundle does not hold ${CONFIG_FILE}.`,
  );
  assert.ok(
    (await readdir(IOS_APP)).includes('main.jsbundle'),
    'The app bundle does not hold main.jsbundle.',
  );
}

// Polls the app's log until it holds the ready line, or fails with the end of
// the log after the timeout.
async function waitForReady(readLog, label = PLATFORM) {
  const deadline = Date.now() + TIMEOUT_SECONDS * 1_000;
  let log = readLog();
  while (!log.includes(READY_LINE)) {
    if (Date.now() >= deadline) {
      const tail = log.trim().split('\n').slice(-50).join('\n');
      assert.fail(
        `${label}: "${READY_LINE}" was not logged within ${TIMEOUT_SECONDS} seconds. Last app log lines:\n${tail}`,
      );
    }
    await sleep(2_000);
    log = readLog();
  }
  console.log(`${label} launch check passed: ${READY_LINE}`);
}

// Returns the serial of the one running Android emulator.
function runningEmulator() {
  const devices = run('adb', ['devices'], ROOT);
  const emulators = devices.stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(
      ([serial, state]) => serial.startsWith('emulator-') && state === 'device',
    )
    .map(([serial]) => serial);
  assert.equal(
    emulators.length,
    1,
    `Start one Android emulator first. The Expo fixture launch check needs exactly one running emulator and found ${emulators.length}.\n${devices.output}`,
  );
  return emulators[0];
}

async function launchAndroid() {
  const serial = runningEmulator();
  const adb = (...arguments_) =>
    runOrThrow('adb', ['-s', serial, ...arguments_]);
  for (const release of ANDROID_RELEASES) {
    console.log(`Launching Android ${release.name} Release: ${release.apk}`);
    try {
      adb('install', '-r', release.apk);
      adb('logcat', '-c');
      adb('shell', 'am', 'start', '-W', '-n', `${APP_ID}/.MainActivity`);
      await waitForReady(
        () => adb('logcat', '-d', '-s', 'ReactNativeJS', 'AndroidRuntime'),
        `android ${release.name}`,
      );
    } finally {
      run('adb', ['-s', serial, 'shell', 'am', 'force-stop', APP_ID]);
      run('adb', ['-s', serial, 'uninstall', APP_ID]);
    }
  }
}

async function launchIos() {
  const runtime = JSON.parse(
    runOrThrow('xcrun', ['simctl', 'list', 'runtimes', '--json']),
  )
    .runtimes.filter(
      (candidate) =>
        candidate.platform === 'iOS' &&
        candidate.isAvailable &&
        Number.parseInt(candidate.version, 10) < IOS_MAJOR_VERSION_LIMIT,
    )
    .sort((left, right) =>
      right.version.localeCompare(left.version, undefined, { numeric: true }),
    )[0];
  assert.ok(
    runtime,
    `The Expo fixture launch check needs an iOS simulator runtime below iOS ${IOS_MAJOR_VERSION_LIMIT}.`,
  );
  const deviceType = runtime.supportedDeviceTypes
    .filter((type) => type.productFamily === 'iPhone')
    .at(-1);
  const udid = runOrThrow('xcrun', [
    'simctl',
    'create',
    'EDOT Expo fixture launch check',
    deviceType.identifier,
    runtime.identifier,
  ]).trim();
  try {
    runOrThrow('xcrun', ['simctl', 'bootstatus', udid, '-b']);
    runOrThrow('xcrun', ['simctl', 'install', udid, IOS_APP]);
    runOrThrow('xcrun', ['simctl', 'launch', udid, APP_ID]);
    await waitForReady(() =>
      runOrThrow('xcrun', [
        'simctl',
        'spawn',
        udid,
        'log',
        'show',
        '--info',
        '--style',
        'compact',
        '--predicate',
        `process == "${APP_NAME}"`,
      ]),
    );
  } finally {
    run('xcrun', ['simctl', 'shutdown', udid]);
    run('xcrun', ['simctl', 'delete', udid]);
  }
}

await mkdir(TEMPORARY, { recursive: true });
if (MODE === 'build') {
  await prepareFixture();
  await (PLATFORM === 'android' ? buildAndroid() : buildIos());
} else {
  await (PLATFORM === 'android' ? launchAndroid() : launchIos());
}
