#!/usr/bin/env node
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

import {
  chmod,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import xcode from 'xcode';

import {
  APPLY_PLUGINS_EDIT,
  CLASSPATH_LINES,
  CONFIG_FILE_REFERENCE_PATH,
  PLUGIN_PORTAL_EDIT,
  planFile,
} from '../setup-edits.cjs';

const USAGE = 'Usage: elastic-otel-react-native <setup-android|setup-ios>';
const MANUAL_SETUP_DOCS = fileURLToPath(
  new URL(
    '../docs/reference/edot-react-native/getting-started.md',
    import.meta.url,
  ),
);

const ANDROID_FILES = [
  {
    path: 'android/build.gradle',
    edits: [
      PLUGIN_PORTAL_EDIT,
      {
        anchor: /^\s*classpath\("com\.android\.tools\.build:gradle"\)\s*$/,
        after: 'classpath("com.android.tools.build:gradle")',
        lines: CLASSPATH_LINES,
      },
    ],
  },
  {
    path: 'android/app/build.gradle',
    edits: [APPLY_PLUGINS_EDIT],
  },
];

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function printManualSetupReference() {
  console.error(
    `\nSee "Manual host setup fallback" in ${relative(process.cwd(), MANUAL_SETUP_DOCS)}.`,
  );
}

function printManualLines(plans) {
  console.error('Add these lines manually:');
  for (const { path, additions } of plans) {
    if (additions.length === 0) {
      continue;
    }
    console.error(`\n${path}:`);
    for (const { after, lines } of additions) {
      console.error(`  After the line ${after}, add:`);
      for (const line of lines) {
        console.error(`    ${line}`);
      }
    }
  }
  printManualSetupReference();
}

// Writes a temporary file next to the real target and renames it over the
// target, so a symlinked build file keeps its link and a reader never sees a
// partial file.
async function atomicWrite(path, content) {
  const target = await realpath(path);
  const { mode } = await stat(target);
  const temporary = join(
    dirname(target),
    `.${basename(target)}.elastic-otel-react-native-${process.pid}.tmp`,
  );
  try {
    await writeFile(temporary, content, { mode });
    await chmod(temporary, mode);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function setupAndroid() {
  const plans = [];
  for (const { path, edits } of ANDROID_FILES) {
    const content = await readOptional(path);
    plans.push(
      content === null
        ? {
            path,
            found: false,
            additions: edits.map(({ after, lines }) => ({
              after,
              lines,
              anchored: false,
            })),
          }
        : { path, found: true, ...planFile(content, edits) },
    );
  }

  // Write nothing unless every needed anchor in both files is present.
  const problems = plans.flatMap(({ path, found, additions }) =>
    found
      ? additions
          .filter(({ anchored }) => !anchored)
          .map(({ after }) => `${path} has no line ${after}.`)
      : [`${path} was not found.`],
  );
  if (problems.length > 0) {
    console.error('No file was changed.');
    for (const problem of problems) {
      console.error(problem);
    }
    printManualLines(plans);
    return 1;
  }

  const updated = [];
  for (const { path, content, additions } of plans) {
    if (additions.length === 0) {
      continue;
    }
    try {
      await atomicWrite(path, content);
    } catch (error) {
      console.error(
        updated.length > 0
          ? `Updated ${updated.join(', ')}.`
          : 'No file was updated.',
      );
      console.error(`Failed to update ${path}: ${error.message}`);
      return 1;
    }
    updated.push(path);
  }

  if (updated.length === 0) {
    console.log('EDOT Android is already configured.');
  }
  for (const path of updated) {
    console.log(`Updated ${path}`);
  }
  console.log('Review the changes with git diff.');
  return 0;
}

function stripRubyComments(content) {
  return content
    .split(/\r?\n/)
    .map((line) => {
      let quote = null;
      let escaped = false;
      for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (quote) {
          if (escaped) {
            escaped = false;
          } else if (character === '\\') {
            escaped = true;
          } else if (character === quote) {
            quote = null;
          }
          continue;
        }
        if (character === '"' || character === "'") {
          quote = character;
        } else if (character === '#') {
          return `${line.slice(0, index)}${' '.repeat(line.length - index)}`;
        }
      }
      return line;
    })
    .join('\n');
}

const PODFILE_PATTERNS = [
  /react-native\/scripts\/react_native_pods\.rb/,
  /^\s*prepare_react_native_project!\s*$/m,
  /^\s*config\s*=\s*use_native_modules!\s*$/m,
  /^\s*use_react_native!\(\s*$/m,
  /^\s*post_install\s+do\s+\|installer\|\s*$/m,
  /^\s*react_native_post_install\(\s*$/m,
];

const IOS_HOST_STEPS = 'Install pods with USE_FRAMEWORKS=dynamic.';

// Returns the diagnostics and, when there are none, the path of the single
// Xcode project file.
async function iosDiagnostics() {
  const diagnostics = [];
  let projectPath = null;

  try {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
    if (packageJson.dependencies?.['react-native'] === undefined) {
      diagnostics.push('package.json must declare a react-native dependency.');
    }
  } catch (error) {
    diagnostics.push(`Cannot read package.json: ${error.message}`);
  }

  try {
    const projects = (await readdir('ios', { withFileTypes: true })).filter(
      (entry) => entry.isDirectory() && entry.name.endsWith('.xcodeproj'),
    );
    if (projects.length === 1) {
      projectPath = join('ios', projects[0].name, 'project.pbxproj');
      await readFile(projectPath);
    } else {
      diagnostics.push(
        `Expected exactly one iOS Xcode project, found ${projects.length}.`,
      );
    }
  } catch (error) {
    diagnostics.push(`Cannot read the iOS Xcode project: ${error.message}`);
  }

  try {
    const podfile = stripRubyComments(await readFile('ios/Podfile', 'utf8'));
    for (const pattern of PODFILE_PATTERNS) {
      if (!pattern.test(podfile)) {
        diagnostics.push(
          `Missing supported Podfile anchor matching ${pattern}.`,
        );
      }
    }
  } catch (error) {
    diagnostics.push(`Cannot read ios/Podfile: ${error.message}`);
  }

  return { diagnostics, projectPath };
}

const unquote = (value) => String(value).replace(/^"(.*)"$/, '$1');

// Adds the configuration file as a resource reference to the single
// application target, so Xcode copies it from the project root into the app
// bundle. Returns the serialized project, null when the reference already
// exists, or a diagnostic.
function planConfigFileReference(projectPath) {
  const project = xcode.project(projectPath);
  try {
    project.parseSync();
  } catch (error) {
    return { diagnostic: `Cannot parse ${projectPath}: ${error.message}` };
  }
  const references = Object.values(project.pbxFileReferenceSection());
  if (
    references.some(
      (reference) =>
        typeof reference === 'object' &&
        unquote(reference.path) === CONFIG_FILE_REFERENCE_PATH,
    )
  ) {
    return { content: null };
  }
  const applications = Object.entries(project.pbxNativeTargetSection()).filter(
    ([, target]) =>
      typeof target === 'object' &&
      unquote(target.productType) === 'com.apple.product-type.application',
  );
  if (applications.length !== 1) {
    return {
      diagnostic: `Expected exactly one application target in ${projectPath}, found ${applications.length}.`,
    };
  }

  // addResourceFile fails on projects without a Resources group, so add the
  // reference to the main group and the build phase in separate steps.
  const file = project.addFile(
    CONFIG_FILE_REFERENCE_PATH,
    project.getFirstProject().firstProject.mainGroup,
    { lastKnownFileType: 'text.json' },
  );
  file.uuid = project.generateUuid();
  file.target = applications[0][0];
  project.addToPbxBuildFileSection(file);
  project.addToPbxResourcesBuildPhase(file);
  // The library writes these unset fields as the literal text undefined.
  const reference = project.pbxFileReferenceSection()[file.fileRef];
  delete reference.fileEncoding;
  delete reference.explicitFileType;
  return { content: project.writeSync() };
}

function printManualConfigFileStep() {
  console.error(
    'Add elastic-otel-config.json manually: in Xcode, add the file at the React Native project root to the app target without copying it.',
  );
  printManualSetupReference();
}

// setup-ios checks the project layout and adds elastic-otel-config.json to the
// app target as a resource reference. The other EDOT iOS host step is in the
// getting-started guide (dynamic frameworks).
async function setupIos() {
  const { diagnostics, projectPath } = await iosDiagnostics();
  if (diagnostics.length > 0) {
    console.error('No file was changed.');
    console.error(
      'The iOS project does not match the supported bare React Native template layout.',
    );
    for (const diagnostic of diagnostics) {
      console.error(`  ${diagnostic}`);
    }
    printManualConfigFileStep();
    return 1;
  }

  const { content, diagnostic } = planConfigFileReference(projectPath);
  if (diagnostic) {
    console.error('No file was changed.');
    console.error(diagnostic);
    printManualConfigFileStep();
    return 1;
  }
  if (content === null) {
    console.log('EDOT iOS is already configured.');
  } else {
    try {
      await atomicWrite(projectPath, content);
    } catch (error) {
      console.error('No file was updated.');
      console.error(`Failed to update ${projectPath}: ${error.message}`);
      return 1;
    }
    console.log(`Updated ${projectPath}`);
    console.log('Review the changes with git diff.');
  }
  console.log(IOS_HOST_STEPS);
  return 0;
}

const COMMANDS = { 'setup-android': setupAndroid, 'setup-ios': setupIos };

async function main(arguments_) {
  const command = COMMANDS[arguments_[0]];
  if (!command || arguments_.length !== 1) {
    console.error(USAGE);
    return 1;
  }
  try {
    return await command();
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

async function isDirectInvocation() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return (
      (await realpath(process.argv[1])) ===
      (await realpath(fileURLToPath(import.meta.url)))
    );
  } catch {
    return false;
  }
}

if (await isDirectInvocation()) {
  process.exitCode = await main(process.argv.slice(2));
}
