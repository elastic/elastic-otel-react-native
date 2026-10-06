import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APPLY_PLUGIN_LINES,
  CLASSPATH_LINES,
  CONFIG_SCRIPT_LINE,
  PLUGIN_PORTAL_LINE,
} from '../bin/elastic-otel-react-native.mjs';
import { readEdotAndroidVersion } from './check-edot-versions.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'fixture');
const WORK = join(ROOT, 'build', 'setup-android-tests');
const EXTERNAL_FIXTURE = join(ROOT, 'build', 'external-fixture');
const BIN = join(ROOT, 'bin', 'elastic-otel-react-native.mjs');
const ROOT_BUILD = 'android/build.gradle';
const APP_BUILD = 'android/app/build.gradle';
const CONFIG_FILE = 'elastic-otel-config.json';
const APP_ANCHOR = 'apply plugin: "com.facebook.react"';
const ROOT_LINES = [PLUGIN_PORTAL_LINE, ...CLASSPATH_LINES];
const APP_LINES = [...APPLY_PLUGIN_LINES, CONFIG_SCRIPT_LINE];

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function copyFixture(destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(dirname(destination), { recursive: true });
  await cp(FIXTURE, destination, {
    recursive: true,
    filter(source) {
      return !['node_modules', '.gradle', '.kotlin', 'build', '.cxx'].includes(
        source.split('/').at(-1),
      );
    },
  });
}

async function snapshot(directory) {
  const files = {};
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (
        ['node_modules', '.gradle', '.kotlin', 'build', '.cxx'].includes(
          entry.name,
        )
      ) {
        continue;
      }
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else {
        files[relative(directory, path)] = digest(await readFile(path));
      }
    }
  }
  await visit(directory);
  return files;
}

function changedPaths(before, after) {
  return Object.keys({ ...before, ...after })
    .filter((path) => before[path] !== after[path])
    .sort();
}

function runCli(projectRoot, executable = BIN, command = 'setup-android') {
  const run =
    executable === BIN
      ? spawnSync(process.execPath, [BIN, command], {
          cwd: projectRoot,
          encoding: 'utf8',
        })
      : spawnSync(executable, [command], {
          cwd: projectRoot,
          encoding: 'utf8',
        });
  return { exitCode: run.status, output: `${run.stdout}${run.stderr}` };
}

function replaceOnce(content, search, replacement) {
  assert.equal(content.split(search).length, 2, `one ${search.trim()}`);
  return content.replace(search, replacement);
}

// The fixture files with the setup lines added by hand at their anchors.
async function expectedContent() {
  const root = await readFile(join(FIXTURE, ROOT_BUILD), 'utf8');
  const app = await readFile(join(FIXTURE, APP_BUILD), 'utf8');
  const indented = (lines, indentation) =>
    lines.map((line) => `${indentation}${line}\n`).join('');
  const classpathAnchor =
    '        classpath("com.android.tools.build:gradle")\n';
  return {
    [ROOT_BUILD]: replaceOnce(
      replaceOnce(
        root,
        '        mavenCentral()\n',
        `        mavenCentral()\n${indented([PLUGIN_PORTAL_LINE], '        ')}`,
      ),
      classpathAnchor,
      `${classpathAnchor}${indented(CLASSPATH_LINES, '        ')}`,
    ),
    [APP_BUILD]: replaceOnce(
      app,
      `${APP_ANCHOR}\n`,
      `${APP_ANCHOR}\n${indented(APP_LINES, '')}`,
    ),
  };
}

async function assertConfigured(projectRoot, paths = [ROOT_BUILD, APP_BUILD]) {
  const expected = await expectedContent();
  for (const path of paths) {
    assert.equal(
      await readFile(join(projectRoot, path), 'utf8'),
      expected[path],
    );
  }
}

