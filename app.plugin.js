'use strict';

// Expo config plugin. During prebuild it makes the same host edits as the
// setup commands, adds the native bootstrap lines from the getting-started
// guide, and fails when elastic-otel-config.json or an anchor is missing.

const { existsSync } = require('node:fs');
const { join, relative } = require('node:path');

const {
  IOSConfig,
  withAppBuildGradle,
  withAppDelegate,
  withMainApplication,
  withProjectBuildGradle,
  withXcodeProject,
} = require('expo/config-plugins');

const {
  APPLY_PLUGINS_EDIT,
  CLASSPATH_LINES,
  CONFIG_FILE_NAME,
  CONFIG_FILE_REFERENCE_PATH,
  KOTLIN_IMPORT_LINE,
  KOTLIN_INITIALIZE_LINE,
  PLUGIN_PORTAL_EDIT,
  SWIFT_IMPORT_LINE,
  SWIFT_INITIALIZE_CALL,
  SWIFT_INITIALIZE_LINES,
  planFile,
} = require('./setup-edits.cjs');

// The Expo template quotes the Android Gradle plugin classpath with single
// quotes.
const CLASSPATH_EDIT = {
  anchor: /^\s*classpath\('com\.android\.tools\.build:gradle'\)\s*$/,
  after: "classpath('com.android.tools.build:gradle')",
  lines: CLASSPATH_LINES,
};

function displayPath(config) {
  return relative(config.modRequest.projectRoot, config.modResults.path);
}

function missingAnchor(config, anchor) {
  return new Error(`${displayPath(config)} has no ${anchor}.`);
}

// Registers a mod that runs only during prebuild, after checking that the
// configuration file exists.
function withEdit(withMod, edit) {
  return (config) =>
    withMod(config, (config) => {
      if (!existsSync(join(config.modRequest.projectRoot, CONFIG_FILE_NAME))) {
        throw new Error(
          `${CONFIG_FILE_NAME} was not found. Create it at the project root, next to package.json.`,
        );
      }
      edit(config);
      return config;
    });
}

function editGradleFile(config, edits) {
  const { content, additions } = planFile(config.modResults.contents, edits);
  const unanchored = additions.find(({ anchored }) => !anchored);
  if (unanchored) {
    throw missingAnchor(config, `line ${unanchored.after}`);
  }
  config.modResults.contents = content;
}

function requireLanguage(config, language, name) {
  if (config.modResults.language !== language) {
    throw new Error(
      `${displayPath(config)} is not ${name}. Add the bootstrap lines from the getting-started guide manually.`,
    );
  }
}

const indentationOf = (line) => line.match(/^\s*/)[0];

// Inserts lines after the line at index, indented like the line at
// indentationIndex.
function insertAfter(lines, index, indentationIndex, inserted) {
  const indentation = indentationOf(lines[indentationIndex] ?? '');
  lines.splice(
    index + 1,
    0,
    ...inserted.map((line) => `${indentation}${line}`),
  );
}

function editMainApplication(config) {
  requireLanguage(config, 'kt', 'Kotlin');
  const { contents } = config.modResults;
  const lines = contents.split('\n');
  if (!contents.includes(KOTLIN_IMPORT_LINE)) {
    const lastImport = lines.findLastIndex((line) => /^import\s/.test(line));
    if (lastImport === -1) {
      throw missingAnchor(config, 'import line');
    }
    insertAfter(lines, lastImport, lastImport, [KOTLIN_IMPORT_LINE]);
  }
  if (!contents.includes(KOTLIN_INITIALIZE_LINE)) {
    const onCreate = lines.findIndex((line) =>
      /^\s*override fun onCreate\(\)/.test(line),
    );
    const superCall = lines.findIndex(
      (line, index) =>
        onCreate !== -1 &&
        index > onCreate &&
        line.trim() === 'super.onCreate()',
    );
    if (superCall === -1) {
      throw missingAnchor(config, 'line super.onCreate() in onCreate()');
    }
    insertAfter(lines, superCall, superCall, [KOTLIN_INITIALIZE_LINE]);
  }
  config.modResults.contents = lines.join('\n');
}

function editAppDelegate(config) {
  requireLanguage(config, 'swift', 'Swift');
  const { contents } = config.modResults;
  const lines = contents.split('\n');
  if (!contents.includes(SWIFT_IMPORT_LINE)) {
    const lastImport = lines.findLastIndex((line) =>
      /^(\w+\s+)?import\s/.test(line),
    );
    if (lastImport === -1) {
      throw missingAnchor(config, 'import line');
    }
    insertAfter(lines, lastImport, lastImport, [SWIFT_IMPORT_LINE]);
  }
  if (!contents.includes(SWIFT_INITIALIZE_CALL)) {
    // The parameter declaration, not the call to super. The first brace after
    // it must open the method body.
    const signature = lines.findIndex((line) =>
      /\bdidFinishLaunchingWithOptions\s+\w+\s*:/.test(line),
    );
    const bodyStart = lines.findIndex(
      (line, index) =>
        signature !== -1 && index >= signature && line.includes('{'),
    );
    if (bodyStart === -1 || !/->\s*Bool\s*\{\s*$/.test(lines[bodyStart])) {
      throw missingAnchor(
        config,
        'application(_:didFinishLaunchingWithOptions:) body',
      );
    }
    insertAfter(lines, bodyStart, bodyStart + 1, SWIFT_INITIALIZE_LINES);
  }
  config.modResults.contents = lines.join('\n');
}

// Adds the configuration file at the project root as a resource reference
// without copying it. The empty group name selects the main group. The helper
// skips a main-group file that has the same name.
function editXcodeProject(config) {
  IOSConfig.XcodeUtils.addResourceFileToGroup({
    filepath: CONFIG_FILE_REFERENCE_PATH,
    groupName: '',
    project: config.modResults,
    isBuildFile: true,
  });
}

const MODS = [
  withEdit(withProjectBuildGradle, (config) =>
    editGradleFile(config, [PLUGIN_PORTAL_EDIT, CLASSPATH_EDIT]),
  ),
  withEdit(withAppBuildGradle, (config) =>
    editGradleFile(config, [APPLY_PLUGINS_EDIT]),
  ),
  withEdit(withMainApplication, editMainApplication),
  withEdit(withAppDelegate, editAppDelegate),
  withEdit(withXcodeProject, editXcodeProject),
];

module.exports = function withElasticOtelReactNative(config) {
  return MODS.reduce((current, withMod) => withMod(current), config);
};
