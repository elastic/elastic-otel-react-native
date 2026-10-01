---
navigation_title: Configuration
description: Configure native-first EDOT Android and EDOT iOS initialization for React Native.
---

# Configure EDOT React Native

Configuration is supplied once, natively, through
`BootstrapConfiguration`. The bridge deliberately omits deployment environment
until the native SDK contract is aligned; it does not introduce a
bridge-specific resource attribute.

Android:

```kotlin
BootstrapConfiguration(
    exportUrl = "https://your-otlp-endpoint.example",
    authentication = AuthenticationConfiguration.apiKey("your-api-key"),
    protocol = Transport.HTTP,
    sessionSampleRate = 1.0,
    serviceName = "your-service",
    instrumentationScopeName = "com.example.my-app",
)
```

iOS:

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

Choose one native form:

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
secret token configuration unrepresentable. Keep credentials out of source
control and supply them using the application's existing secret-management
mechanism.

## Transport

OTLP/HTTP is the default. Select Android `Transport.GRPC` or iOS `.grpc`
explicitly only when the chosen endpoint accepts OTLP/gRPC. The endpoint URL
scheme still determines TLS or plaintext transport.

## Session sampling

`sessionSampleRate` is optional. When supplied, it must be finite and between
`0.0` and `1.0`, inclusive. Each native EDOT SDK owns the session sampling
decision.

## Service identity

`serviceName` is required and must not be blank. Use a stable name that
identifies the mobile application as the telemetry-producing service.

EDOT iOS 1.4.0 exposes service-name override through
`OTEL_RESOURCE_ATTRIBUTES`. Its public parser separates entries on commas and
key/value pairs on equals signs, so the iOS bridge rejects service names
containing `,` or `=` rather than exporting a different value. Other existing
resource attributes are preserved, and the bridge does not set deployment
environment.

## Instrumentation scope

`instrumentationScopeName` identifies manual spans and logs created through the
bridge. It defaults to `@elastic/otel-react-native` and must not be blank.

## Initialization and errors

Call Android `ElasticOtelReactNative.initialize` once from
`Application.onCreate`. Call the Swift equivalent once from `AppDelegate`
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
EDOT Android records it like any other JVM crash. EDOT iOS 1.4.0 enables native
crash reporting by default and owns persistence and next-launch export. The
bridge does not expose a JavaScript-only crash toggle, intercept JavaScript
fatal errors, or claim that rejected promises are native crashes.
