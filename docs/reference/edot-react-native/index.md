---
navigation_title: Overview
description: React Native bridge for the Elastic Distribution of OpenTelemetry Android and iOS.
---

# EDOT React Native

`@elastic/otel-react-native` is a bridge that lets a bare React
Native application use EDOT Android and EDOT iOS. Each native SDK owns
initialization, export, buffering, sessions, sampling, automatic
instrumentation, and native crash reporting. The package supplies React Native
autolinking, safe host setup, native-first bootstrap types, and a small
promise-based JavaScript bridge.

The package supports bare React Native applications; see the
[tested versions](getting-started.md#tested-versions). Expo managed projects are
not supported.

## Available capabilities

- Deterministic [`setup-android`](getting-started.md#run-automated-android-setup)
  and [`setup-ios`](getting-started.md#set-up-ios) commands.
- Explicit native-first configuration before React Native starts.
- EDOT Android agent, OkHttp, and crash Gradle plugins.
- EDOT iOS URLSession, view-controller, lifecycle, system-metric, persistence,
  session, and crash behavior through the native SDK's defaults.
- Opt-in Babel instrumentation for standard React Native `Button.onPress` and
  `Pressable.onPress` interactions with static widget identity.
- Promise-based readiness, manual named spans, severity-aware logs, and a typed
  `app.widget.click` EventRecord API.
- Android and iOS autolinking without manual package registration.

The bridge does not add a JavaScript OpenTelemetry SDK, a second telemetry
pipeline, arbitrary or vendor attributes, metrics, automatic navigation
telemetry, JavaScript exception interception, or source map processing.

EDOT Android's crash plugin and EDOT iOS 1.4.0's native crash reporting
default own crash capture. The bridge does not add a JavaScript-only crash
toggle or attempt to equalize native SDK ownership by intercepting JavaScript
failures.

## Continue

- [Get started](getting-started.md)
- [Configure the native agents](configuration.md)
- [Understand automatic instrumentation](automatic-instrumentation.md)
- [Create manual spans and logs](manual-instrumentation.md)
- [Read release notes](../../release-notes/index.md)
