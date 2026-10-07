import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import xcode from 'xcode';

import { CONFIG_FILE_REFERENCE_PATH } from '../setup-edits.cjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'fixture');
const WORK = join(ROOT, 'build', 'setup-ios-tests');
const BIN = join(ROOT, 'bin', 'elastic-otel-react-native.mjs');
const PODFILE = 'ios/Podfile';
const PROJECT = 'ios/EDOTReactNativeFixture.xcodeproj/project.pbxproj';

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function copyDefaultTemplate(destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(dirname(destination), { recursive: true });
  await cp(FIXTURE, destination, {
    recursive: true,
    filter(source) {
      return ![
        'node_modules',
        'Pods',
        '.gradle',
        '.kotlin',
        'build',
        '.cxx',
      ].includes(source.split('/').at(-1));
    },
  });

  const podfile = join(destination, PODFILE);
  await writeFile(
    podfile,
    (await readFile(podfile, 'utf8'))
      .replace(
        "platform :ios, '16.0'",
        'platform :ios, min_ios_version_supported',
      )
      .replace("ENV['USE_FRAMEWORKS'] = 'dynamic'\n", ''),
  );
  const project = join(destination, PROJECT);
  await writeFile(
    project,
    (await readFile(project, 'utf8')).replaceAll(
      'IPHONEOS_DEPLOYMENT_TARGET = 16.0;',
      'IPHONEOS_DEPLOYMENT_TARGET = 15.1;',
    ),
  );
}

