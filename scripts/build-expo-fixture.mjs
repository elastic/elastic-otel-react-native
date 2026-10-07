import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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

// Prebuilds the Expo fixture with the packed package's config plugin, checks
// the generated native projects, and builds both apps.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'expo-fixture');
const FIXTURE = join(ROOT, 'build', 'expo-fixture');
const DERIVED_DATA = join(ROOT, 'build', 'expo-fixture-derived-data');
const TEMPORARY = join(ROOT, 'build', 'expo-fixture-temporary');
const APP_NAME = 'EDOTReactNativeExpoFixture';
const CONFIG_FILE = 'elastic-otel-config.json';
const ROOT_BUILD = 'android/build.gradle';
const APP_BUILD = 'android/app/build.gradle';
const XCODE_PROJECT = `ios/${APP_NAME}.xcodeproj/project.pbxproj`;
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

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

// The generated native projects without build outputs and installed pods.
async function snapshot() {
  const files = {};
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (
        ['.gradle', '.kotlin', '.cxx', 'build', 'Pods'].includes(entry.name)
      ) {
        continue;
      }
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else {
        files[relative(FIXTURE, path)] = digest(await readFile(path));
      }
    }
  }
  await visit(join(FIXTURE, 'android'));
  await visit(join(FIXTURE, 'ios'));
  return files;
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

// Links the copied fixture to this package, two directories up.
async function adjustPackageLink() {
  const packagePath = join(FIXTURE, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  packageJson.dependencies['@elastic/otel-react-native'] = 'file:../..';
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const lockPath = join(FIXTURE, 'package-lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.packages[''].dependencies['@elastic/otel-react-native'] = 'file:../..';
  lock.packages['../..'] = lock.packages['..'];
  delete lock.packages['..'];
  lock.packages['node_modules/@elastic/otel-react-native'].resolved = '../..';
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

await rm(FIXTURE, { recursive: true, force: true });
await rm(DERIVED_DATA, { recursive: true, force: true });
await mkdir(TEMPORARY, { recursive: true });
await cp(SOURCE, FIXTURE, {
  recursive: true,
  filter(source) {
    return !['node_modules', 'android', 'ios', '.expo'].includes(
      relative(SOURCE, source),
    );
  },
});
await adjustPackageLink();
runOrThrow('npm', ['ci', '--no-audit', '--no-fund']);

// Install the packed package, as an application would.
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

// Without the configuration file, prebuild fails and names the file.
const configFile = join(FIXTURE, CONFIG_FILE);
const movedConfigFile = join(TEMPORARY, CONFIG_FILE);
await rename(configFile, movedConfigFile);
try {
  const rejected = run('npx', ['expo', 'prebuild', '--clean', '--no-install']);
  assert.notEqual(rejected.status, 0, 'Prebuild without the file must fail.');
  assert.match(rejected.output, /elastic-otel-config\.json was not found/);
} finally {
  await rename(movedConfigFile, configFile);
}

// Each edit appears exactly once. Pods are installed before the iOS build,
// because CocoaPods rewrites the Xcode project file in its own format.
runOrThrow('npx', ['expo', 'prebuild', '--clean', '--no-install']);
await assertOnce(ROOT_BUILD, [PLUGIN_PORTAL_LINE, ...CLASSPATH_LINES]);
await assertOnce(APP_BUILD, [...APPLY_PLUGIN_LINES, CONFIG_SCRIPT_LINE]);
await assertOnce(
  await findFile(join(FIXTURE, 'android', 'app', 'src'), 'MainApplication.kt'),
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

// A second prebuild over the generated projects changes nothing. Prebuild
// recreates the native directories unless --no-clean is passed.
const prebuilt = await snapshot();
runOrThrow('npx', ['expo', 'prebuild', '--no-clean', '--no-install']);
assert.deepEqual(await snapshot(), prebuilt);

// The setup commands find the plugin's edits and change nothing.
const setupAndroid = run('npx', ['elastic-otel-react-native', 'setup-android']);
assert.equal(setupAndroid.status, 0, setupAndroid.output);
assert.match(setupAndroid.output, /EDOT Android is already configured\./);
const setupIos = run('npx', ['elastic-otel-react-native', 'setup-ios']);
assert.match(setupIos.output, /No file was changed\./);
assert.deepEqual(await snapshot(), prebuilt);

// The Android app packages the configuration file.
runOrThrow('./gradlew', [':app:assembleDebug'], join(FIXTURE, 'android'));
assert.match(
  runOrThrow('unzip', [
    '-l',
    join(FIXTURE, 'android/app/build/outputs/apk/debug/app-debug.apk'),
  ]),
  /\sassets\/elastic-otel-config\.json\n/,
);

// The iOS app bundles the configuration file.
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
    'Debug',
    '-destination',
    'generic/platform=iOS Simulator',
    '-derivedDataPath',
    DERIVED_DATA,
    'CODE_SIGNING_ALLOWED=NO',
  ],
  ios,
);
assert.equal(
  await readFile(
    join(
      DERIVED_DATA,
      `Build/Products/Debug-iphonesimulator/${APP_NAME}.app/${CONFIG_FILE}`,
    ),
    'utf8',
  ),
  await readFile(configFile, 'utf8'),
  `The app bundle does not hold ${CONFIG_FILE}.`,
);

console.log(
  'Expo fixture prebuild, setup command, Android build, and iOS simulator build checks passed.',
);
