import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
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
  CONFIG_SCRIPT_LINE,
  EDOT_VERSION,
  PLUGINS,
  executeSetup,
} from '../bin/elastic-otel-react-native.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'fixture');
const WORK = join(ROOT, 'build', 'setup-android-tests');
const EXTERNAL_FIXTURE = join(ROOT, 'build', 'external-fixture');
const BIN = join(ROOT, 'bin', 'elastic-otel-react-native.mjs');
const ROOT_BUILD = 'android/build.gradle';
const APP_BUILD = 'android/app/build.gradle';
const CONFIG_FILE = 'elastic-otel-config.json';

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

async function snapshotHostTooling(projectRoot) {
  const rootBuild = await readFile(join(projectRoot, ROOT_BUILD), 'utf8');
  const appBuild = await readFile(join(projectRoot, APP_BUILD), 'utf8');
  return {
    packageJson: await readFile(join(projectRoot, 'package.json'), 'utf8'),
    wrapper: await readFile(
      join(projectRoot, 'android/gradle/wrapper/gradle-wrapper.properties'),
      'utf8',
    ),
    featureFlags: await readFile(
      join(projectRoot, 'android/gradle.properties'),
      'utf8',
    ),
    settings: await readFile(
      join(projectRoot, 'android/settings.gradle'),
      'utf8',
    ),
    rootDeclarations: rootBuild
      .split(/\r?\n/)
      .filter((line) =>
        /buildToolsVersion|minSdkVersion|compileSdkVersion|targetSdkVersion|ndkVersion|kotlinVersion|classpath\(/.test(
          line,
        ),
      ),
    appDeclarations: appBuild
      .split(/\r?\n/)
      .filter((line) =>
        /buildToolsVersion|compileSdk|minSdkVersion|targetSdkVersion/.test(
          line,
        ),
      ),
  };
}

function runCli(
  projectRoot,
  arguments_ = [],
  executable = BIN,
  setupCommand = 'setup-android',
) {
  const command = executable === BIN ? process.execPath : executable;
  const commandArguments =
    executable === BIN
      ? [executable, setupCommand, '--project-root', projectRoot, ...arguments_]
      : [setupCommand, '--project-root', projectRoot, ...arguments_];
  const run = spawnSync(command, commandArguments, { encoding: 'utf8' });
  assert.equal(run.stderr, '');
  return {
    exitCode: run.status,
    result: JSON.parse(run.stdout),
  };
}

async function insertAfter(file, anchor, lines) {
  const content = await readFile(file, 'utf8');
  assert.ok(content.includes(anchor));
  await writeFile(
    file,
    content.replace(anchor, `${anchor}\n${lines.join('\n')}`),
  );
}

async function manuallyConfigurePlugins(projectRoot) {
  await insertRootPluginBlock(
    projectRoot,
    PLUGINS.map(
      (plugin) => `    id("${plugin}") version "${EDOT_VERSION}" apply false`,
    ),
  );
  await insertAfter(
    join(projectRoot, APP_BUILD),
    'apply plugin: "com.facebook.react"',
    PLUGINS.map((plugin) => `apply plugin: "${plugin}"`),
  );
}

async function manuallyConfigure(projectRoot) {
  await manuallyConfigurePlugins(projectRoot);
  await insertAfter(
    join(projectRoot, APP_BUILD),
    `apply plugin: "${PLUGINS.at(-1)}"`,
    [CONFIG_SCRIPT_LINE],
  );
}

function assertConfigScriptAppliedOnceAfterPlugins(appBuild) {
  const lines = appBuild.split(/\r?\n/);
  assert.equal(lines.filter((line) => line === CONFIG_SCRIPT_LINE).length, 1);
  const lastPluginIndex = lines.findLastIndex((line) =>
    PLUGINS.some((plugin) => line === `apply plugin: "${plugin}"`),
  );
  assert.equal(lines[lastPluginIndex + 1], CONFIG_SCRIPT_LINE);
}

async function insertRootPluginBlock(projectRoot, lines) {
  const file = join(projectRoot, ROOT_BUILD);
  const content = await readFile(file, 'utf8');
  const anchor = '\n\napply plugin: "com.facebook.react.rootproject"';
  assert.ok(content.includes(anchor));
  await writeFile(
    file,
    content.replace(anchor, `\n\nplugins {\n${lines.join('\n')}\n}${anchor}`),
  );
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
  const iosCheck = runCli(
    EXTERNAL_FIXTURE,
    ['--check'],
    installedBin,
    'setup-ios',
  );
  assert.equal(iosCheck.exitCode, 0);
  assert.equal(iosCheck.result.command, 'setup-ios');
  assert.equal(iosCheck.result.code, 'no-changes-required');
  const original = await snapshot(EXTERNAL_FIXTURE);
  const originalHostTooling = await snapshotHostTooling(EXTERNAL_FIXTURE);

  const dryRun = runCli(EXTERNAL_FIXTURE, ['--dry-run'], installedBin);
  assert.equal(dryRun.exitCode, 0);
  assert.equal(dryRun.result.code, 'changes-planned');
  assert.deepEqual(
    dryRun.result.files.map((file) => file.status),
    ['planned', 'planned'],
  );
  assert.deepEqual(
    dryRun.result.checks.map((check) => check.status),
    ['verified', 'verified'],
  );
  assert.deepEqual(dryRun.result.files[0].edit.insertedLines, [
    'plugins {',
    ...PLUGINS.map(
      (plugin) => `id("${plugin}") version "${EDOT_VERSION}" apply false`,
    ),
    '}',
  ]);
  assert.deepEqual(dryRun.result.files[1].edit.insertedLines, [
    ...PLUGINS.map((plugin) => `apply plugin: "${plugin}"`),
    CONFIG_SCRIPT_LINE,
  ]);
  assert.deepEqual(await snapshot(EXTERNAL_FIXTURE), original);

  const checkBefore = runCli(EXTERNAL_FIXTURE, ['--check'], installedBin);
  assert.equal(checkBefore.exitCode, 2);
  assert.equal(checkBefore.result.code, 'setup-required');
  assert.deepEqual(await snapshot(EXTERNAL_FIXTURE), original);

  const apply = runCli(EXTERNAL_FIXTURE, [], installedBin);
  assert.equal(apply.exitCode, 0);
  assert.equal(apply.result.code, 'changes-applied');
  assert.deepEqual(
    apply.result.files.map((file) => file.status),
    ['applied', 'applied'],
  );

  const configuredRoot = await readFile(
    join(EXTERNAL_FIXTURE, ROOT_BUILD),
    'utf8',
  );
  const configuredApp = await readFile(
    join(EXTERNAL_FIXTURE, APP_BUILD),
    'utf8',
  );
  assert.equal(PLUGINS.length, 3);
  assert.ok(PLUGINS.includes('co.elastic.otel.android.instrumentation.crash'));
  for (const plugin of PLUGINS) {
    assert.ok(
      configuredRoot.includes(
        `id("${plugin}") version "${EDOT_VERSION}" apply false`,
      ),
    );
    assert.ok(configuredApp.includes(`apply plugin: "${plugin}"`));
  }
  assertConfigScriptAppliedOnceAfterPlugins(configuredApp);

  const configured = await snapshot(EXTERNAL_FIXTURE);
  assert.deepEqual(
    await snapshotHostTooling(EXTERNAL_FIXTURE),
    originalHostTooling,
  );
  const changedPaths = Object.keys(configured).filter(
    (path) => configured[path] !== original[path],
  );
  assert.deepEqual(changedPaths.sort(), [APP_BUILD, ROOT_BUILD].sort());

  const applyAgain = runCli(EXTERNAL_FIXTURE, [], installedBin);
  assert.equal(applyAgain.exitCode, 0);
  assert.equal(applyAgain.result.code, 'already-configured');
  assert.deepEqual(await snapshot(EXTERNAL_FIXTURE), configured);

  const checkAfter = runCli(EXTERNAL_FIXTURE, ['--check'], installedBin);
  assert.equal(checkAfter.exitCode, 0);
  assert.equal(checkAfter.result.code, 'already-configured');
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

async function verifyConfigScriptOnlyHost() {
  // A host that already applies the plugins gains only the script line.
  const project = join(WORK, 'config-script-only');
  await copyFixture(project);
  await manuallyConfigurePlugins(project);
  const before = await snapshot(project);

  const check = runCli(project, ['--check']);
  assert.equal(check.exitCode, 2);
  assert.equal(check.result.code, 'setup-required');
  assert.deepEqual(
    check.result.files.map((file) => file.status),
    ['no-op', 'planned'],
  );
  assert.deepEqual(check.result.files[1].edit, {
    afterLine: `apply plugin: "${PLUGINS.at(-1)}"`,
    insertedLines: [CONFIG_SCRIPT_LINE],
  });

  const apply = runCli(project);
  assert.equal(apply.exitCode, 0);
  assert.equal(apply.result.code, 'changes-applied');
  const after = await snapshot(project);
  const changedPaths = Object.keys(after).filter(
    (path) => after[path] !== before[path],
  );
  assert.deepEqual(changedPaths, [APP_BUILD]);
  const appBuild = await readFile(join(project, APP_BUILD), 'utf8');
  assertConfigScriptAppliedOnceAfterPlugins(appBuild);

  const applyAgain = runCli(project);
  assert.equal(applyAgain.exitCode, 0);
  assert.equal(applyAgain.result.code, 'already-configured');
  assert.deepEqual(await snapshot(project), after);
}

async function verifyRefusal(name, mutate, expectedCode) {
  const project = join(WORK, name);
  await copyFixture(project);
  await mutate(project);
  const before = await snapshot(project);
  const attempt = runCli(project);
  assert.equal(attempt.exitCode, 2);
  assert.equal(attempt.result.code, expectedCode);
  assert.deepEqual(await snapshot(project), before);
  return attempt.result;
}

async function verifyOlderHostAccepted() {
  // Host versions are not gated: an older React Native toolchain is set up,
  // and the native build reports any floor the bridge's metadata declares.
  const project = join(WORK, 'older-host');
  await copyFixture(project);
  const packagePath = join(project, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  packageJson.dependencies['react-native'] = '0.86.0';
  packageJson.dependencies.react = '19.2.0';
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  const rootBuild = join(project, ROOT_BUILD);
  for (const [search, replacement] of [
    ['minSdkVersion = 26', 'minSdkVersion = 24'],
    ['buildToolsVersion = "37.0.0"', 'buildToolsVersion = "36.0.0"'],
    ['compileSdkVersion = 37', 'compileSdkVersion = 36'],
    ['kotlinVersion = "2.2.0"', 'kotlinVersion = "2.1.20"'],
  ]) {
    await replaceInFile(rootBuild, search, replacement);
  }
  await replaceInFile(
    join(project, 'android/gradle/wrapper/gradle-wrapper.properties'),
    'gradle-9.4.1-bin.zip',
    'gradle-9.3.1-bin.zip',
  );
  const attempt = runCli(project);
  assert.equal(attempt.exitCode, 0);
  assert.equal(attempt.result.code, 'changes-applied');
}

async function replaceInFile(file, search, replacement) {
  const content = await readFile(file, 'utf8');
  assert.ok(content.includes(search));
  await writeFile(file, content.replace(search, replacement));
}

async function verifyStaleInspection() {
  const project = join(WORK, 'stale');
  await copyFixture(project);
  const rootBefore = await readFile(join(project, ROOT_BUILD), 'utf8');
  const appBefore = await readFile(join(project, APP_BUILD), 'utf8');
  const externallyChanged = `${appBefore}\n// external concurrent edit\n`;

  const setupResult = await executeSetup({
    projectRoot: project,
    beforeMutation: async () => {
      await writeFile(join(project, APP_BUILD), externallyChanged);
    },
  });

  assert.equal(setupResult.outcome, 'refused');
  assert.equal(setupResult.code, 'stale-inspection');
  assert.deepEqual(setupResult.partialEffects, []);
  assert.equal(await readFile(join(project, ROOT_BUILD), 'utf8'), rootBefore);
  assert.equal(
    await readFile(join(project, APP_BUILD), 'utf8'),
    externallyChanged,
  );
  await writeFile(join(project, APP_BUILD), appBefore);
}

async function verifySameContentReplacement() {
  const project = join(WORK, 'stale-same-content');
  await copyFixture(project);
  const before = await snapshot(project);
  const app = join(project, APP_BUILD);

  const setupResult = await executeSetup({
    projectRoot: project,
    beforeMutation: async () => {
      const replacement = `${app}.replacement`;
      await writeFile(replacement, await readFile(app));
      await rename(replacement, app);
    },
  });

  assert.equal(setupResult.outcome, 'refused');
  assert.equal(setupResult.code, 'stale-inspection');
  assert.deepEqual(setupResult.partialEffects, []);
  assert.deepEqual(await snapshot(project), before);
}

async function verifyStaleSupportInputs() {
  const cases = [
    {
      name: 'package',
      path: 'package.json',
      mutate: async (file) => {
        const packageJson = JSON.parse(await readFile(file, 'utf8'));
        packageJson.dependencies['react-native'] = '0.85.0';
        await writeFile(file, `${JSON.stringify(packageJson, null, 2)}\n`);
      },
    },
    {
      name: 'settings',
      path: 'android/settings.gradle',
      mutate: async (file) =>
        writeFile(file, `${await readFile(file, 'utf8')}\n// changed\n`),
    },
  ];

  for (const staleCase of cases) {
    const project = join(WORK, `stale-support-${staleCase.name}`);
    await copyFixture(project);
    const before = await snapshot(project);
    const setupResult = await executeSetup({
      projectRoot: project,
      beforeMutation: async () =>
        staleCase.mutate(join(project, staleCase.path)),
    });

    assert.equal(setupResult.outcome, 'refused');
    assert.equal(setupResult.code, 'stale-inspection');
    assert.deepEqual(setupResult.partialEffects, []);
    assert.equal(
      setupResult.checks.find((check) => check.path === staleCase.path).status,
      'refused',
    );
    const after = await snapshot(project);
    assert.equal(after[ROOT_BUILD], before[ROOT_BUILD]);
    assert.equal(after[APP_BUILD], before[APP_BUILD]);
  }
}

async function verifyParentSymlinkRefusal() {
  const project = join(WORK, 'parent-symlink');
  const outside = join(WORK, 'parent-symlink-outside');
  await copyFixture(project);
  await copyFixture(outside);
  await rm(join(project, 'android'), { recursive: true });
  await symlink(join(outside, 'android'), join(project, 'android'), 'dir');
  const outsideBefore = await snapshot(outside);

  const attempt = runCli(project);
  assert.equal(attempt.exitCode, 2);
  assert.equal(attempt.result.code, 'unsupported-project');
  assert.deepEqual(await snapshot(outside), outsideBefore);
}

async function verifyStaleParentSymlinkRefusal() {
  const project = join(WORK, 'stale-parent-symlink');
  const outside = join(WORK, 'stale-parent-symlink-outside');
  await copyFixture(project);
  await copyFixture(outside);
  const outsideBefore = await snapshot(outside);

  const setupResult = await executeSetup({
    projectRoot: project,
    beforeMutation: async () => {
      await rm(join(project, 'android'), { recursive: true });
      await symlink(join(outside, 'android'), join(project, 'android'), 'dir');
    },
  });

  assert.equal(setupResult.outcome, 'refused');
  assert.equal(setupResult.code, 'stale-inspection');
  assert.deepEqual(setupResult.partialEffects, []);
  assert.deepEqual(await snapshot(outside), outsideBefore);
}

async function verifyWriteFailure() {
  const project = join(WORK, 'write-failure');
  await copyFixture(project);
  const appBefore = await readFile(join(project, APP_BUILD), 'utf8');

  const setupResult = await executeSetup({
    projectRoot: project,
    beforeFileWrite: async ({ index }) => {
      if (index === 1) {
        throw new Error('injected second-file failure');
      }
    },
  });

  assert.equal(setupResult.outcome, 'failure');
  assert.equal(setupResult.code, 'write-failed');
  assert.deepEqual(setupResult.partialEffects, [
    {
      path: ROOT_BUILD,
      effect: 'applied',
      afterSha256: setupResult.files[0].afterSha256,
    },
  ]);
  assert.equal(setupResult.files[0].status, 'applied');
  assert.equal(setupResult.files[1].status, 'refused');
  assert.equal(await readFile(join(project, APP_BUILD), 'utf8'), appBefore);
  for (const plugin of PLUGINS) {
    assert.match(
      await readFile(join(project, ROOT_BUILD), 'utf8'),
      new RegExp(plugin.replaceAll('.', '\\.')),
    );
  }
}

async function verifyManualFallback() {
  const manual = join(WORK, 'manual-fallback');
  await copyFixture(manual);
  await manuallyConfigure(manual);
  for (const path of [ROOT_BUILD, APP_BUILD]) {
    assert.equal(
      await readFile(join(manual, path), 'utf8'),
      await readFile(join(EXTERNAL_FIXTURE, path), 'utf8'),
    );
  }
}

await rm(WORK, { recursive: true, force: true });
await mkdir(WORK, { recursive: true });
await verifySupportedFlow();
await verifyRefusal(
  'conflicting-version',
  (project) =>
    insertRootPluginBlock(project, [
      '    id("co.elastic.otel.android.agent") version "0.0.1" apply false',
    ]),
  'unsupported-project',
);
await verifyRefusal(
  'partial-file',
  (project) =>
    insertRootPluginBlock(project, [
      `    id("co.elastic.otel.android.agent") version "${EDOT_VERSION}" apply false`,
    ]),
  'unsupported-project',
);
await verifyRefusal(
  'partial-project',
  async (project) => {
    await insertRootPluginBlock(
      project,
      PLUGINS.map(
        (plugin) => `    id("${plugin}") version "${EDOT_VERSION}" apply false`,
      ),
    );
  },
  'partial-installation',
);
await verifyRefusal(
  'malformed-project',
  async (project) => {
    const file = join(project, ROOT_BUILD);
    const content = await readFile(file, 'utf8');
    await writeFile(
      file,
      content.replace('buildscript {', 'buildscript unsupported {'),
    );
  },
  'unsupported-project',
);
await verifyRefusal(
  'missing-react-native',
  async (project) => {
    const file = join(project, 'package.json');
    const packageJson = JSON.parse(await readFile(file, 'utf8'));
    delete packageJson.dependencies['react-native'];
    await writeFile(file, `${JSON.stringify(packageJson, null, 2)}\n`);
  },
  'unsupported-project',
);
await verifyRefusal(
  'conflicting-config-script',
  async (project) => {
    await manuallyConfigurePlugins(project);
    await insertAfter(
      join(project, APP_BUILD),
      `apply plugin: "${PLUGINS.at(-1)}"`,
      ['apply from: "../elastic-otel-config.gradle"'],
    );
  },
  'unsupported-project',
);
await verifyConfigScriptOnlyHost();
await verifyOlderHostAccepted();
await verifyRefusal(
  'comments-only-settings',
  async (project) => {
    const file = join(project, 'android/settings.gradle');
    await writeFile(
      file,
      `// pluginManagement { includeBuild("../node_modules/@react-native/gradle-plugin") }
// plugins { id("com.facebook.react.settings") }
// extensions.configure(com.facebook.react.ReactSettingsExtension){ ex -> ex.autolinkLibrariesFromCommand() }
rootProject.name = 'CommentOnlyFixture'
// include ':app'
// includeBuild('../node_modules/@react-native/gradle-plugin')
`,
    );
  },
  'unsupported-project',
);
await verifyRefusal(
  'ambiguous-anchor',
  async (project) => {
    const file = join(project, APP_BUILD);
    await writeFile(
      file,
      `${await readFile(file, 'utf8')}\napply plugin: "com.facebook.react"\n`,
    );
  },
  'unsupported-project',
);
await verifyStaleInspection();
await verifySameContentReplacement();
await verifyStaleSupportInputs();
await verifyParentSymlinkRefusal();
await verifyStaleParentSymlinkRefusal();
await verifyWriteFailure();
await verifyManualFallback();

console.log(
  `Setup command tests passed; configured external fixture: ${relative(ROOT, EXTERNAL_FIXTURE)}`,
);
