# @elastic/otel-react-native

React Native bridge for EDOT Android and EDOT iOS. Each native SDK
owns initialization, export, buffering, sessions, sampling, automatic
instrumentation, and native crash reporting. This package adds autolinking,
host setup commands, native-first bootstrap APIs, a promise-based JavaScript
API, and opt-in build-time tap instrumentation.

## Supported platforms

The package supports Android and iOS in bare React Native applications and in
Expo applications that generate their native projects with prebuild. See the
[minimum versions](docs/reference/edot-react-native/getting-started.md#requirements).

## Documentation

- [Overview](docs/reference/edot-react-native/index.md)
- [Get started](docs/reference/edot-react-native/getting-started.md): install
  the package, set up the native hosts, and bootstrap each SDK.
- [Configuration](docs/reference/edot-react-native/configuration.md): the
  configuration file, configuring in code, and initialization errors.
- [Automatic instrumentation](docs/reference/edot-react-native/automatic-instrumentation.md)
- [Manual instrumentation](docs/reference/edot-react-native/manual-instrumentation.md):
  readiness, spans, logs, and widget clicks from JavaScript.
- [Release notes](docs/release-notes/index.md)

## Related project

See the
[EDOT React Native demo](https://github.com/elastic/elastic-otel-react-native-demo)
for a guided end-to-end application and Elasticsearch verification.

## License

This package is licensed under the Apache License 2.0. See the `LICENSE` file.
