---
navigation_title: EDOT React Native
description: The Elastic Distribution of OpenTelemetry React Native (EDOT React Native) lets React Native applications send telemetry to Elastic through EDOT Android and EDOT iOS.
applies_to:
  stack:
  serverless:
    observability:
  product:
    edot_react_native: preview 0.1.0
products:
  - id: cloud-serverless
  - id: observability
  - id: edot-sdk
---

# Elastic Distribution of OpenTelemetry React Native

The Elastic Distribution of OpenTelemetry React Native (EDOT React Native) is
the `@elastic/otel-react-native` package. It runs
[EDOT Android](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/android)
and [EDOT iOS](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/ios)
in your React Native application, so the app sends traces, logs, and crash
reports to Elastic with a few setup commands and a small JavaScript API.

:::{important}
EDOT React Native is released as a technical preview. The stack and serverless
products referred to in this documentation are GA and compatible with EDOT
React Native.
:::

EDOT React Native supports bare React Native applications and Expo
applications that generate their native projects with `npx expo prebuild`.
See the [requirements](getting-started.md#requirements) and
[Set up an Expo app](getting-started.md#set-up-an-expo-app).

The telemetry from your app helps you better understand its performance, for
example through:

- [Distributed tracing](#distributed-tracing)
- [Session review](#session-review)
- [Alerts, dashboards, and more](#alerts-dashboards-and-more)

## Distributed tracing

Distributed tracing shows how long your app waits for your backend services to
respond, and why. For example, a trace can contain:

- A span created in your app for an outgoing HTTP request.
- A span created in the backend service that receives the request.
- Additional spans created when the backend calls another service or queries a
  database.

You can select any span in Kibana to view its timing, attributes, and
relationship to the rest of the trace.

For distributed tracing to show the complete request, configure your backend
services to send telemetry to the same Elastic deployment.

## Session review

EDOT Android and EDOT iOS add a `session.id` attribute to the spans and logs
that your app sends. You can group the telemetry from one app session and
follow the steps that led to an error or a slow screen.

For example, you can emit a log when a user taps a button and start a span
when the next screen loads. Both carry the same `session.id`, so you can find
them together in Discover and follow the user's journey.

## Alerts, dashboards, and more

With the [manual instrumentation](manual-instrumentation.md) API, you can send
spans and logs that represent your app's own features and workflows, and then:

- [Create alerts](docs-content://explore-analyze/alerting/alerts.md) when an
  error occurs or a performance threshold is exceeded.
- [Build dashboards](docs-content://explore-analyze/dashboards.md) that show
  the data most important to your app.
- Use [Discover](docs-content://explore-analyze/discover.md) to search spans,
  logs, and their attributes.

## Features

### Native SDK ownership

EDOT Android and EDOT iOS initialize OpenTelemetry in your app and own export,
buffering, sessions, sampling, automatic instrumentation, and crash reporting.
On Android, the app applies the EDOT Android agent, OkHttp, and crash Gradle
plugins. On iOS, EDOT iOS provides its URLSession, view-controller, lifecycle,
system-metric, persistence, session, and crash behavior with its default
configuration. Both SDKs start from native code before React Native loads; see
[Bootstrap before React Native](getting-started.md#bootstrap-before-react-native).

### Host setup commands

The [`setup-android`](getting-started.md#run-automated-android-setup) and
[`setup-ios`](getting-started.md#set-up-ios) commands add the native build
lines your app needs. React Native autolinking registers the package on both
platforms, so you do not register it by hand.

### Widget tap events

An opt-in Babel plugin records taps on React Native's buttons, pressables, and
touchables, and on the app and library components you list, as
`app.widget.click` events. Each event identifies the widget from its props or
visible text. See
[Widget tap events](automatic-instrumentation.md#widget-tap-events).

### Manual spans and logs

A promise-based JavaScript API reports readiness, creates named spans with
parent and child relationships, emits logs with a severity, and records widget
clicks. See [Manual instrumentation](manual-instrumentation.md).

### Crash reporting

EDOT Android and EDOT iOS capture native crashes. See
[Crash reporting](configuration.md#crash-reporting).

## Try it out

Follow the
[EDOT React Native demo](https://github.com/elastic/elastic-otel-react-native-demo)
guide to run an end-to-end weather application and inspect its telemetry in
Kibana. If you're ready to instrument your own app, continue with
[Get started](getting-started.md).
