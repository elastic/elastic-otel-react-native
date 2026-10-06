import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXTERNAL_FIXTURE = join(ROOT, 'build', 'external-fixture');
const IOS = join(EXTERNAL_FIXTURE, 'ios');
const DERIVED_DATA = join(ROOT, 'build', 'ios-fixture-derived-data');
const CONFIG_FILE = join(EXTERNAL_FIXTURE, 'elastic-otel-config.json');
const BUNDLED_CONFIG_FILE = join(
  DERIVED_DATA,
  'Build/Products/Debug-iphonesimulator/EDOTReactNativeFixture.app/elastic-otel-config.json',
);
const TEMPORARY = join(ROOT, 'build', 'ios-fixture-temporary');
rmSync(DERIVED_DATA, { recursive: true, force: true });
mkdirSync(TEMPORARY, { recursive: true });
const environment = {
  ...process.env,
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'safe.bareRepository',
  GIT_CONFIG_VALUE_0: 'all',
  LANG: process.env.LANG || 'en_US.UTF-8',
  TMPDIR: TEMPORARY,
};

function run(command, arguments_, cwd = IOS) {
  const execution = spawnSync(command, arguments_, {
    cwd,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (execution.status !== 0) {
    const output = `${execution.stdout}\n${execution.stderr}`;
    const diagnostics = output
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.includes(': error:') ||
          line.startsWith('error:') ||
          line.includes('fatal error:'),
      )
      .slice(-80)
      .join('\n');
    throw new Error(
      `${command} ${arguments_.join(' ')} failed.\n${diagnostics || output.slice(-8_000)}`,
    );
  }
}

const packed = spawnSync(
  'npm',
  ['pack', '--json', '--pack-destination', join(ROOT, 'build')],
  {
    cwd: ROOT,
    env: environment,
    encoding: 'utf8',
  },
);
if (packed.status !== 0) {
  throw new Error(packed.stderr || packed.stdout);
}
const [{ filename }] = JSON.parse(packed.stdout);
const tarball = join(ROOT, 'build', filename);
try {
  run(
    'npm',
    [
      'install',
      '--no-save',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      tarball,
    ],
    EXTERNAL_FIXTURE,
  );
  const installedPackage = realpathSync(
    join(EXTERNAL_FIXTURE, 'node_modules', '@elastic', 'otel-react-native'),
  );
  const installedRelative = relative(EXTERNAL_FIXTURE, installedPackage);
  if (
    isAbsolute(installedRelative) ||
    installedRelative === '..' ||
    installedRelative.startsWith(`..${sep}`)
  ) {
    throw new Error(
      'The iOS fixture must build the packed npm package, not a sibling checkout.',
    );
  }

  run('pod', ['install']);
  const build = () =>
    run('xcodebuild', [
      'build',
      '-workspace',
      'EDOTReactNativeFixture.xcworkspace',
      '-scheme',
      'EDOTReactNativeFixture',
      '-configuration',
      'Debug',
      '-destination',
      'generic/platform=iOS Simulator',
      '-derivedDataPath',
      DERIVED_DATA,
      'CODE_SIGNING_ALLOWED=NO',
    ]);
  // setup-ios, run on this fixture by npm run setup:test, adds the root
  // configuration file to the app target, so each build copies it into the
  // app bundle.
  const assertBundled = (expected) => {
    if (readFileSync(BUNDLED_CONFIG_FILE, 'utf8') !== expected) {
      throw new Error(
        `The app bundle does not hold the current ${CONFIG_FILE}.`,
      );
    }
  };
  build();
  const original = readFileSync(CONFIG_FILE, 'utf8');
  assertBundled(original);
  const edited = `${original}\n`;
  writeFileSync(CONFIG_FILE, edited);
  try {
    build();
    assertBundled(edited);
  } finally {
    writeFileSync(CONFIG_FILE, original);
  }
} finally {
  rmSync(tarball, { force: true });
}

console.log(
  'External iOS fixture pod install, simulator build, and bundled configuration file checks passed.',
);
