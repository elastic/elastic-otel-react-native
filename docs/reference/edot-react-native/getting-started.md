---
navigation_title: Get started
description: Install the EDOT React Native package in a supported bare Android and iOS application.
---

# Get started with EDOT React Native

This guide installs `@elastic/otel-react-native` in a bare React Native
application.

## Tested versions

This table is the canonical record of tested versions.

| Component             | Tested version                              |
| --------------------- | ------------------------------------------- |
| Node.js               | 22.23.2                                     |
| React                 | 19.2.3                                      |
| React Native          | 0.87.1 with Hermes and the New Architecture |
| Android Gradle Plugin | 9.2.1                                       |
| Gradle                | 9.4.1                                       |
| Kotlin                | 2.2.0                                       |
| JDK                   | Amazon Corretto 21.0.9                      |
| Android API           | compile 37 / target 36 / minimum 26         |
| EDOT Android          | 1.10.0                                      |
| Xcode                 | 27.0                                        |
| CocoaPods             | 1.16.2                                      |
| iOS deployment target | 16.0                                        |
| EDOT iOS              | 1.4.0 (`ElasticApm` SwiftPM product)        |

Stock React Native applications from 0.80 on also build with this package.
React Native 0.80.3, 0.81.6, 0.83.10, 0.85.3, and 0.86.0 build a release APK
at API 26. React Native 0.80 also needs compile SDK 36. The 0.86.0 APK starts
on an API 26 emulator. The iOS app builds on React Native 0.83.10 and 0.85.3.
On React Native 0.80 and 0.81, Xcode 27 fails in React Native's own `fmt` pod,
with or without this package.

EDOT iOS 1.4.0 is distributed only through Swift Package Manager, declares iOS
16, and publishes the static `ElasticApm` product. The package podspec pins that
exact release through React Native's supported `spm_dependency`
integration with the public GitHub URL, so npm installations do not depend on a
sibling checkout.

## Supported configuration

EDOT React Native is the supported way to use EDOT Android from React Native.

