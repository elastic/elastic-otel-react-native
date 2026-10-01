#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EDOT_VERSION = '1.10.0';
export const PLUGINS = [
  'co.elastic.otel.android.agent',
  'co.elastic.otel.android.instrumentation.okhttp',
  'co.elastic.otel.android.instrumentation.crash',
];

const TARGETS = [
  {
    path: 'android/build.gradle',
    layout: 'root',
    requiredPatterns: [
      /^\s*classpath\("com\.android\.tools\.build:gradle"\)\s*$/m,
      /^\s*classpath\("com\.facebook\.react:react-native-gradle-plugin"\)\s*$/m,
      /^\s*classpath\("org\.jetbrains\.kotlin:kotlin-gradle-plugin"\)\s*$/m,
      /^\s*apply plugin:\s*"com\.facebook\.react\.rootproject"\s*$/m,
    ],
    pluginLine(plugin, indentation) {
      return `${indentation}id("${plugin}") version "${EDOT_VERSION}" apply false`;
    },
  },
  {
    path: 'android/app/build.gradle',
    layout: 'app',
    anchor: /^\s*apply plugin:\s*"com\.facebook\.react"\s*$/,
    requiredPatterns: [
      /^\s*apply plugin:\s*"com\.android\.application"\s*$/m,
      /^\s*apply plugin:\s*"org\.jetbrains\.kotlin\.android"\s*$/m,
      /^\s*apply plugin:\s*"com\.facebook\.react"\s*$/m,
      /^\s*autolinkLibrariesWithApp\(\)\s*$/m,
      /^\s*compileSdk\s+rootProject\.ext\.compileSdkVersion\s*$/m,
      /^\s*minSdkVersion\s+rootProject\.ext\.minSdkVersion\s*$/m,
      /^\s*targetSdkVersion\s+rootProject\.ext\.targetSdkVersion\s*$/m,
    ],
    pluginLine(plugin) {
      return `apply plugin: "${plugin}"`;
    },
  },
];

