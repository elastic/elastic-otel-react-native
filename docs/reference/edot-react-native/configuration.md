---
navigation_title: Configuration
description: Configure native-first EDOT Android and EDOT iOS initialization for React Native.
---

# Configure EDOT React Native

On Android, the bridge reads its configuration from one file,
`elastic-otel-config.json`, at the React Native project root. On iOS, supply
the configuration natively through the Swift `BootstrapConfiguration`.

## Configuration file

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
package, which gives completion and validation while you edit. The bridge
ignores it.

| Key                  | Type                    | Required                 | Default           | Sets                                                    |
| -------------------- | ----------------------- | ------------------------ | ----------------- | ------------------------------------------------------- |
| `$schema`            | string                  | no                       |                   | Nothing. Editors use it; the bridge ignores it.         |
| `exportUrl`          | string                  | yes                      |                   | The OTLP base URL. See [OTLP base URL](#otlp-base-url). |
| `apiKey`             | string                  | no                       | no authentication | The API key sent with each export request.              |
| `exportProtocol`     | `"http"` or `"grpc"`    | no                       | `"http"`          | The OTLP transport.                                     |
| `sessionSampleRate`  | number from 0 to 1      | no                       | `1`               | The fraction of sessions that are recorded.             |
| `resourceAttributes` | object of string values | yes, with `service.name` |                   | One resource attribute for each entry.                  |

Use OpenTelemetry semantic convention keys in `resourceAttributes`.
`service.name` is required. `service.version` defaults to the application
version. Set `deployment.environment.name` and other attributes, such as
`service.namespace`, as needed. See [Service identity](#service-identity).

The file accepts only the keys in this table. An unknown key, such as a
misspelled `apikey`, is rejected rather than ignored, so a typo cannot silently
drop a setting. String values must not be blank, except `$schema`, which only
needs to be a string.

### How the file reaches the app

`setup-android` applies the package's `elastic-otel-config.gradle` script in
`android/app/build.gradle`. At build time the script copies
`elastic-otel-config.json` into the application assets. If the file does not
exist, the build logs a warning with the expected path and continues.

In `MainApplication.onCreate`, `ElasticOtelReactNative.initialize(this)` reads
the file from the assets and starts EDOT Android before React Native loads.
Rebuild the app after you change the file.

### Configuration errors

A missing file, invalid JSON, an unknown key, a duplicate key, a value of the
wrong type, or an invalid value throws `BootstrapException` from
`ElasticOtelReactNative.initialize(this)`. The message names the file and the
offending key or value. Telemetry is not initialized. Because the file is
bundled at build time, the error appears on the first run of the build that
contains it.

### API keys in the app

An API key in this file is compiled into the app, like every telemetry
credential that ships in a mobile app, and can be extracted from the binary.
Use an API key that only grants telemetry ingestion, and rotate it like any
other client credential. If the file holds an API key, keep it out of public
repositories.

## Configure in code

On Android, a host that builds its configuration in code can call the
`BootstrapConfiguration` overload instead of reading the file. This form also
accepts a secret token through `AuthenticationConfiguration.secretToken` and a
custom instrumentation scope:

```kotlin
ElasticOtelReactNative.initialize(
    this,
    BootstrapConfiguration(
        exportUrl = "https://your-otlp-endpoint.example",
        authentication = AuthenticationConfiguration.apiKey("your-api-key"),
        protocol = Transport.HTTP,
        sessionSampleRate = 1.0,
        instrumentationScopeName = "com.example.my-app",
        resourceAttributes = mapOf(
            "service.name" to "your-service",
            "service.version" to "1.4.0",
            "deployment.environment.name" to "production",
            "service.namespace" to "shop",
        ),
    ),
)
```

Use one form. EDOT Android initializes once, so calling both
`initialize(this)` and `initialize(this, configuration)` throws the
duplicate-initialization `BootstrapException`. The file and the code are never
merged.

On iOS:

```swift
BootstrapConfiguration(
  exportUrl: "https://your-otlp-endpoint.example",
  authentication: .apiKey("your-api-key"),
  transport: .http,
  sessionSampleRate: 1.0,
  serviceName: "your-service",
  instrumentationScopeName: "com.example.my-app"
)
```

## OTLP base URL

`exportUrl` is required. Supply the base URL of either:

- an Elastic Agent OTLP endpoint for self-managed deployments, Elastic Cloud
  Enterprise, or Elastic Cloud on Kubernetes; or
- the Elastic Cloud Managed OTLP Endpoint for Elastic Cloud Hosted or Elastic
  Cloud Serverless.

The URL must use `http` or `https`, include a host, and contain no query,
fragment, or signal-specific suffix such as `/v1/traces`. A gateway prefix such
as `https://gateway.example/tenant/otel` is valid. The native SDK appends signal
paths to the supplied base URL. The URL scheme selects connection security.

For an Android emulator reaching a local OTLP/HTTP endpoint on the host, use
`http://10.0.2.2:4318`. For the iOS simulator, use
`http://127.0.0.1:4318`.

## Authentication

In the configuration file, set `apiKey` or omit it. In code, choose one native
form:

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

Blank credentials are rejected. The Swift enum makes simultaneous API key and
secret token configuration unrepresentable. See
[API keys in the app](#api-keys-in-the-app) for how a bundled credential is
exposed.

## Transport

OTLP/HTTP is the default. Select `"exportProtocol": "grpc"`, Android
`Transport.GRPC`, or iOS `.grpc` explicitly only when the chosen endpoint
accepts OTLP/gRPC. The endpoint URL
scheme still determines TLS or plaintext transport.

## Session sampling

`sessionSampleRate` is optional. When supplied, it must be finite and between
`0.0` and `1.0`, inclusive. Each native EDOT SDK owns the session sampling
decision.

## Service identity

On Android, the `service.name` resource attribute is required and must not be
blank. Use a stable name that identifies the mobile application as the
telemetry-producing service. When `service.version` is absent, EDOT Android
uses the application version. The bridge passes `service.name`,
`service.version`, and `deployment.environment.name` to EDOT Android as its
service identity. The other entries add to the resource attributes EDOT Android
sets, such as the device and operating system attributes.

EDOT iOS exposes service-name override through
`OTEL_RESOURCE_ATTRIBUTES`. Its public parser separates entries on commas and
key/value pairs on equals signs, so the iOS bridge rejects service names
containing `,` or `=` rather than exporting a different value. Other existing
resource attributes are preserved. The iOS `BootstrapConfiguration` does not
set the service version, deployment environment, or other resource
attributes.

## Instrumentation scope

`instrumentationScopeName` identifies manual spans and logs created through the
bridge. It defaults to `@elastic/otel-react-native` and must not be blank. The
configuration file always uses the default scope.

## Initialization and errors

Call Android `ElasticOtelReactNative.initialize` once from
`Application.onCreate`, with or without a `BootstrapConfiguration`. Call the Swift equivalent once from `AppDelegate`
before React Native starts. Invalid configuration and duplicate initialization
throw `BootstrapException`. A failed validation or native agent construction
does not retain a partially initialized bridge agent.

EDOT iOS registers its tracer, logger, and meter providers on
`OpenTelemetry.instance` during `ElasticApmAgent.start`. The bridge uses those
registered providers after startup rather than creating another SDK.

JavaScript bridge calls return promises. Before successful native bootstrap,
manual telemetry calls reject with code `E_ELASTIC_OTEL_REACT_NATIVE`. Blank
span names, blank log bodies, unsupported log severities, and unknown or
already-ended handles also reject. Invalid parent handles create no child, and
invalid log handles emit no log.

## Native crash behavior

On Android, the EDOT Android crash plugin records uncaught JVM exceptions as
`app.crash` log records and exports them on the next launch. In a release
build, React Native surfaces an uncaught JavaScript error as a
`com.facebook.react.common.JavascriptException` that terminates the process, so
EDOT Android records it like any other JVM crash. EDOT iOS enables native
crash reporting by default and owns persistence and next-launch export. The
bridge does not expose a JavaScript-only crash toggle, intercept JavaScript
fatal errors, or claim that rejected promises are native crashes.