async function snapshot(directory) {
  const files = {};
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (
        [
          'node_modules',
          'Pods',
          '.gradle',
          '.kotlin',
          'build',
          '.cxx',
        ].includes(entry.name)
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

function runCli(projectRoot, arguments_ = []) {
  const run = spawnSync(process.execPath, [BIN, 'setup-ios', ...arguments_], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  return { exitCode: run.status, output: `${run.stdout}${run.stderr}` };
}

const unquote = (value) => String(value).replace(/^"(.*)"$/, '$1');

// Asserts one reference to the root configuration file, built by the
// application target's Copy Bundle Resources phase.
function assertConfigFileReference(projectRoot) {
  const project = xcode.project(join(projectRoot, PROJECT));
  project.parseSync();
  const references = Object.entries(project.pbxFileReferenceSection()).filter(
    ([, reference]) =>
      typeof reference === 'object' &&
      unquote(reference.path) === CONFIG_FILE_REFERENCE_PATH,
  );
  assert.equal(references.length, 1);
  const [[referenceId, reference]] = references;
  assert.equal(unquote(reference.sourceTree), '<group>');
  assert.equal(reference.lastKnownFileType, 'text.json');
  assert.ok(!project.writeSync().includes('undefined'));

  const buildFiles = Object.entries(project.pbxBuildFileSection())
    .filter(([, buildFile]) => buildFile.fileRef === referenceId)
    .map(([id]) => id);
  assert.equal(buildFiles.length, 1);
  const [application] = Object.values(project.pbxNativeTargetSection()).filter(
    (target) =>
      typeof target === 'object' &&
      unquote(target.productType) === 'com.apple.product-type.application',
  );
  const phases = project.hash.project.objects.PBXResourcesBuildPhase;
  const resourcePhase = application.buildPhases
    .map(({ value }) => phases[value])
    .find(Boolean);
  assert.deepEqual(
    resourcePhase.files
      .map(({ value }) => value)
      .filter((id) => buildFiles.includes(id)),
    buildFiles,
  );
}

async function verifyFreshProject(name, mutate = async () => {}) {
  const project = join(WORK, name);
  await copyDefaultTemplate(project);
  await mutate(project);
  const original = await snapshot(project);

  const run = runCli(project);
  assert.equal(run.exitCode, 0, run.output);
  assert.match(run.output, new RegExp(`Updated ${PROJECT}\n`));
  assert.match(run.output, /Review the changes with git diff\./);
  assert.match(run.output, /USE_FRAMEWORKS=dynamic/);
  const configured = await snapshot(project);
  assert.deepEqual(changedPaths(original, configured), [PROJECT]);
  assertConfigFileReference(project);

  // Rerun: nothing changes.
  const rerun = runCli(project);
  assert.equal(rerun.exitCode, 0, rerun.output);
  assert.match(rerun.output, /EDOT iOS is already configured\./);
  assert.deepEqual(await snapshot(project), configured);
}

// A reference added by hand in Xcode, here relative to the project directory,
// is detected by its path.
async function verifyHandAddedReference() {
  const project = join(WORK, 'hand-added-reference');
  await copyDefaultTemplate(project);
  const file = join(project, PROJECT);
  const content = await readFile(file, 'utf8');
  const marker = '/* Begin PBXFileReference section */\n';
  assert.equal(content.split(marker).length, 2);
  await writeFile(
    file,
    content.replace(
      marker,
      `${marker}\t\tA1B2C3D4E5F60718293A4B5C /* elastic-otel-config.json */ = {isa = PBXFileReference; lastKnownFileType = text.json; name = "elastic-otel-config.json"; path = "../elastic-otel-config.json"; sourceTree = SOURCE_ROOT; };\n`,
    ),
  );
  const before = await snapshot(project);

  const run = runCli(project);
  assert.equal(run.exitCode, 0, run.output);
  assert.match(run.output, /EDOT iOS is already configured\./);
  assert.deepEqual(await snapshot(project), before);
}

async function verifyRefusal(name, mutate, diagnostic) {
  const project = join(WORK, name);
  await copyDefaultTemplate(project);
  await mutate(project);
  const before = await snapshot(project);
  const attempt = runCli(project);
  assert.equal(attempt.exitCode, 1, attempt.output);
  assert.match(attempt.output, /No file was changed\./);
  assert.match(attempt.output, diagnostic);
  assert.match(
    attempt.output,
    /add the file at the React Native project root to the app target without copying it/,
  );
  assert.match(attempt.output, /Manual host setup fallback/);
  assert.deepEqual(await snapshot(project), before);
}

async function verifyUsage() {
  const project = join(WORK, 'usage');
  await copyDefaultTemplate(project);
  const before = await snapshot(project);
  const run = runCli(project, ['--project-root', '.']);
  assert.equal(run.exitCode, 1, run.output);
  assert.match(run.output, /^Usage: elastic-otel-react-native/);
  assert.deepEqual(await snapshot(project), before);
}

await rm(WORK, { recursive: true, force: true });
await mkdir(WORK, { recursive: true });
await verifyFreshProject('template');
await verifyFreshProject('static-frameworks', async (project) => {
  const file = join(project, PODFILE);
  await writeFile(
    file,
    (await readFile(file, 'utf8')).replace(
      "linkage = ENV['USE_FRAMEWORKS']",
      "ENV['USE_FRAMEWORKS'] = 'static'\nlinkage = ENV['USE_FRAMEWORKS']",
    ),
  );
});
await verifyHandAddedReference();
await verifyUsage();
await verifyRefusal(
  'missing-react-native',
  async (project) => {
    const file = join(project, 'package.json');
    const packageJson = JSON.parse(await readFile(file, 'utf8'));
    delete packageJson.dependencies['react-native'];
    await writeFile(file, `${JSON.stringify(packageJson, null, 2)}\n`);
  },
  /package\.json must declare a react-native dependency/,
);
await verifyRefusal(
  'unsupported-podfile',
  async (project) => {
    const file = join(project, PODFILE);
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace(
        'config = use_native_modules!',
        'config = custom_native_modules!',
      ),
    );
  },
  /Missing supported Podfile anchor/,
);
await verifyRefusal(
  'two-xcode-projects',
  async (project) => {
    await cp(
      join(project, 'ios', 'EDOTReactNativeFixture.xcodeproj'),
      join(project, 'ios', 'Second.xcodeproj'),
      { recursive: true },
    );
  },
  /Expected exactly one iOS Xcode project, found 2/,
);
await verifyRefusal(
  'unparseable-project',
  async (project) => {
    const file = join(project, PROJECT);
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace(
        '/* Begin PBXBuildFile section */',
        '/* Begin PBXBuildFile section */ {{',
      ),
    );
  },
  new RegExp(`Cannot parse ${PROJECT}`),
);
await verifyRefusal(
  'no-application-target',
  async (project) => {
    const file = join(project, PROJECT);
    const content = await readFile(file, 'utf8');
    const application = 'productType = "com.apple.product-type.application";';
    assert.equal(content.split(application).length, 2);
    await writeFile(
      file,
      content.replace(
        application,
        'productType = "com.apple.product-type.framework";',
      ),
    );
  },
  /Expected exactly one application target in .*, found 0\./,
);
console.log('iOS setup command tests passed.');
