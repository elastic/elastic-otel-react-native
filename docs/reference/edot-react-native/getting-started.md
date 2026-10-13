---
navigation_title: Get started
description: Install the EDOT React Native package in a supported bare React Native or Expo application.
---

# Get started with EDOT React Native

This guide installs `@elastic/otel-react-native` in a bare React Native
application. For an Expo application, see
[Set up an Expo app](#set-up-an-expo-app).

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
| EDOT iOS              | 2.1.0 (`ElasticApm` SwiftPM product)        |
| Expo SDK              | 57 (`expo` 57.0.27, `@expo/cli` 57.0.28)    |
| React Native for Expo | 0.86.3                                      |

Stock React Native applications from 0.80 on also build with this package.
React Native 0.80.3, 0.81.6, 0.83.10, 0.85.3, and 0.86.0 build a release APK
at API 26. React Native 0.80 also needs compile SDK 36. The 0.86.0 APK starts
on an API 26 emulator. The iOS app builds on React Native 0.83.10 and 0.85.3.
On React Native 0.80 and 0.81, Xcode 27 fails in React Native's own `fmt` pod,
with or without this package.

The package brings in the EDOT iOS release listed above when you install pods,
so you do not add EDOT iOS to the project yourself.

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
npx elastic-otel-react-native setup-android
```

With Yarn, pnpm, or Bun, use `yarn`, `pnpm exec`, or `bunx` in place of `npx`.

The command supports the React Native template's Groovy layout and edits two
files:

- In `android/build.gradle`, it adds `gradlePluginPortal()` after
  `mavenCentral()` in the `buildscript` repositories, because the EDOT Android
  Gradle plugins are published on the Gradle Plugin Portal. It adds the agent,
  OkHttp, and crash plugin `classpath` lines after
  `classpath("com.android.tools.build:gradle")`.
- In `android/app/build.gradle`, it applies the three plugins and the
  package's configuration Gradle script after
  `apply plugin: "com.facebook.react"`. The script copies
  `elastic-otel-config.json` from the project root into the application assets
  at build time; see [Configuration file](configuration.md#configuration-file).

The command skips lines that are already present, so running it again changes
nothing. If a file or one of those anchor lines is missing, it changes no file,
prints the lines to add by hand, and exits with an error; see
[Manual host setup fallback](#manual-host-setup-fallback). When it finishes,
review the changes with `git diff`.

The `classpath` lines read the EDOT Android version from the installed
package, so upgrading `@elastic/otel-react-native` needs no edit to your Gradle
files.

The command never edits `MainApplication`, credentials, endpoints, manifests,
network security, or host tool versions.

## Set up iOS

From the same application root, run:

```sh
npx elastic-otel-react-native setup-ios
```

The command checks that the project uses the stock React Native Podfile
structure and one Xcode project with one application target. It then adds
`elastic-otel-config.json` to the app target in
`ios/<App>.xcodeproj/project.pbxproj`. The entry references the file at the
project root, path `../elastic-otel-config.json`, in the target's Copy Bundle
Resources build phase, so each build copies the current file into the app
bundle; see [Configuration file](configuration.md#configuration-file).

If the project already references that path, the command changes nothing, so
running it again is safe. If the layout checks fail, the Xcode project cannot
be parsed, or the project does not have exactly one application target, it
changes no file, prints the manual step, and exits with an error; see
[Manual host setup fallback](#manual-host-setup-fallback). When it finishes,
review the change with `git diff`.

The command never edits `AppDelegate`, the Podfile, credentials, endpoints,
bundle identifiers, signing settings, or other Xcode project content.

EDOT iOS needs two more manual steps:

- Set the Podfile platform and every application deployment target in Xcode
  to iOS 16 or later. EDOT iOS declares iOS 16. Below that, Xcode stops
  with `compiling for iOS 15.1, but module 'ElasticOtelReactNative' has a
minimum deployment target of iOS 16.0`.
- Install pods with dynamic frameworks:

  ```sh
  cd ios
  USE_FRAMEWORKS=dynamic pod install
  cd ..
  ```

  You can set `ENV['USE_FRAMEWORKS'] = 'dynamic'` in the Podfile instead. The
  setup leaves React Native's choice between prebuilt and source-built core
  pods unchanged.

## Manual host setup fallback

For Android, add `gradlePluginPortal()` and the three EDOT Android `classpath`
lines to the root `buildscript` block in `android/build.gradle`. Keep the
version expression as shown; it reads the EDOT Android version from the
installed package:

```groovy
buildscript {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
    dependencies {
        classpath("com.android.tools.build:gradle")
        classpath("co.elastic.otel.android:agent-plugin:${findProject(':elastic_otel-react-native').properties['edotAndroidVersion']}")
        classpath("co.elastic.otel.android.instrumentation:okhttp-plugin:${findProject(':elastic_otel-react-native').properties['edotAndroidVersion']}")
        classpath("co.elastic.otel.android.instrumentation:crash-plugin:${findProject(':elastic_otel-react-native').properties['edotAndroidVersion']}")
        classpath("com.facebook.react:react-native-gradle-plugin")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin")
    }
}
```

Apply all three plugins and the configuration Gradle script in
`android/app/build.gradle`:

```groovy
apply plugin: "co.elastic.otel.android.agent"
apply plugin: "co.elastic.otel.android.instrumentation.okhttp"
apply plugin: "co.elastic.otel.android.instrumentation.crash"
apply from: "../../node_modules/@elastic/otel-react-native/android/elastic-otel-config.gradle"
```

For iOS, add `elastic-otel-config.json` from the project root to the app
target in Xcode as a reference, without copying it into the `ios` directory.
Check that the file is listed in the target's Copy Bundle Resources build
phase. Then follow the two manual steps in [Set up iOS](#set-up-ios). Do not
add EDOT iOS to the project yourself; the package brings it in.

## Bootstrap before React Native

Create `elastic-otel-config.json` at the project root, next to
`package.json`. One file configures both platforms;
[Configuration file](configuration.md#configuration-file) shows an example
and lists every key.

In `MainApplication.kt`, initialize after `super.onCreate()` and before
`loadReactNative(this)`:

```kotlin
import co.elastic.otel.reactnative.ElasticOtelReactNative

override fun onCreate() {
    super.onCreate()
    ElasticOtelReactNative.initialize(this)
    loadReactNative(this)
}
```

In iOS `AppDelegate.swift`, import the autolinked module and initialize at the
start of `application(_:didFinishLaunchingWithOptions:)`, before creating or
starting the React Native factory:

```swift
import ElasticOtelReactNative

do {
  try ElasticOtelReactNative.initialize()
} catch {
  fatalError("EDOT iOS bootstrap failed: \(error)")
}
```

Both calls read `elastic-otel-config.json`. For what happens when it is
missing or invalid, see
[Initialization and errors](configuration.md#initialization-and-errors). To
build the configuration in code instead, see
[Configure in code](configuration.md#configure-in-code).

The setup commands deliberately do not write bootstrap code or the
configuration file because configuration and credentials belong to the
application. React Native
autolinking registers the bridge on both platforms; do not register it
manually.

If telemetry does not appear, use the EDOT Android
[troubleshooting guide](docs-content://troubleshoot/ingest/opentelemetry/edot-sdks/android/index.md)
or the EDOT iOS
[troubleshooting guide](docs-content://troubleshoot/ingest/opentelemetry/edot-sdks/ios/index.md).

## Set up an Expo app

Expo apps that generate their native projects with `npx expo prebuild` use
the package's config plugin. During prebuild, the plugin makes the Android
Gradle edits that `setup-android` makes, adds the configuration file reference
that `setup-ios` adds, and adds the bootstrap code from
[Bootstrap before React Native](#bootstrap-before-react-native) to
`MainApplication.kt` and `AppDelegate.swift`. Expo apps skip the setup
commands and do not add the native lines by hand.

1. Install the package and `expo-build-properties`:

   ```sh
   npm install @elastic/otel-react-native
   npx expo install expo-build-properties
   ```

2. Create `elastic-otel-config.json` at the project root, next to
   `package.json`; see [Configuration file](configuration.md#configuration-file).
3. In `app.json`, add `"@elastic/otel-react-native"` to `expo.plugins`. Set the
   Android minimum SDK and iOS dynamic frameworks with `expo-build-properties`:

   ```json
   {
     "expo": {
       "plugins": [
         "@elastic/otel-react-native",
         [
           "expo-build-properties",
           {
             "android": { "minSdkVersion": 26 },
             "ios": { "useFrameworks": "dynamic" }
           }
         ]
       ]
     }
   }
   ```

4. To record taps, install `babel-preset-expo` and add the Babel plugin to
   `babel.config.js`; see
   [Automatic instrumentation](automatic-instrumentation.md#enable-widget-tap-events):

   ```sh
   npx expo install babel-preset-expo
   ```

   ```js
   module.exports = {
     presets: ['babel-preset-expo'],
     plugins: [
       [
         '@elastic/otel-react-native/babel-plugin',
         { includeAccessibilityLabel: true },
       ],
     ],
   };
   ```

5. Generate the native projects:

   ```sh
   npx expo prebuild
   ```

Prebuild fails when `elastic-otel-config.json` is missing at the project root.
It also fails when `MainApplication` is not Kotlin, `AppDelegate` is not
Swift, or a generated file lacks a line that the plugin inserts after; the
error names the file and the line.

To remove the package from an Expo app, remove it from `expo.plugins`,
remove the `@elastic/otel-react-native/babel-plugin` entry from
`babel.config.js` if you added it, uninstall the package, and run
`npx expo prebuild --clean`.

## Remove the package

1. Remove both native bootstrap calls and imports.
2. Remove the EDOT Android plugin applications and declarations, the
   configuration Gradle script line, the `elastic-otel-config.json` reference
   in the Xcode app target, and `elastic-otel-config.json`.
3. Remove the iOS Podfile line that forces dynamic frameworks only if no other
   dependency needs it; choose any new deployment target based on the remaining
   application dependencies.
4. Remove the `@elastic/otel-react-native/babel-plugin` entry from
   `babel.config.js` if you added it.
5. Uninstall `@elastic/otel-react-native`.
6. Run `pod install` and rebuild both native applications to refresh
   autolinking.