This package uses the EDOT Android release listed in
[Tested versions](#tested-versions). The Android host must meet these floors:

- `minSdkVersion = 26` or higher. The bridge offers no desugaring path for
  lower API levels.
- A compile SDK of 36 or higher, which EDOT Android declares in its library
  metadata.
- React Native 0.80 or newer. React Native 0.79's Gradle plugin compiles with
  Kotlin 2.0, which cannot read EDOT Android's Kotlin 2.2 metadata.

The build enforces these floors. An untouched React Native 0.87.1 template
declares `minSdkVersion = 24`. With this package and the EDOT Android agent,
OkHttp, and crash plugins added, `./gradlew :app:assembleRelease` fails:

```text
Manifest merger failed : uses-sdk:minSdkVersion 24 cannot be smaller than
version 26 declared in library [:elastic_otel-react-native]
```

After changing only `minSdkVersion` to 26, the same release build succeeds. The
setup commands do not check or edit host tool versions.

## Install the package

From the consuming application's root, run:

```sh
npm install @elastic/otel-react-native
```

## Run automated Android setup

From the consuming application's root, run:

```sh
npx elastic-otel-react-native setup-android --project-root .
```

The command supports the React Native template's Groovy layout. It adds an
EDOT Android root plugin block and applies the agent, OkHttp, and crash plugins
to the application module. Before writing, it verifies the `react-native`
dependency, the autolinking anchors, and any existing EDOT Android plugin
declarations.

The command never edits `MainApplication`, credentials, endpoints, manifests,
network security, repositories, or host tool versions. It refuses conflicting
versions, partial installation, ambiguous anchors, unsupported syntax, and
files that change after inspection.

Preview or check without writing:

```sh
npx elastic-otel-react-native setup-android --project-root . --dry-run
npx elastic-otel-react-native setup-android --project-root . --check
```

## Set up iOS

From the same application root, run:

```sh
npx elastic-otel-react-native setup-ios --project-root .
```

The command checks that the project uses the stock React Native Podfile
structure and one Xcode project. It makes no host changes. It never
writes `AppDelegate`, credentials, endpoints, bundle identifiers, signing
settings, or Xcode project content. It refuses custom Podfile layouts and
multiple Xcode projects.

EDOT iOS needs two manual steps:

- Set the Podfile platform and every application deployment target in Xcode
  to iOS 16 or later. EDOT iOS 1.4.0 declares iOS 16. Below that, Xcode stops
  with `compiling for iOS 15.1, but module 'ElasticOtelReactNative' has a
minimum deployment target of iOS 16.0`.
- Install pods with dynamic frameworks. The package podspec attaches EDOT iOS
  through React Native's `spm_dependency`. React Native recommends dynamic
  frameworks for pods that use Swift packages:

  ```sh
  cd ios
  USE_FRAMEWORKS=dynamic pod install
  cd ..
  ```

  You can set `ENV['USE_FRAMEWORKS'] = 'dynamic'` in the Podfile instead. The
  setup leaves React Native's choice between prebuilt and source-built core
  pods unchanged.

Autolinking evaluates `ElasticOtelReactNative.podspec`. React Native's
`post_install` integration attaches the remote EDOT iOS `ElasticApm` Swift
package product to the pod target.

## Manual host setup fallback

For Android, add this block after the root `buildscript` block:

```groovy
plugins {
    id("co.elastic.otel.android.agent") version "1.10.0" apply false
    id("co.elastic.otel.android.instrumentation.okhttp") version "1.10.0" apply false
    id("co.elastic.otel.android.instrumentation.crash") version "1.10.0" apply false
}
```

Apply all three plugins in `android/app/build.gradle`:

```groovy
apply plugin: "co.elastic.otel.android.agent"
apply plugin: "co.elastic.otel.android.instrumentation.okhttp"
apply plugin: "co.elastic.otel.android.instrumentation.crash"
```

For iOS, follow the two manual steps in [Set up iOS](#set-up-ios). Do not add
EDOT iOS as a sibling path or edit its repository to add a podspec.

## Bootstrap before React Native

In Android `MainApplication.kt`, initialize after `super.onCreate()` and before
`loadReactNative(this)`:

```kotlin
import co.elastic.otel.reactnative.AuthenticationConfiguration
import co.elastic.otel.reactnative.BootstrapConfiguration
import co.elastic.otel.reactnative.ElasticOtelReactNative
import co.elastic.otel.reactnative.Transport

override fun onCreate() {
    super.onCreate()
    ElasticOtelReactNative.initialize(
        this,
        BootstrapConfiguration(
            exportUrl = "https://your-otlp-endpoint.example",
            authentication = AuthenticationConfiguration.apiKey("your-api-key"),
            protocol = Transport.HTTP,
            sessionSampleRate = 1.0,
            serviceName = "your-service",
            instrumentationScopeName = "com.example.my-app",
        ),
    )
    loadReactNative(this)
}
```

In iOS `AppDelegate.swift`, import the autolinked module and initialize before
creating or starting the React Native factory:

```swift
import ElasticOtelReactNative

do {
  try ElasticOtelReactNative.initialize(
    BootstrapConfiguration(
      exportUrl: "https://your-otlp-endpoint.example",
      authentication: .apiKey("your-api-key"),
      transport: .http,
      sessionSampleRate: 1.0,
      serviceName: "your-service",
      instrumentationScopeName: "com.example.my-app"
    )
  )
} catch {
  fatalError("EDOT iOS bootstrap failed: \(error)")
}
```

The setup commands deliberately do not write bootstrap code because
configuration and credentials belong to the application. React Native
autolinking registers the bridge on both platforms; do not register it
manually.

If telemetry does not appear, use the EDOT Android
[troubleshooting guide](docs-content://troubleshoot/ingest/opentelemetry/edot-sdks/android/index.md)
or the EDOT iOS
[troubleshooting guide](docs-content://troubleshoot/ingest/opentelemetry/edot-sdks/ios/index.md).

## Remove the package

1. Remove both native bootstrap calls and imports.
2. Remove the EDOT Android plugin applications and declarations.
3. Remove the iOS Podfile line that forces dynamic frameworks only if no other
   dependency needs it; choose any new deployment target based on the remaining
   application dependencies.
4. Uninstall `@elastic/otel-react-native`.
5. Run `pod install` and rebuild both native applications to refresh
   autolinking.
