import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function runCli(projectRoot, arguments_ = []) {
  const run = spawnSync(
    process.execPath,
    [BIN, 'setup-ios', '--project-root', projectRoot, ...arguments_],
    { encoding: 'utf8' },
  );
  assert.equal(run.stderr, '');
  return {
    exitCode: run.status,
    result: JSON.parse(run.stdout),
  };
}

async function verifyAccepted(name, mutate = async () => {}) {
  const project = join(WORK, name);
  await copyDefaultTemplate(project);
  await mutate(project);
  const original = await snapshot(project);
  for (const arguments_ of [['--dry-run'], ['--check'], []]) {
    const run = runCli(project, arguments_);
    assert.equal(run.exitCode, 0);
    assert.equal(run.result.command, 'setup-ios');
    assert.equal(run.result.code, 'no-changes-required');
    assert.deepEqual(await snapshot(project), original);
  }
}

async function verifyRefusal(name, mutate) {
  const project = join(WORK, name);
  await copyDefaultTemplate(project);
  await mutate(project);
  const before = await snapshot(project);
  const attempt = runCli(project);
  assert.equal(attempt.exitCode, 2);
  assert.equal(attempt.result.code, 'unsupported-project');
  assert.deepEqual(await snapshot(project), before);
}

await rm(WORK, { recursive: true, force: true });
await mkdir(WORK, { recursive: true });
// setup-ios makes no host change: the untouched template and a
// static-frameworks Podfile are both accepted without writes.
await verifyAccepted('template');
await verifyAccepted('static-frameworks', async (project) => {
  const file = join(project, PODFILE);
  await writeFile(
    file,
    (await readFile(file, 'utf8')).replace(
      "linkage = ENV['USE_FRAMEWORKS']",
      "ENV['USE_FRAMEWORKS'] = 'static'\nlinkage = ENV['USE_FRAMEWORKS']",
    ),
  );
});
await verifyRefusal('missing-react-native', async (project) => {
  const file = join(project, 'package.json');
  const packageJson = JSON.parse(await readFile(file, 'utf8'));
  delete packageJson.dependencies['react-native'];
  await writeFile(file, `${JSON.stringify(packageJson, null, 2)}\n`);
});
await verifyRefusal('unsupported-podfile', async (project) => {
  const file = join(project, PODFILE);
  await writeFile(
    file,
    (await readFile(file, 'utf8')).replace(
      'config = use_native_modules!',
      'config = custom_native_modules!',
    ),
  );
});
console.log('iOS setup command layout and no-write tests passed.');
