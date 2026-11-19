# @elastic/otel-react-native

React Native bridge for EDOT Android and EDOT iOS. Each native SDK
owns initialization, export, buffering, sessions, sampling, automatic
instrumentation, and native crash reporting. This package adds autolinking,
host setup commands, native-first bootstrap APIs, a promise-based JavaScript
API, and opt-in build-time tap instrumentation.

## Supported platforms

The package supports Android and iOS in bare React Native applications and in
Expo applications that generate their native projects with prebuild. See the
[minimum versions](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/react-native/getting-started#requirements).

## Documentation

- [Overview](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/react-native)
- [Get started](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/react-native/getting-started): install
  the package, set up the native hosts, and bootstrap each SDK.
- [Configuration](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/react-native/configuration): the
  configuration file, configuring in code, and initialization errors.
- [Automatic instrumentation](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/react-native/automatic-instrumentation)
- [Manual instrumentation](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/react-native/manual-instrumentation):
  readiness, spans, logs, and widget clicks from JavaScript.
- [Troubleshooting](https://www.elastic.co/docs/troubleshoot/ingest/opentelemetry/edot-sdks/react-native)
- [Release notes](https://www.elastic.co/docs/release-notes/edot/sdks/react-native)

## Related project

See the
[EDOT React Native demo](https://github.com/elastic/elastic-otel-react-native-demo)
for a guided end-to-end application and Elasticsearch verification.

## License

This package is licensed under the Apache License 2.0. See the `LICENSE` file.
