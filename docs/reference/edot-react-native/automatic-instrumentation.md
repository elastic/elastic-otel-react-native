---
navigation_title: Automatic instrumentation
description: Understand native and platform-neutral instrumentation in the React Native bridge.
---

# Automatic instrumentation

Native-first [bootstrap](getting-started.md#bootstrap-before-react-native)
activates each configured EDOT SDK before React Native starts.

Android setup applies:

- `co.elastic.otel.android.agent`, which wires the EDOT Android agent; and
- `co.elastic.otel.android.instrumentation.okhttp`, which instruments compatible
  OkHttp calls and propagates W3C trace context.

EDOT iOS packages instrumentation idiomatically inside its Swift package.
Default bootstrap retains native URLSession, view-controller, application
lifecycle, CPU/memory system metric, persistence, session, and crash behavior.
The bridge does not duplicate or reimplement those pipelines.

## Enable widget tap events

Add the package plugin after the React Native preset in `babel.config.js`:

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

The Babel transform is platform-neutral. It supports direct arrow functions,
identifiers, and member expressions assigned to `onPress` on named or aliased
`Button` and `Pressable` imports from `react-native`. It skips custom
components, other modules, spread-only handlers, call expressions, and other
unsupported expressions.

Every instrumented element requires a static, nonblank `testID`. That value
becomes `app.widget.id`. When `includeAccessibilityLabel` is `true`, a static
nonblank `accessibilityLabel` becomes optional `app.widget.name`. The transform
never reads children, visible text, runtime values, source paths, list indexes,
or package-specific JSX properties.

At handler invocation, generated code captures the JavaScript epoch timestamp,
submits a fire-and-forget bridge request, contains any telemetry rejection, and
immediately invokes the original handler. Native delay, bridge unavailability,
or export failure cannot gate the UI. Arguments, receiver, synchronous return
and throw behavior, returned promises, and invocation count are preserved.

Native code emits an OpenTelemetry event named `app.widget.click` with
instrumentation scope `@elastic/otel-react-native.interactions`, required
`app.widget.id`, optional `app.widget.name`, no ordinary log body, and no
implicit span context. Both implementations set the top-level EventRecord name
`app.widget.click`, retain it through persistence and export, and record
`otel.event.name=app.widget.click` for export compatibility.

`app.widget.click` is currently a Development semantic convention and can
change in a future OpenTelemetry release.

To disable tap events, remove the plugin and reset the Metro cache. If events
are absent, confirm that the component is a standard import, `testID` is a
static nonblank string, the handler uses a supported form, native bootstrap
completed, and the bundle was rebuilt.

## Native compatibility boundaries

The external fixtures prove package autolinking and native application builds.
They do not prove that every future React Native networking implementation
produces spans.

On Android, automatic spans are limited to requests passing through an OkHttp
client compatible with EDOT Android's OkHttp instrumentation. On iOS, URLSession
coverage is owned by EDOT iOS. Validate representative application
requests on both platforms.

The package does not add automatic React Navigation, Redux, JavaScript fetch,
long-press, gesture, screen-coordinate, or JavaScript exception
instrumentation.

EDOT Android crash reporting comes from its crash Gradle plugin. EDOT iOS
crash reporting remains enabled by the native SDK default. Neither is
implemented by the Babel plugin or the JavaScript bridge.
