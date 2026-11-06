---
navigation_title: Configuration
description: Configuration options for the Elastic Distribution of OpenTelemetry React Native (EDOT React Native).
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

# Configure the EDOT React Native SDK

This page lists the settings available for EDOT React Native, how your app
supplies them at initialization, and how initialization reports errors.

## Initialization configuration

On Android and iOS, EDOT React Native reads its configuration from one file,
`elastic-otel-config.json`, at the React Native project root. A host that
builds its configuration in code can pass a native `BootstrapConfiguration`
in place of the file; see [Configure in code](#configure-in-code).

### Configuration file

Create `elastic-otel-config.json` next to `package.json`, `metro.config.js`,
and `babel.config.js`:

```json
{
  "$schema": "./node_modules/@elastic/otel-react-native/elastic-otel-config.schema.json",
  "exportUrl": "https://your-otlp-endpoint.example",
  "apiKey": "your-api-key",
  "exportProtocol": "http",
  "sessionSampleRate": 1,
  "resourceAttributes": {
    "service.name": "your-service",
    "service.version": "1.4.0",
    "deployment.environment.name": "production",
    "service.namespace": "shop"
  }
}
```

The `$schema` line points your editor at the JSON schema shipped in the
package, which gives completion and validation while you edit. EDOT React
Native ignores it.

| Key                  | Type                    | Required                 | Default           | Sets                                                                |
| -------------------- | ----------------------- | ------------------------ | ----------------- | ------------------------------------------------------------------- |
| `$schema`            | string                  | no                       |                   | Nothing. Editors use it; EDOT React Native ignores it.              |
| `exportUrl`          | string                  | yes                      |                   | The OTLP base URL. See [Export connectivity](#export-connectivity). |
| `apiKey`             | string                  | no                       | no authentication | The API key sent with each export request.                          |
| `exportProtocol`     | `"http"` or `"grpc"`    | no                       | `"http"`          | The OTLP transport.                                                 |
| `sessionSampleRate`  | number from 0 to 1      | no                       | `1`               | The fraction of sessions that are recorded.                         |
| `resourceAttributes` | object of string values | yes, with `service.name` |                   | One resource attribute for each entry.                              |

Use OpenTelemetry semantic convention keys in `resourceAttributes`. For
Elastic routing attributes, refer to [Data stream routing](#data-stream-routing).
`service.name` is required. `service.version` defaults to the application
version. Set `deployment.environment.name` and other attributes, such as
`service.namespace`, as needed. See [Service identity](#service-identity).

The file accepts only the keys in this table. An unknown key, such as a
misspelled `apikey`, is rejected rather than ignored, so a typo cannot silently
drop a setting. String values must not be blank, except `$schema`, which only
needs to be a string. Write each key once: a repeated key is not reported, and
only one of its values is used.

#### How the file reaches the app

On Android, `setup-android` applies the package's `elastic-otel.gradle`
script in `android/app/build.gradle`. At build time the script copies
`elastic-otel-config.json` into the application assets. If the file does not
exist, the build logs a warning with the expected path and continues. In
`MainApplication.onCreate`, `ElasticOtelReactNative.initialize(this)` reads
the file from the assets and starts EDOT Android before React Native loads.

On iOS, `setup-ios` adds `elastic-otel-config.json` to the app target in the
Xcode project. The entry references the file at the project root, path
`../elastic-otel-config.json`, in the target's Copy Bundle Resources build
phase, so each build copies the current file into the app bundle. At the start
of `application(_:didFinishLaunchingWithOptions:)`,
`try ElasticOtelReactNative.initialize()` reads the file from the app bundle
and starts EDOT iOS before React Native starts.

Rebuild the app after you change the file. For what happens when the file is
missing or invalid, see [Initialization and errors](#initialization-and-errors).

#### API keys in the app

An API key in this file is compiled into the app, like every telemetry
credential that ships in a mobile app, and can be extracted from the binary.
Use an API key that only grants telemetry ingestion, and rotate it like any
other client credential. If the file holds an API key, keep it out of public
repositories.

### Configure in code

A host that builds its configuration in code can call the
`BootstrapConfiguration` overload in place of reading the file. This form also
accepts a secret token through `AuthenticationConfiguration.secretToken`. On
Android:

```kotlin
ElasticOtelReactNative.initialize(
    this,
    BootstrapConfiguration(
        exportUrl = "https://your-otlp-endpoint.example",
        authentication = AuthenticationConfiguration.apiKey("your-api-key"),
        protocol = Transport.HTTP,
        sessionSampleRate = 1.0,
        resourceAttributes = mapOf(
            "service.name" to "your-service",
            "service.version" to "1.4.0",
            "deployment.environment.name" to "production",
            "service.namespace" to "shop",
        ),
    ),
)
```

On iOS:

```swift
do {
  try ElasticOtelReactNative.initialize(
    BootstrapConfiguration(
      exportUrl: "https://your-otlp-endpoint.example",
      authentication: .apiKey("your-api-key"),
      transport: .http,
      sessionSampleRate: 1.0,
      resourceAttributes: [
        "service.name": "your-service",
        "service.version": "1.4.0",
        "deployment.environment.name": "production",
        "service.namespace": "shop",
      ]
    )
  )
} catch {
  fatalError("EDOT iOS bootstrap failed: \(error)")
}
```

Use one form. The file and the code are never merged, and calling both forms
throws; see [Initialization and errors](#initialization-and-errors).

### Export connectivity

`exportUrl` is required. Supply the base URL of either:

- an Elastic Agent OTLP endpoint for self-managed deployments, Elastic Cloud
  Enterprise, or Elastic Cloud on Kubernetes; or
- the Elastic Cloud Managed OTLP Endpoint for Elastic Cloud Hosted or Elastic
  Cloud Serverless.

The URL must use `http` or `https`, include a host, and contain no query,
fragment, or signal-specific suffix such as `/v1/traces`. A gateway prefix such
as `https://gateway.example/tenant/otel` is valid. For OTLP/HTTP, the native SDK appends
signal paths to the supplied base URL. The URL scheme selects TLS or plaintext
transport.

OTLP/HTTP is the default transport. Select `"exportProtocol": "grpc"`, Android
`Transport.GRPC`, or iOS `.grpc` only when the chosen endpoint accepts
OTLP/gRPC.

For an Android emulator reaching a local OTLP/HTTP endpoint on the host, use
`http://10.0.2.2:4318`. For the iOS simulator, use
`http://127.0.0.1:4318`. When one configuration file serves both platforms, use
`http://localhost:4318` and run `adb reverse tcp:4318 tcp:4318` so the Android
emulator reaches the host; the reverse lasts until the emulator restarts or adb
reconnects.

### Authentication

In the configuration file, set `apiKey` or omit it. In code, the Kotlin and
Swift `AuthenticationConfiguration` types each hold one form: no
authentication, an API key, or a secret token. Choose one:

```kotlin
AuthenticationConfiguration.none()
AuthenticationConfiguration.apiKey("api-key")
AuthenticationConfiguration.secretToken("secret-token")
```

```swift
AuthenticationConfiguration.none
AuthenticationConfiguration.apiKey("api-key")
AuthenticationConfiguration.secretToken("secret-token")
```

Blank credentials are rejected. See
[API keys in the app](#api-keys-in-the-app) for how a bundled credential is
exposed.

### Session behavior

`sessionSampleRate` is optional. When supplied, it must be finite and between
`0.0` and `1.0`, inclusive. EDOT Android and EDOT iOS make the session
sampling decision.

### Service identity

On both platforms, the `service.name` resource attribute is required. No
resource attribute key or value may be blank, and each key is at most 255
printable ASCII characters. Initialization rejects an attribute that breaks
these rules, with a message that names the key unless the key is blank. The
same rules apply to a `BootstrapConfiguration` passed in code. Use a stable
name that identifies the mobile application as the telemetry-producing
service.

When `service.version` is absent, the application version is used.

## Data stream routing

EDOT React Native sets the resource attribute `data_stream.dataset` to
`react_native` on both Android and iOS. This value replaces any dataset
inherited from the native SDK. Other inherited resource attributes remain
unchanged.

To use another dataset, set `data_stream.dataset` in the React Native
`resourceAttributes` configuration. This explicit value overrides the
`react_native` default. The same rule applies to the configuration file and
`BootstrapConfiguration` passed in native code. Standalone EDOT Android and
EDOT iOS applications are not affected.

With default Elastic OTel-native data stream routing, traces and logs use:

| Signal | Data stream                            |
| ------ | -------------------------------------- |
| Traces | `traces-react_native.otel-<namespace>` |
| Logs   | `logs-react_native.otel-<namespace>`   |

Metrics exported with this resource use
`metrics-react_native.otel-<namespace>`. This setting does not enable metrics
collection. The namespace is `default` unless another value is configured.
Scope or record routing attributes and other ingest routing settings can
change the destination. Refer to
[Data stream routing](docs-content://solutions/observability/apm/opentelemetry/data-stream-routing.md).

To separate production data, add `"data_stream.namespace": "production"`
to `resourceAttributes`. You do not need to set the dataset. To retain the
previous default dataset, add `"data_stream.dataset": "generic"` instead.

Use a valid dataset string without the `.otel` suffix. Elastic ingest adds
this suffix for OTel-native data stream routing. Null, non-string, and blank
values are invalid, as with other React Native resource attributes. Custom
datasets can affect dashboards and integrations. Refer to
[Custom data stream routing](elastic-agent://reference/edot-collector/config/custom-data-streams.md).

## Initialization and errors

Call Android `ElasticOtelReactNative.initialize` once from
`Application.onCreate`, with or without a `BootstrapConfiguration`. Call the
Swift equivalent once from `AppDelegate` before React Native starts.

A missing configuration file, invalid JSON, an unknown key, a value of the
wrong type, or an invalid value throws `BootstrapException` from
`initialize(this)` on Android and from `initialize()` on iOS. The message describes
the configuration or file error. An invalid `BootstrapConfiguration`
passed in code throws `BootstrapException` the same way. Telemetry is not
initialized. Because the file is bundled at build time, the error appears on
the first run of the build that contains it.

When the file is missing from the iOS app bundle, the message is:

```text
elastic-otel-config.json was not found in the app bundle. Create it at the React Native project root, run setup-ios, and check that the file is in the app target's Copy Bundle Resources build phase.
```

A second call throws `BootstrapException` for the duplicate initialization
before it reads or validates any configuration. A failed validation or native
agent construction leaves no partially initialized agent.

JavaScript calls return promises. Before successful native bootstrap, manual
telemetry calls reject with code `E_ELASTIC_OTEL_REACT_NATIVE`. Blank span
names, blank log bodies, unsupported log severities, and unknown or
already-ended handles also reject. Invalid parent handles create no child, and
invalid log handles emit no log.

## Crash reporting

EDOT Android and EDOT iOS report native crashes as `app.crash` log records.
On Android, the EDOT Android crash plugin, which `setup-android` or the Expo
config plugin applies, records uncaught JVM exceptions and attempts to flush
the logs before the app terminates. EDOT iOS enables native crash reporting
by default, stores a crash report on the device, and exports it the next time
the app starts. Crash reporting has no JavaScript setting.

Crash events appear in the "Crashes" section of each platform's Application
Overview dashboard. Refer to
[Visualize telemetry](getting-started.md#visualize-telemetry) to install and
open the dashboards.
