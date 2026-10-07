# @elastic/otel-react-native

React Native bridge for EDOT Android and EDOT iOS. Each native SDK
owns initialization, export, buffering, sessions, sampling, automatic
instrumentation, and native crash reporting. This package adds autolinking,
deterministic host setup, native-first bootstrap APIs, a minimal promise bridge,
and opt-in build-time tap instrumentation without adding a JavaScript
OpenTelemetry SDK.

See the
[canonical tested-version table](docs/reference/edot-react-native/getting-started.md#tested-versions)
for the validated versions.

## Related project

See the
[EDOT React Native demo](https://github.com/elastic/elastic-otel-react-native-demo)
for a guided end-to-end application and Elasticsearch verification.

## Install and set up

Install the package, then configure each native host:

```sh
npm install @elastic/otel-react-native
npx elastic-otel-react-native setup-android
npx elastic-otel-react-native setup-ios
```

Expo apps use the package's config plugin instead; see
[Set up an Expo app](docs/reference/edot-react-native/getting-started.md#set-up-an-expo-app).

Android setup adds the EDOT agent, OkHttp, and crash Gradle plugins and applies
the package's configuration Gradle script:

```groovy
apply from: "../../node_modules/@elastic/otel-react-native/android/elastic-otel-config.gradle"
```

iOS setup adds `elastic-otel-config.json` from the project root to the app
target as a resource reference, so Xcode copies it into the app bundle; set the
iOS deployment target to 16 and install pods with `USE_FRAMEWORKS=dynamic`.
Neither command writes credentials, endpoints, the configuration file, or
native bootstrap code. See
[Get started](docs/reference/edot-react-native/getting-started.md) for the exact
Gradle and Xcode project edits, CocoaPods, manual fallback, and
selected-release limitations.

Create one `elastic-otel-config.json` at the project root for both platforms;
[Configuration file](docs/reference/edot-react-native/configuration.md#configuration-file)
shows an example and lists every key.

Then bootstrap Android once in `MainApplication.onCreate`, before
`loadReactNative(this)`:

```kotlin
ElasticOtelReactNative.initialize(this)
```

Bootstrap iOS once at the start of `application(_:didFinishLaunchingWithOptions:)`
in `AppDelegate`, before starting React Native:

```swift
do {
  try ElasticOtelReactNative.initialize()
} catch {
  fatalError("EDOT iOS bootstrap failed: \(error)")
}
```

See [Configuration](docs/reference/edot-react-native/configuration.md) for the
iOS resource attribute character rules and for configuring in code.

Use the same promise bridge on both platforms. A standalone span is a root span:

```ts
import { endSpan, getStatus, startSpan } from '@elastic/otel-react-native';

if ((await getStatus()).ready) {
  const handle = await startSpan('checkout');
  await endSpan(handle);
}
```

Pass an active opaque handle to create a native parent/child relationship:

```ts
const parent = await startSpan('checkout');
const child = await startSpan('charge-card', {
  parentSpanHandle: parent,
});
await endSpan(child);
await endSpan(parent);
```

Logs are independent unless an active span handle is supplied:

```ts
import { emitLog, endSpan, startSpan } from '@elastic/otel-react-native';

await emitLog('checkout started', 'info');

const handle = await startSpan('checkout');
try {
  await emitLog('payment accepted', 'info', { spanHandle: handle });
} finally {
  await endSpan(handle);
}
```

Handles are bridge-local lifecycle tokens, not OpenTelemetry `traceId` or
`spanId` values. See
[Manual instrumentation](docs/reference/edot-react-native/manual-instrumentation.md)
for lifecycle, failure, and correlation behavior.

## Instrument Button and Pressable taps

Enable the platform-neutral Babel plugin explicitly:

```js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      '@elastic/otel-react-native/babel-plugin',
      { includeAccessibilityLabel: true },
    ],
  ],
};
```

The plugin wraps only `onPress` handlers on `Button` and `Pressable` values
imported from `react-native`. A static, nonblank `testID` becomes
`app.widget.id`; an optional static `accessibilityLabel` becomes
`app.widget.name`. Each invocation emits a fire-and-forget OpenTelemetry
EventRecord named `app.widget.click` through the native EDOT pipeline while
preserving the original handler's arguments, receiver, return, throw, promise,
and invocation count.

`app.widget.click`, `app.widget.id`, and `app.widget.name` are Development
OpenTelemetry semantic conventions. Both native implementations set the
top-level EventRecord name and carry `otel.event.name` for export
compatibility.

## Validate

```sh
npm install
npm run validate
```

Validation covers formatting, TypeScript declarations, JavaScript behavior,
Android and iOS native tests, setup refusal/idempotency paths, docs and package
payload, packed-package resolution, autolinking, CocoaPods/SwiftPM integration,
Android and iOS fixture builds, and the Expo config plugin's prebuild and
builds.

## Documentation

- [Overview](docs/reference/edot-react-native/index.md)
- [Get started](docs/reference/edot-react-native/getting-started.md)
- [Configuration](docs/reference/edot-react-native/configuration.md)
- [Automatic instrumentation](docs/reference/edot-react-native/automatic-instrumentation.md)
- [Manual instrumentation](docs/reference/edot-react-native/manual-instrumentation.md)
- [Release notes](docs/release-notes/index.md)
