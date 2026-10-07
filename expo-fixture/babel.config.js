module.exports = {
  presets: ['babel-preset-expo'],
  plugins: [
    [
      '@elastic/otel-react-native/babel-plugin',
      { includeAccessibilityLabel: true },
    ],
  ],
};
