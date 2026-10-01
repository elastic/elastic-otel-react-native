import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EDOT_VERSION } from '../bin/elastic-otel-react-native.mjs';

// Each platform has one source of truth for its EDOT version. Every listed
// copy must match it:
// - EDOT Android: the setup command's EDOT_VERSION. Copies: the agent-sdk
//   dependency, the tested-versions row, and the manual-setup plugin snippet.
// - EDOT iOS: the version inside the podspec's spm_dependency block. Copies:
//   the SwiftPM manifest requirement, the SwiftPM lockfile pin, and the
//   tested-versions row. scripts/validate-docs.mjs,
//   scripts/validate-package-payload.mjs, and
//   scripts/verify-fixture-autolinking.mjs read it through readEdotIosVersion.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = 'bin/elastic-otel-react-native.mjs';
const LIBRARY = 'android/library/build.gradle';
const PODSPEC = 'ElasticOtelReactNative.podspec';
const PACKAGE_SWIFT = 'ios/Package.swift';
const PACKAGE_RESOLVED = 'ios/Package.resolved';
const GETTING_STARTED = 'docs/reference/edot-react-native/getting-started.md';
const EDOT_IOS_URL = 'https://github.com/elastic/apm-agent-ios.git';

async function load(path) {
  try {
    return await readFile(join(ROOT, path), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function captures(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

function podspecEdotIosVersions(podspec) {
  return [...podspec.matchAll(/spm_dependency\(([\s\S]*?)\n\s*\)/g)]
    .map((match) => match[1])
    .filter((block) => block.includes(`url: '${EDOT_IOS_URL}'`))
    .flatMap((block) => captures(block, /version: '([^']+)'/g));
}

function resolvedEdotIosVersions(resolved) {
  try {
    return JSON.parse(resolved)
      .pins.filter(({ identity }) => identity === 'apm-agent-ios')
      .map(({ state }) => state.version);
  } catch {
    return [];
  }
}

export async function readEdotIosVersion() {
  const podspec = await load(PODSPEC);
  const versions = podspec === null ? [] : podspecEdotIosVersions(podspec);
  if (versions.length !== 1) {
    throw new Error(
      `${PODSPEC} must declare exactly one EDOT iOS spm_dependency version.`,
    );
  }
  return versions[0];
}

const PLATFORMS = [
  {
    name: 'EDOT Android',
    source: { path: CLI, what: 'EDOT_VERSION', read: () => [EDOT_VERSION] },
    copies: [
      {
        path: LIBRARY,
        what: 'agent-sdk dependency',
        read: (text) =>
          captures(text, /"co\.elastic\.otel\.android:agent-sdk:([^"]+)"/g),
      },
      {
        path: GETTING_STARTED,
        what: 'EDOT Android tested-versions row',
        read: (text) =>
          captures(text, /^\|\s*EDOT Android\s*\|\s*([^|\s]+)\s*\|$/gm),
      },
      {
        path: GETTING_STARTED,
        what: 'manual-setup plugin declarations',
        read: (text) =>
          captures(
            text,
            /id\("co\.elastic\.otel\.android\.[a-z.]+"\) version "([^"]+)"/g,
          ),
      },
    ],
  },
  {
    name: 'EDOT iOS',
    source: {
      path: PODSPEC,
      what: 'spm_dependency version',
      read: podspecEdotIosVersions,
    },
    copies: [
      {
        path: PACKAGE_SWIFT,
        what: 'apm-agent-ios exact requirement',
        read: (text) =>
          captures(
            text,
            /url:\s*"https:\/\/github\.com\/elastic\/apm-agent-ios\.git",\s*exact:\s*"([^"]+)"/g,
          ),
      },
      {
        path: PACKAGE_RESOLVED,
        what: 'apm-agent-ios pin',
        read: resolvedEdotIosVersions,
      },
      {
        path: GETTING_STARTED,
        what: 'EDOT iOS tested-versions row',
        read: (text) =>
          captures(
            text,
            /^\|\s*EDOT iOS\s*\|\s*([^|\s]+) \(`ElasticApm` SwiftPM product\)\s*\|$/gm,
          ),
      },
    ],
  },
];

async function versionsOf({ path, read }) {
  const text = await load(path);
  return text === null ? null : read(text).filter(Boolean);
}

function describe({ path, what }, versions) {
  if (versions === null) {
    return `${path} (${what}): file not found`;
  }
  if (versions.length === 0) {
    return `${path} (${what}): no version found`;
  }
  return `${path} (${what}): ${[...new Set(versions)].join(', ')}`;
}

async function check() {
  let failed = false;
  for (const { name, source, copies } of PLATFORMS) {
    const sourceVersions = await versionsOf(source);
    if (sourceVersions === null || new Set(sourceVersions).size !== 1) {
      console.error(
        `${name} version source is invalid: ${describe(source, sourceVersions)}`,
      );
      failed = true;
      continue;
    }
    const [version] = sourceVersions;
    const mismatches = [];
    for (const copy of copies) {
      const versions = await versionsOf(copy);
      if (
        versions === null ||
        versions.length === 0 ||
        versions.some((candidate) => candidate !== version)
      ) {
        mismatches.push(describe(copy, versions));
      }
    }
    if (mismatches.length > 0) {
      console.error(
        `${name} version mismatch: ${source.path} declares ${version}, but:\n  ${mismatches.join('\n  ')}`,
      );
      failed = true;
    } else {
      console.log(
        `${name} ${version} is consistent across ${[...new Set([source.path, ...copies.map(({ path }) => path)])].join(', ')}.`,
      );
    }
  }
  if (failed) {
    process.exitCode = 1;
  }
}

// Other scripts import readEdotIosVersion; only a direct run checks.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await check();
}
