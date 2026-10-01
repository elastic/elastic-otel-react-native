import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EDOT_VERSION } from '../bin/elastic-otel-react-native.mjs';

// The setup command's EDOT_VERSION is the source of truth. These are the
// other copies that must match it:
// - android/library/build.gradle: the agent-sdk dependency.
// - docs/reference/edot-react-native/getting-started.md: the EDOT Android
//   row of the tested-versions table and the manual-setup plugin snippet.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = 'bin/elastic-otel-react-native.mjs';
const LIBRARY = 'android/library/build.gradle';
const GETTING_STARTED = 'docs/reference/edot-react-native/getting-started.md';

async function load(path) {
  return readFile(join(ROOT, path), 'utf8');
}

const library = await load(LIBRARY);
const gettingStarted = await load(GETTING_STARTED);

const sources = [
  { path: CLI, what: 'EDOT_VERSION', versions: [EDOT_VERSION] },
  {
    path: LIBRARY,
    what: 'agent-sdk dependency',
    versions: [
      ...library.matchAll(/"co\.elastic\.otel\.android:agent-sdk:([^"]+)"/g),
    ].map((match) => match[1]),
  },
  {
    path: GETTING_STARTED,
    what: 'EDOT Android tested-versions row',
    versions: [
      ...gettingStarted.matchAll(/^\|\s*EDOT Android\s*\|\s*([^|\s]+)\s*\|$/gm),
    ].map((match) => match[1]),
  },
  {
    path: GETTING_STARTED,
    what: 'manual-setup plugin declarations',
    versions: [
      ...gettingStarted.matchAll(
        /id\("co\.elastic\.otel\.android\.[a-z.]+"\) version "([^"]+)"/g,
      ),
    ].map((match) => match[1]),
  },
];

const mismatches = sources.filter(
  ({ versions }) =>
    versions.length === 0 ||
    versions.some((version) => version !== EDOT_VERSION),
);
if (mismatches.length > 0) {
  const details = mismatches
    .map(({ path, what, versions }) =>
      versions.length === 0
        ? `${path} (${what}): no version found`
        : `${path} (${what}): ${[...new Set(versions)].join(', ')}`,
    )
    .join('\n  ');
  console.error(
    `EDOT Android version mismatch: ${CLI} declares ${EDOT_VERSION}, but:\n  ${details}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `EDOT Android ${EDOT_VERSION} is consistent across ${[...new Set(sources.map(({ path }) => path))].join(', ')}.`,
  );
}