async function adjustExternalPackageLink(projectRoot) {
  const packagePath = join(projectRoot, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  packageJson.dependencies['@elastic/otel-react-native'] = 'file:../..';
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const lockPath = join(projectRoot, 'package-lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.packages[''].dependencies['@elastic/otel-react-native'] = 'file:../..';
  lock.packages['../..'] = lock.packages['..'];
  delete lock.packages['..'];
  lock.packages['node_modules/@elastic/otel-react-native'].resolved = '../..';
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

// Installs the packed package into an external fixture copy, runs the
// installed command there, and builds it. npm run fixture:build then builds
// the same set-up project.
async function verifySupportedFlow() {
  await copyFixture(EXTERNAL_FIXTURE);
  await adjustExternalPackageLink(EXTERNAL_FIXTURE);
  const install = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], {
    cwd: EXTERNAL_FIXTURE,
    encoding: 'utf8',
  });
  assert.equal(install.status, 0, install.stderr || install.stdout);
  const packed = spawnSync(
    'npm',
    ['pack', '--json', '--pack-destination', join(ROOT, 'build')],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const [{ filename }] = JSON.parse(packed.stdout);
  const installPacked = spawnSync(
    'npm',
    [
      'install',
      '--no-save',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      join(ROOT, 'build', filename),
    ],
    { cwd: EXTERNAL_FIXTURE, encoding: 'utf8' },
  );
  assert.equal(
    installPacked.status,
    0,
    installPacked.stderr || installPacked.stdout,
  );
  const fixtureRequire = createRequire(join(EXTERNAL_FIXTURE, 'package.json'));
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
  const installedBin = join(
    EXTERNAL_FIXTURE,
    'node_modules',
    '.bin',
    process.platform === 'win32'
      ? 'elastic-otel-react-native.cmd'
      : 'elastic-otel-react-native',
  );
  const installedBinMetadata = await lstat(installedBin);
  assert.ok(
    installedBinMetadata.isFile() || installedBinMetadata.isSymbolicLink(),
  );
  // npm run fixture:ios:build builds this project with the reference that
  // setup-ios adds.
  const iosRun = runCli(EXTERNAL_FIXTURE, installedBin, 'setup-ios');
  assert.equal(iosRun.exitCode, 0, iosRun.output);
  assert.match(
    iosRun.output,
    /Updated ios\/EDOTReactNativeFixture\.xcodeproj\/project\.pbxproj\n/,
  );

  // Fresh project: both files gain the lines, and no EDOT version.
  const original = await snapshot(EXTERNAL_FIXTURE);
  const setup = runCli(EXTERNAL_FIXTURE, installedBin);
  assert.equal(setup.exitCode, 0, setup.output);
  assert.match(setup.output, /Updated android\/build\.gradle\n/);
  assert.match(setup.output, /Updated android\/app\/build\.gradle\n/);
  assert.match(setup.output, /Review the changes with git diff\./);
  await assertConfigured(EXTERNAL_FIXTURE);
  const configured = await snapshot(EXTERNAL_FIXTURE);
  assert.deepEqual(changedPaths(original, configured), [APP_BUILD, ROOT_BUILD]);
  const edotAndroidVersion = await readEdotAndroidVersion();
  for (const path of [ROOT_BUILD, APP_BUILD]) {
    assert.ok(
      !(await readFile(join(EXTERNAL_FIXTURE, path), 'utf8')).includes(
        edotAndroidVersion,
      ),
      `${path} contains the EDOT Android version`,
    );
  }

  // Rerun: nothing changes.
  const rerun = runCli(EXTERNAL_FIXTURE, installedBin);
  assert.equal(rerun.exitCode, 0, rerun.output);
  assert.match(rerun.output, /already configured/);
  assert.deepEqual(await snapshot(EXTERNAL_FIXTURE), configured);

  const assembleDebug = () => {
    const assembled = spawnSync(
      process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
      [':app:assembleDebug'],
      {
        cwd: join(EXTERNAL_FIXTURE, 'android'),
        encoding: 'utf8',
      },
    );
    assert.equal(assembled.status, 0, assembled.stderr || assembled.stdout);
    const listed = spawnSync(
      'unzip',
      [
        '-l',
        join(
          EXTERNAL_FIXTURE,
          'android/app/build/outputs/apk/debug/app-debug.apk',
        ),
      ],
      { encoding: 'utf8' },
    );
    assert.equal(listed.status, 0, listed.stderr || listed.stdout);
    return listed.stdout;
  };
  assert.match(assembleDebug(), /\sassets\/elastic-otel-config\.json\n/);

  // The copy task syncs its output directory, so a file left there by an
  // earlier build, such as a renamed configuration file, is not packaged
  // when the configuration file changes.
  const configFile = join(EXTERNAL_FIXTURE, CONFIG_FILE);
  await writeFile(configFile, `${await readFile(configFile, 'utf8')}\n`);
  await writeFile(
    join(
      EXTERNAL_FIXTURE,
      'android/app/build/generated/elasticOtel/assets/stale.json',
    ),
    '{}\n',
  );
  const rebuilt = assembleDebug();
  assert.match(rebuilt, /\sassets\/elastic-otel-config\.json\n/);
  assert.doesNotMatch(rebuilt, /\sassets\/stale\.json\n/);
}

async function verifyPartlyConfigured() {
  const project = join(WORK, 'partly-configured');
  await copyFixture(project);
  const app = join(project, APP_BUILD);
  await writeFile(
    app,
    replaceOnce(
      await readFile(app, 'utf8'),
      `${APP_ANCHOR}\n`,
      `${APP_ANCHOR}\n${APP_LINES.join('\n')}\n`,
    ),
  );
  const before = await snapshot(project);

  const run = runCli(project);
  assert.equal(run.exitCode, 0, run.output);
  assert.match(run.output, /Updated android\/build\.gradle\n/);
  assert.doesNotMatch(run.output, /android\/app\/build\.gradle/);
  assert.deepEqual(changedPaths(before, await snapshot(project)), [ROOT_BUILD]);
  await assertConfigured(project);
  for (const [path, lines] of [
    [ROOT_BUILD, ROOT_LINES],
    [APP_BUILD, APP_LINES],
  ]) {
    const content = (await readFile(join(project, path), 'utf8')).split('\n');
    for (const line of lines) {
      assert.equal(
        content.filter((candidate) => candidate.trim() === line).length,
        1,
        `${path}: ${line}`,
      );
    }
  }
}

// A group line above its anchor does not pull the missing lines away from
// the anchor.
async function verifyGroupLineAboveAnchor() {
  const project = join(WORK, 'group-line-above-anchor');
  await copyFixture(project);
  const root = join(project, ROOT_BUILD);
  const [presentLine, ...missingLines] = CLASSPATH_LINES;
  await writeFile(root, `${presentLine}\n${await readFile(root, 'utf8')}`);

  const run = runCli(project);
  assert.equal(run.exitCode, 0, run.output);
  const content = (await readFile(root, 'utf8')).split('\n');
  const anchorIndex = content.indexOf(
    '        classpath("com.android.tools.build:gradle")',
  );
  assert.deepEqual(
    content.slice(anchorIndex + 1, anchorIndex + 1 + missingLines.length),
    missingLines.map((line) => `        ${line}`),
  );
  assert.equal(content.filter((line) => line.trim() === presentLine).length, 1);
}

async function verifyMissingAnchor() {
  const project = join(WORK, 'missing-anchor');
  await copyFixture(project);
  const app = join(project, APP_BUILD);
  await writeFile(
    app,
    replaceOnce(await readFile(app, 'utf8'), `${APP_ANCHOR}\n`, ''),
  );
  const before = await snapshot(project);

  const run = runCli(project);
  assert.equal(run.exitCode, 1, run.output);
  assert.deepEqual(await snapshot(project), before);
  assert.match(run.output, /No file was changed\./);
  assert.match(run.output, /\nandroid\/build\.gradle:\n/);
  assert.match(run.output, /\nandroid\/app\/build\.gradle:\n/);
  for (const line of [...ROOT_LINES, ...APP_LINES]) {
    assert.ok(run.output.includes(`    ${line}\n`), line);
  }
  assert.match(run.output, /Manual host setup fallback/);
}

async function verifySymlinkedAppFile() {
  const project = join(WORK, 'symlinked-app-file');
  await copyFixture(project);
  const target = join(project, 'android', 'app.build.gradle');
  await rename(join(project, APP_BUILD), target);
  await symlink(target, join(project, APP_BUILD));

  const run = runCli(project);
  assert.equal(run.exitCode, 0, run.output);
  assert.ok((await lstat(join(project, APP_BUILD))).isSymbolicLink());
  assert.equal(
    await readFile(target, 'utf8'),
    (await expectedContent())[APP_BUILD],
  );
}

async function verifyWriteFailure() {
  if (process.getuid?.() === 0) {
    console.log(
      'Skipping the write-failure test: root ignores directory permissions.',
    );
    return;
  }
  const project = join(WORK, 'write-failure');
  await copyFixture(project);
  const appDirectory = join(project, 'android', 'app');
  const appBefore = await readFile(join(project, APP_BUILD), 'utf8');
  const entriesBefore = (await readdir(appDirectory)).sort();
  await chmod(appDirectory, 0o555);
  let run;
  try {
    run = runCli(project);
  } finally {
    await chmod(appDirectory, 0o755);
  }

  assert.equal(run.exitCode, 1, run.output);
  assert.match(run.output, /Updated android\/build\.gradle\./);
  assert.match(run.output, /Failed to update android\/app\/build\.gradle: /);
  await assertConfigured(project, [ROOT_BUILD]);
  assert.equal(await readFile(join(project, APP_BUILD), 'utf8'), appBefore);
  assert.deepEqual((await readdir(appDirectory)).sort(), entriesBefore);
}

await rm(WORK, { recursive: true, force: true });
await mkdir(WORK, { recursive: true });
await verifySupportedFlow();
await verifyPartlyConfigured();
await verifyGroupLineAboveAnchor();
await verifyMissingAnchor();
await verifySymlinkedAppFile();
await verifyWriteFailure();

console.log(
  `Setup command tests passed; configured external fixture: ${relative(ROOT, EXTERNAL_FIXTURE)}`,
);