const SUPPORT_CHECKS = [
  {
    path: 'package.json',
    validate(content) {
      try {
        const packageJson = JSON.parse(content);
        const dependencies = packageJson.dependencies ?? {};
        return dependencies['react-native'] === undefined
          ? ['package.json must declare a react-native dependency.']
          : [];
      } catch (error) {
        return [`package.json is not valid JSON: ${error.message}`];
      }
    },
  },
  {
    path: 'android/settings.gradle',
    validate(content) {
      const activeContent = stripGradleComments(content);
      const required = [
        {
          description: 'React Native plugin-management include',
          expression:
            /\bpluginManagement\s*\{\s*includeBuild\(\s*["']\.\.\/node_modules\/@react-native\/gradle-plugin["']\s*\)\s*\}/g,
        },
        {
          description: 'React Native settings plugin',
          expression:
            /\bplugins\s*\{\s*id\(\s*["']com\.facebook\.react\.settings["']\s*\)\s*\}/g,
        },
        {
          description: 'React Native autolinking settings',
          expression:
            /\bextensions\.configure\(\s*com\.facebook\.react\.ReactSettingsExtension\s*\)\s*\{\s*ex\s*->\s*ex\.autolinkLibrariesFromCommand\(\)\s*\}/g,
        },
        {
          description: 'application module include',
          expression: /^\s*include\s+["']:app["']\s*$/gm,
        },
        {
          description: 'React Native Gradle include',
          expression:
            /^\s*includeBuild\(\s*["']\.\.\/node_modules\/@react-native\/gradle-plugin["']\s*\)\s*$/gm,
        },
      ];
      const diagnostics = [];
      for (const { description, expression } of required) {
        const count = [...activeContent.matchAll(expression)].length;
        if (count !== 1) {
          diagnostics.push(
            `Expected one active ${description}, found ${count}.`,
          );
        }
      }
      return diagnostics;
    },
  },
];

class StaleInspectionError extends Error {
  constructor(path, message) {
    super(message);
    this.path = path;
  }
}

function hash(content) {
  return createHash('sha256').update(content).digest('hex');
}

function fileIdentity(metadata) {
  return {
    device: metadata.dev,
    inode: metadata.ino,
    mode: metadata.mode,
    size: metadata.size,
    modifiedMilliseconds: metadata.mtimeMs,
  };
}

function sameIdentity(left, right) {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.modifiedMilliseconds === right.modifiedMilliseconds
  );
}

function stripGradleComments(content) {
  let output = '';
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];

    if (lineComment) {
      if (character === '\n' || character === '\r') {
        lineComment = false;
        output += character;
      } else {
        output += ' ';
      }
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        output += '  ';
        index += 1;
        blockComment = false;
      } else {
        output += character === '\n' || character === '\r' ? character : ' ';
      }
      continue;
    }
    if (quote) {
      output += character;
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
      output += character;
      continue;
    }
    if (character === '/' && next === '/') {
      output += '  ';
      index += 1;
      lineComment = true;
      continue;
    }
    if (character === '/' && next === '*') {
      output += '  ';
      index += 1;
      blockComment = true;
      continue;
    }
    output += character;
  }
  return output;
}

async function observeRegularFile(file) {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error('Target must be a regular file, not a symlink.');
  }
  const content = await readFile(file, 'utf8');
  const after = await lstat(file);
  const beforeIdentity = fileIdentity(before);
  const afterIdentity = fileIdentity(after);
  if (!sameIdentity(beforeIdentity, afterIdentity)) {
    throw new Error('Target changed while it was being inspected.');
  }
  return { content, identity: afterIdentity };
}

function result({
  command = 'setup-android',
  mode,
  outcome,
  code,
  message,
  projectRoot,
  files = [],
  checks = [],
  partialEffects = [],
}) {
  return {
    protocolVersion: 1,
    command,
    mode,
    outcome,
    code,
    message,
    projectRoot,
    files,
    checks,
    partialEffects,
  };
}

function countMatches(lines, expression) {
  return lines.reduce(
    (count, line) => count + (expression.test(line) ? 1 : 0),
    0,
  );
}

function findBlock(lines, startExpression, name) {
  const starts = [];
  lines.forEach((line, index) => {
    if (startExpression.test(line)) {
      starts.push(index);
    }
  });
  if (starts.length !== 1) {
    return {
      error: `Expected exactly one ${name} block, found ${starts.length}.`,
    };
  }

  let depth = 0;
  for (let index = starts[0]; index < lines.length; index += 1) {
    depth += (lines[index].match(/\{/g) ?? []).length;
    depth -= (lines[index].match(/\}/g) ?? []).length;
    if (depth === 0) {
      return { start: starts[0], end: index };
    }
    if (depth < 0) {
      break;
    }
  }
  return { error: `The ${name} block has unbalanced braces.` };
}

function pluginStates(target, lines, activeLines, block) {
  const diagnostics = [];
  const states = [];
  for (const plugin of PLUGINS) {
    const occurrences = activeLines
      .map((line, index) => ({ line, originalLine: lines[index], index }))
      .filter(({ line }) => line.includes(plugin));
    if (occurrences.length > 1) {
      diagnostics.push(
        `Plugin ${plugin} appears ${occurrences.length} times; the anchor is ambiguous.`,
      );
      states.push('conflict');
      continue;
    }
    if (occurrences.length === 0) {
      states.push('missing');
      continue;
    }

    const { originalLine, index } = occurrences[0];
    const indentation = originalLine.match(/^\s*/)?.[0] ?? '';
    const expected = target.pluginLine(plugin, indentation);
    if (
      originalLine !== expected ||
      (block && (index <= block.start || index >= block.end))
    ) {
      diagnostics.push(
        `Plugin ${plugin} conflicts with the required declaration: ${expected.trim()}.`,
      );
      states.push('conflict');
    } else {
      states.push('installed');
    }
  }
  return { diagnostics, states };
}

function inspectRootContent(target, content, lines, activeLines, diagnostics) {
  const buildscript = findBlock(
    activeLines,
    /^\s*buildscript\s*\{\s*$/,
    'buildscript',
  );
  if (buildscript.error) {
    diagnostics.push(buildscript.error);
  }

  const pluginBlockStarts = activeLines.filter((line) =>
    /^\s*plugins\s*\{\s*$/.test(line),
  ).length;
  const pluginBlock =
    pluginBlockStarts === 0
      ? null
      : findBlock(activeLines, /^\s*plugins\s*\{\s*$/, 'plugins');
  if (pluginBlock?.error) {
    diagnostics.push(pluginBlock.error);
  }

  const pluginInspection = pluginStates(
    target,
    lines,
    activeLines,
    pluginBlock?.error ? null : pluginBlock,
  );
  diagnostics.push(...pluginInspection.diagnostics);

  if (pluginBlock && !pluginBlock.error) {
    const unexpected = activeLines
      .slice(pluginBlock.start + 1, pluginBlock.end)
      .filter((line) => line.trim())
      .filter((line) => !PLUGINS.some((plugin) => line.includes(plugin)));
    if (unexpected.length > 0) {
      diagnostics.push(
        'The root plugins block contains unsupported declarations.',
      );
    }
  }

  const installed = pluginInspection.states.filter(
    (state) => state === 'installed',
  ).length;
  const missing = pluginInspection.states.filter(
    (state) => state === 'missing',
  ).length;
  if (!pluginBlock && installed > 0) {
    diagnostics.push(
      'EDOT plugin declarations must be inside the root plugins block.',
    );
  }
  if (installed > 0 && missing > 0) {
    diagnostics.push(
      'The EDOT Android plugins are only partially installed in this file.',
    );
  }
  if (pluginBlock && missing === PLUGINS.length) {
    diagnostics.push('An unexpected root plugins block is already present.');
  }

  if (diagnostics.length > 0) {
    return { state: 'refused' };
  }
  if (installed === PLUGINS.length) {
    return { state: 'installed' };
  }

  const indentation = '    ';
  const insertedLines = [
    '',
    'plugins {',
    ...PLUGINS.map((plugin) => target.pluginLine(plugin, indentation)),
    '}',
  ];
  const updatedLines = [...lines];
  updatedLines.splice(buildscript.end + 1, 0, ...insertedLines);
  return {
    state: 'missing',
    updatedContent: updatedLines.join(content.includes('\r\n') ? '\r\n' : '\n'),
    edit: {
      afterLine: 'buildscript { ... }',
      insertedLines: insertedLines.filter(Boolean).map((line) => line.trim()),
    },
  };
}

function inspectAppContent(target, content, lines, activeLines, diagnostics) {
  if (activeLines.some((line) => /^\s*plugins\s*\{\s*$/.test(line))) {
    diagnostics.push(
      'The supported React Native application uses legacy apply-plugin declarations, not a plugins block.',
    );
  }
  const unsupportedEdotPlugins = activeLines.filter(
    (line) =>
      line.includes('co.elastic.otel.android.') &&
      !PLUGINS.some((plugin) => line.includes(plugin)),
  );
  if (unsupportedEdotPlugins.length > 0) {
    diagnostics.push(
      'The application applies an unsupported EDOT Android plugin.',
    );
  }

  const pluginInspection = pluginStates(target, lines, activeLines, null);
  diagnostics.push(...pluginInspection.diagnostics);
  const installed = pluginInspection.states.filter(
    (state) => state === 'installed',
  ).length;
  const missing = pluginInspection.states.filter(
    (state) => state === 'missing',
  ).length;
  if (installed > 0 && missing > 0) {
    diagnostics.push(
      'The EDOT Android plugins are only partially installed in this file.',
    );
  }

  const anchors = activeLines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => target.anchor.test(line));
  if (anchors.length !== 1) {
    diagnostics.push(
      `Expected exactly one React Native apply-plugin insertion anchor, found ${anchors.length}.`,
    );
  }

  if (diagnostics.length > 0) {
    return { state: 'refused' };
  }
  if (installed === PLUGINS.length) {
    return { state: 'installed' };
  }

  const insertedLines = PLUGINS.map((plugin) => target.pluginLine(plugin));
  const updatedLines = [...lines];
  updatedLines.splice(anchors[0].index + 1, 0, ...insertedLines);
  return {
    state: 'missing',
    updatedContent: updatedLines.join(content.includes('\r\n') ? '\r\n' : '\n'),
    edit: {
      afterLine: lines[anchors[0].index].trim(),
      insertedLines,
    },
  };
}

function inspectContent(target, content) {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const activeLines = stripGradleComments(content).split(/\r?\n/);
  const diagnostics = [];

  for (const pattern of target.requiredPatterns) {
    if (!pattern.test(activeLines.join(newline))) {
      diagnostics.push(`Missing supported project anchor matching ${pattern}.`);
    }
  }

  const inspection =
    target.layout === 'root'
      ? inspectRootContent(target, content, lines, activeLines, diagnostics)
      : inspectAppContent(target, content, lines, activeLines, diagnostics);
  return { diagnostics, newline, ...inspection };
}

async function inspectSupportCheck(projectRoot, check) {
  try {
    const { absolutePath, content, identity } = await observeProjectFile(
      projectRoot,
      check.path,
    );
    const diagnostics = check.validate(content);
    return {
      path: check.path,
      absolutePath,
      status: diagnostics.length === 0 ? 'verified' : 'refused',
      diagnostics,
      beforeSha256: hash(content),
      beforeFileIdentity: identity,
    };
  } catch (error) {
    return {
      path: check.path,
      status: 'refused',
      diagnostics: [`Cannot read ${check.path}: ${error.message}`],
    };
  }
}

async function inspectTarget(projectRoot, target) {
  const fallbackAbsolutePath = resolve(projectRoot, target.path);
  try {
    const { absolutePath, content, identity } = await observeProjectFile(
      projectRoot,
      target.path,
    );
    const inspection = inspectContent(target, content);
    if (inspection.state === 'refused') {
      return {
        path: target.path,
        absolutePath,
        status: 'refused',
        diagnostics: inspection.diagnostics,
        beforeSha256: hash(content),
        beforeFileIdentity: identity,
        originalContent: content,
      };
    }
    if (inspection.state === 'installed') {
      return {
        path: target.path,
        absolutePath,
        status: 'no-op',
        diagnostics: [],
        beforeSha256: hash(content),
        afterSha256: hash(content),
        beforeFileIdentity: identity,
        originalContent: content,
      };
    }
    return {
      path: target.path,
      absolutePath,
      status: 'planned',
      diagnostics: [],
      beforeSha256: hash(content),
      afterSha256: hash(inspection.updatedContent),
      beforeFileIdentity: identity,
      edit: inspection.edit,
      originalContent: content,
      updatedContent: inspection.updatedContent,
    };
  } catch (error) {
    return {
      path: target.path,
      absolutePath: fallbackAbsolutePath,
      status: 'refused',
      diagnostics: [`Cannot read ${target.path}: ${error.message}`],
    };
  }
}

function publicFile(file) {
  const {
    absolutePath: _absolutePath,
    beforeFileIdentity: _beforeFileIdentity,
    originalContent: _originalContent,
    updatedContent: _updatedContent,
    ...visible
  } = file;
  return visible;
}

function publicCheck(check) {
  const {
    absolutePath: _absolutePath,
    beforeFileIdentity: _beforeFileIdentity,
    beforeSha256: _beforeSha256,
    ...visible
  } = check;
  return visible;
}

async function inspectProject(projectRoot) {
  const [files, checks] = await Promise.all([
    Promise.all(TARGETS.map((target) => inspectTarget(projectRoot, target))),
    Promise.all(
      SUPPORT_CHECKS.map((check) => inspectSupportCheck(projectRoot, check)),
    ),
  ]);
  const states = files.map((file) => file.status);
  if (
    states.includes('refused') ||
    checks.some((check) => check.status === 'refused')
  ) {
    return {
      code: 'unsupported-project',
      message:
        'The Android project does not match the supported bare React Native Groovy layout.',
      files,
      checks,
      refused: true,
    };
  }
  if (states.includes('planned') && states.includes('no-op')) {
    return {
      code: 'partial-installation',
      message:
        'EDOT Android plugin wiring is partially installed across the target files.',
      files: files.map((file) => ({
        ...file,
        status: 'refused',
        diagnostics: [
          ...(file.diagnostics ?? []),
          'Both target files must be either clean or fully configured.',
        ],
      })),
      checks,
      refused: true,
    };
  }
  return { files, checks, refused: false };
}

function isWithin(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === '' ||
    (!isAbsolute(pathFromRoot) &&
      pathFromRoot !== '..' &&
      !pathFromRoot.startsWith(`..${sep}`))
  );
}

async function safeProjectPath(projectRoot, path) {
  const absolutePath = resolve(projectRoot, path);
  if (!isWithin(projectRoot, absolutePath)) {
    throw new Error(`Path escapes the project root: ${path}`);
  }

  const canonicalParent = await realpath(dirname(absolutePath));
  if (!isWithin(projectRoot, canonicalParent)) {
    throw new Error(`Parent path escapes the project root: ${path}`);
  }
  const canonicalTarget = await realpath(absolutePath);
  if (!isWithin(projectRoot, canonicalTarget)) {
    throw new Error(`Target path escapes the project root: ${path}`);
  }
  return absolutePath;
}

async function observeProjectFile(projectRoot, path) {
  const absolutePath = await safeProjectPath(projectRoot, path);
  const observation = await observeRegularFile(absolutePath);
  return { absolutePath, ...observation };
}

async function atomicWrite(file, content, projectRoot, path) {
  await safeProjectPath(projectRoot, path);
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Target must remain a regular file, not a symlink.');
  }
  const temporary = `${file}.elastic-otel-react-native.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: metadata.mode });
    await chmod(temporary, metadata.mode);
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function resolveProjectRoot(projectRoot) {
  if (!projectRoot) {
    throw new Error('--project-root is required.');
  }
  const requested = isAbsolute(projectRoot)
    ? projectRoot
    : resolve(process.cwd(), projectRoot);
  const canonical = await realpath(requested);
  const metadata = await lstat(canonical);
  if (!metadata.isDirectory()) {
    throw new Error('--project-root must identify a directory.');
  }
  return canonical;
}

function observedState(inspection) {
  return new Map(
    [...inspection.files, ...inspection.checks].map((item) => [
      item.path,
      {
        path: item.path,
        sha256: item.beforeSha256,
        identity: item.beforeFileIdentity,
      },
    ]),
  );
}

async function validateObservedState(projectRoot, state) {
  for (const expected of state.values()) {
    let observation;
    try {
      observation = await observeProjectFile(projectRoot, expected.path);
    } catch (error) {
      throw new StaleInspectionError(
        expected.path,
        `${expected.path} could not be safely re-read after inspection: ${error.message}`,
      );
    }
    if (
      !sameIdentity(observation.identity, expected.identity) ||
      hash(observation.content) !== expected.sha256
    ) {
      throw new StaleInspectionError(
        expected.path,
        `${expected.path} changed after inspection.`,
      );
    }
  }
}

function staleInspectionResult({
  command = 'setup-android',
  mode,
  projectRoot,
  inspection,
  error,
  partialEffects = [],
}) {
  const files = inspection.files.map((file) =>
    file.path === error.path
      ? { ...file, status: 'refused', diagnostics: [error.message] }
      : file,
  );
  const checks = inspection.checks.map((check) =>
    check.path === error.path
      ? { ...check, status: 'refused', diagnostics: [error.message] }
      : check,
  );
  return result({
    command,
    mode,
    outcome: 'refused',
    code: 'stale-inspection',
    message:
      'A project support input changed or became unsafe after inspection. Review partialEffects before retrying.',
    projectRoot,
    files: files.map(publicFile),
    checks: checks.map(publicCheck),
    partialEffects,
  });
}

export async function executeSetup({
  projectRoot,
  mode = 'apply',
  beforeMutation,
  beforeFileWrite,
  writeReplacement = atomicWrite,
} = {}) {
  let canonicalRoot;
  try {
    canonicalRoot = await resolveProjectRoot(projectRoot);
  } catch (error) {
    return result({
      mode,
      outcome: 'refused',
      code: 'invalid-project-root',
      message: error.message,
      projectRoot: projectRoot ?? null,
    });
  }

  const inspection = await inspectProject(canonicalRoot);
  if (inspection.refused) {
    return result({
      mode,
      outcome: 'refused',
      code: inspection.code,
      message: inspection.message,
      projectRoot: canonicalRoot,
      files: inspection.files.map(publicFile),
      checks: inspection.checks.map(publicCheck),
    });
  }

  const planned = inspection.files.filter((file) => file.status === 'planned');
  if (planned.length === 0) {
    return result({
      mode,
      outcome: 'success',
      code: 'already-configured',
      message: 'All required EDOT Android plugin wiring is already present.',
      projectRoot: canonicalRoot,
      files: inspection.files.map(publicFile),
      checks: inspection.checks.map(publicCheck),
    });
  }

  if (mode === 'check') {
    return result({
      mode,
      outcome: 'refused',
      code: 'setup-required',
      message: 'Required EDOT Android plugin wiring is missing.',
      projectRoot: canonicalRoot,
      files: inspection.files.map(publicFile),
      checks: inspection.checks.map(publicCheck),
    });
  }
  if (mode === 'dry-run') {
    return result({
      mode,
      outcome: 'success',
      code: 'changes-planned',
      message: 'The listed EDOT Android plugin edits would be applied.',
      projectRoot: canonicalRoot,
      files: inspection.files.map(publicFile),
      checks: inspection.checks.map(publicCheck),
    });
  }
  if (mode !== 'apply') {
    return result({
      mode,
      outcome: 'refused',
      code: 'invalid-mode',
      message: `Unsupported setup mode: ${mode}`,
      projectRoot: canonicalRoot,
      files: inspection.files.map(publicFile),
      checks: inspection.checks.map(publicCheck),
    });
  }

  if (beforeMutation) {
    await beforeMutation({
      projectRoot: canonicalRoot,
      files: inspection.files,
    });
  }

  const state = observedState(inspection);
  try {
    await validateObservedState(canonicalRoot, state);
  } catch (error) {
    if (error instanceof StaleInspectionError) {
      return staleInspectionResult({
        mode,
        projectRoot: canonicalRoot,
        inspection,
        error,
      });
    }
    throw error;
  }

  const partialEffects = [];
  const files = [...inspection.files];
  for (let index = 0; index < planned.length; index += 1) {
    const plannedFile = planned[index];
    const fileIndex = files.findIndex(
      (candidate) => candidate.path === plannedFile.path,
    );
    try {
      try {
        await validateObservedState(canonicalRoot, state);
      } catch (error) {
        if (error instanceof StaleInspectionError) {
          throw error;
        }
        throw new StaleInspectionError(plannedFile.path, error.message);
      }
      if (beforeFileWrite) {
        await beforeFileWrite({
          file: plannedFile.path,
          index,
          partialEffects: [...partialEffects],
        });
      }
      await validateObservedState(canonicalRoot, state);
      await writeReplacement(
        plannedFile.absolutePath,
        plannedFile.updatedContent,
        canonicalRoot,
        plannedFile.path,
      );
      const finalObservation = await observeProjectFile(
        canonicalRoot,
        plannedFile.path,
      );
      if (hash(finalObservation.content) !== plannedFile.afterSha256) {
        throw new Error(
          `${plannedFile.path} did not match the planned content after writing.`,
        );
      }
      state.set(plannedFile.path, {
        path: plannedFile.path,
        sha256: plannedFile.afterSha256,
        identity: finalObservation.identity,
      });
      files[fileIndex] = { ...plannedFile, status: 'applied' };
      partialEffects.push({
        path: plannedFile.path,
        effect: 'applied',
        afterSha256: plannedFile.afterSha256,
      });
    } catch (error) {
      if (error instanceof StaleInspectionError) {
        return staleInspectionResult({
          mode,
          projectRoot: canonicalRoot,
          inspection: { ...inspection, files },
          error,
          partialEffects,
        });
      }
      files[fileIndex] = {
        ...plannedFile,
        status: 'refused',
        diagnostics: [`Write failed: ${error.message}`],
      };
      return result({
        mode,
        outcome: 'failure',
        code: 'write-failed',
        message:
          'Setup stopped after an unexpected write failure. Review partialEffects before retrying.',
        projectRoot: canonicalRoot,
        files: files.map(publicFile),
        checks: inspection.checks.map(publicCheck),
        partialEffects,
      });
    }
  }

  return result({
    mode,
    outcome: 'success',
    code: 'changes-applied',
    message: 'Required EDOT Android plugin wiring was applied.',
    projectRoot: canonicalRoot,
    files: files.map(publicFile),
    checks: inspection.checks.map(publicCheck),
    partialEffects,
  });
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
    .join(content.includes('\r\n') ? '\r\n' : '\n');
}

function inspectIosPodfile(content) {
  const activeContent = stripRubyComments(content);
  const diagnostics = [];
  const requiredPatterns = [
    /react-native\/scripts\/react_native_pods\.rb/,
    /^\s*prepare_react_native_project!\s*$/m,
    /^\s*config\s*=\s*use_native_modules!\s*$/m,
    /^\s*use_react_native!\(\s*$/m,
    /^\s*post_install\s+do\s+\|installer\|\s*$/m,
    /^\s*react_native_post_install\(\s*$/m,
  ];
  for (const pattern of requiredPatterns) {
    if (!pattern.test(activeContent)) {
      diagnostics.push(`Missing supported Podfile anchor matching ${pattern}.`);
    }
  }
  return diagnostics.length > 0
    ? { state: 'refused', diagnostics }
    : { state: 'installed', diagnostics: [] };
}

async function safeProjectDirectory(projectRoot, path) {
  const absolutePath = resolve(projectRoot, path);
  if (!isWithin(projectRoot, absolutePath)) {
    throw new Error(`Path escapes the project root: ${path}`);
  }
  const canonicalParent = await realpath(dirname(absolutePath));
  if (!isWithin(projectRoot, canonicalParent)) {
    throw new Error(`Parent path escapes the project root: ${path}`);
  }
  const metadata = await lstat(absolutePath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Target must be a directory, not a symlink.');
  }
  const canonical = await realpath(absolutePath);
  if (!isWithin(projectRoot, canonical)) {
    throw new Error(`Target path escapes the project root: ${path}`);
  }
  return canonical;
}

async function findIosProjectPath(projectRoot) {
  const iosDirectory = await safeProjectDirectory(projectRoot, 'ios');
  const projects = (await readdir(iosDirectory, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        entry.name.endsWith('.xcodeproj'),
    )
    .map((entry) => `ios/${entry.name}/project.pbxproj`);
  if (projects.length !== 1) {
    throw new Error(
      `Expected exactly one iOS Xcode project, found ${projects.length}.`,
    );
  }
  return projects[0];
}

async function inspectIosFile(projectRoot, path, inspect) {
  const fallbackAbsolutePath = resolve(projectRoot, path);
  try {
    const { absolutePath, content, identity } = await observeProjectFile(
      projectRoot,
      path,
    );
    const inspection = inspect(content);
    if (inspection.state === 'refused') {
      return {
        path,
        absolutePath,
        status: 'refused',
        diagnostics: inspection.diagnostics,
        beforeSha256: hash(content),
        beforeFileIdentity: identity,
        originalContent: content,
      };
    }
    return {
      path,
      absolutePath,
      status: 'no-op',
      diagnostics: [],
      beforeSha256: hash(content),
      afterSha256: hash(content),
      beforeFileIdentity: identity,
      originalContent: content,
    };
  } catch (error) {
    return {
      path,
      absolutePath: fallbackAbsolutePath,
      status: 'refused',
      diagnostics: [`Cannot read ${path}: ${error.message}`],
    };
  }
}

async function inspectIosProjectSetup(projectRoot) {
  let projectPath;
  try {
    projectPath = await findIosProjectPath(projectRoot);
  } catch (error) {
    return {
      code: 'unsupported-project',
      message:
        'The iOS project does not match the supported bare React Native template layout.',
      files: [
        {
          path: 'ios/*.xcodeproj/project.pbxproj',
          status: 'refused',
          diagnostics: [error.message],
        },
      ],
      checks: [],
      refused: true,
    };
  }

  const [files, checks] = await Promise.all([
    Promise.all([
      inspectIosFile(projectRoot, 'ios/Podfile', inspectIosPodfile),
      inspectIosFile(projectRoot, projectPath, () => ({
        state: 'installed',
        diagnostics: [],
      })),
    ]),
    Promise.all([inspectSupportCheck(projectRoot, SUPPORT_CHECKS[0])]),
  ]);
  if (
    files.some((file) => file.status === 'refused') ||
    checks.some((check) => check.status === 'refused')
  ) {
    return {
      code: 'unsupported-project',
      message:
        'The iOS project does not match the supported bare React Native template layout.',
      files,
      checks,
      refused: true,
    };
  }
  return { files, checks, refused: false };
}

// setup-ios checks the project layout and makes no host change. EDOT iOS needs
// only the manual steps in the getting-started guide (deployment target 16 and
// dynamic frameworks).
export async function executeIosSetup({ projectRoot, mode = 'apply' } = {}) {
  let canonicalRoot;
  try {
    canonicalRoot = await resolveProjectRoot(projectRoot);
  } catch (error) {
    return result({
      command: 'setup-ios',
      mode,
      outcome: 'refused',
      code: 'invalid-project-root',
      message: error.message,
      projectRoot: projectRoot ?? null,
    });
  }
  if (!['apply', 'check', 'dry-run'].includes(mode)) {
    return result({
      command: 'setup-ios',
      mode,
      outcome: 'refused',
      code: 'invalid-mode',
      message: `Unsupported setup mode: ${mode}`,
      projectRoot: canonicalRoot,
    });
  }

  const inspection = await inspectIosProjectSetup(canonicalRoot);
  return result({
    command: 'setup-ios',
    mode,
    outcome: inspection.refused ? 'refused' : 'success',
    code: inspection.refused ? inspection.code : 'no-changes-required',
    message: inspection.refused
      ? inspection.message
      : 'The iOS project needs no EDOT iOS host-project changes. Set the deployment target to iOS 16 or later and install pods with USE_FRAMEWORKS=dynamic.',
    projectRoot: canonicalRoot,
    files: inspection.files.map(publicFile),
    checks: inspection.checks.map(publicCheck),
  });
}

function parseArguments(arguments_) {
  const command = arguments_[0];
  if (!['setup-android', 'setup-ios'].includes(command)) {
    throw new Error(
      'Usage: elastic-otel-react-native <setup-android|setup-ios> --project-root <path> [--check|--dry-run]',
    );
  }
  let projectRoot;
  let mode = 'apply';
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--project-root') {
      if (projectRoot !== undefined || index + 1 >= arguments_.length) {
        throw new Error('--project-root requires exactly one path.');
      }
      projectRoot = arguments_[index + 1];
      index += 1;
    } else if (argument === '--check' || argument === '--dry-run') {
      const requested = argument === '--check' ? 'check' : 'dry-run';
      if (mode !== 'apply') {
        throw new Error('--check and --dry-run are mutually exclusive.');
      }
      mode = requested;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { command, projectRoot, mode };
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.log(
      JSON.stringify(
        result({
          mode: null,
          outcome: 'refused',
          code: 'invalid-arguments',
          message: error.message,
          projectRoot: null,
        }),
        null,
        2,
      ),
    );
    process.exitCode = 2;
    return;
  }

  const { command, ...setupOptions } = options;
  const setupResult =
    command === 'setup-ios'
      ? await executeIosSetup(setupOptions)
      : await executeSetup(setupOptions);
  console.log(JSON.stringify(setupResult, null, 2));
  process.exitCode =
    setupResult.outcome === 'success'
      ? 0
      : setupResult.outcome === 'refused'
        ? 2
        : 1;
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
  await main();
}
