const path = require('path');
const { getDefaultConfig } = require('@react-native/metro-config');

// The fixture consumes the bridge through a local path. Watch that package and
// resolve every module from the fixture so the bundle has one React Native.
const projectRoot = __dirname;
const localPackageRoot = path.dirname(
  require.resolve('@elastic/otel-react-native/package.json'),
);
const config = getDefaultConfig(projectRoot);

config.watchFolders = [localPackageRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
