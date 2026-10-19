'use strict';

// The host lines that the setup commands and the Expo config plugin insert.
// The Kotlin and Swift lines are the bootstrap lines in the getting-started
// guide; only the Expo config plugin writes them.

// The bridge's autolinked Gradle project declares the EDOT Android version in
// android/library/gradle.properties, so host files carry no version.
const EDOT_ANDROID_VERSION =
  "${findProject(':elastic_otel-react-native').properties['edotAndroidVersion']}";

const PLUGIN_PORTAL_LINE = 'gradlePluginPortal()';
const CLASSPATH_LINES = [
  'co.elastic.otel.android:agent-plugin',
  'co.elastic.otel.android.instrumentation:okhttp-plugin',
  'co.elastic.otel.android.instrumentation:crash-plugin',
].map((artifact) => `classpath("${artifact}:${EDOT_ANDROID_VERSION}")`);
const APPLY_PLUGIN_LINES = [
  'co.elastic.otel.android.agent',
  'co.elastic.otel.android.instrumentation.okhttp',
  'co.elastic.otel.android.instrumentation.crash',
].map((plugin) => `apply plugin: "${plugin}"`);
const CONFIG_SCRIPT_LINE =
  'apply from: "../../node_modules/@elastic/otel-react-native/android/elastic-otel.gradle"';

// The Gradle edits whose anchors the React Native and Expo templates share.
// The classpath anchors differ in quoting, so each caller defines its own.
const PLUGIN_PORTAL_EDIT = {
  anchor: /^\s*mavenCentral\(\)\s*$/,
  after: 'mavenCentral()',
  lines: [PLUGIN_PORTAL_LINE],
};
const APPLY_PLUGINS_EDIT = {
  anchor: /^\s*apply plugin:\s*"com\.facebook\.react"\s*$/,
  after: 'apply plugin: "com.facebook.react"',
  lines: [...APPLY_PLUGIN_LINES, CONFIG_SCRIPT_LINE],
};

const CONFIG_FILE_NAME = 'elastic-otel-config.json';
// The Xcode project path of the configuration file at the React Native
// project root, relative to the ios directory that holds the project.
const CONFIG_FILE_REFERENCE_PATH = `../${CONFIG_FILE_NAME}`;

const KOTLIN_IMPORT_LINE =
  'import co.elastic.otel.reactnative.ElasticOtelReactNative';
const KOTLIN_INITIALIZE_LINE = 'ElasticOtelReactNative.initialize(this)';
const SWIFT_IMPORT_LINE = 'import ElasticOtelReactNative';
const SWIFT_INITIALIZE_CALL = 'try ElasticOtelReactNative.initialize()';
const SWIFT_INITIALIZE_LINES = [
  'do {',
  `  ${SWIFT_INITIALIZE_CALL}`,
  '} catch {',
  '  fatalError("EDOT iOS bootstrap failed: \\(error)")',
  '}',
];

// Inserts each edit's missing lines as one block directly after its anchor,
// wherever the present lines are. Lines match by trimmed text. Each addition
// records whether its anchor was found.
function planFile(content, edits) {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const present = new Set(lines.map((line) => line.trim()));
  const additions = [];
  for (const edit of edits) {
    const missing = edit.lines.filter((line) => !present.has(line));
    if (missing.length === 0) {
      continue;
    }
    const anchorIndex = lines.findIndex((line) => edit.anchor.test(line));
    additions.push({
      after: edit.after,
      lines: missing,
      anchored: anchorIndex !== -1,
    });
    if (anchorIndex === -1) {
      continue;
    }
    const indentation = lines[anchorIndex].match(/^\s*/)[0];
    lines.splice(
      anchorIndex + 1,
      0,
      ...missing.map((line) => `${indentation}${line}`),
    );
  }
  return { content: lines.join(newline), additions };
}

module.exports = {
  PLUGIN_PORTAL_LINE,
  CLASSPATH_LINES,
  APPLY_PLUGIN_LINES,
  CONFIG_SCRIPT_LINE,
  PLUGIN_PORTAL_EDIT,
  APPLY_PLUGINS_EDIT,
  CONFIG_FILE_NAME,
  CONFIG_FILE_REFERENCE_PATH,
  KOTLIN_IMPORT_LINE,
  KOTLIN_INITIALIZE_LINE,
  SWIFT_IMPORT_LINE,
  SWIFT_INITIALIZE_CALL,
  SWIFT_INITIALIZE_LINES,
  planFile,
};
