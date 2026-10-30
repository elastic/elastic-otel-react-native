# Minimum consumer Release builds

Run these device-free commands from the repository root after `npm ci`:

```sh
npm run validate:minimum:bare:android
npm run validate:minimum:bare:ios
npm run validate:minimum:expo:android
npm run validate:minimum:expo:ios
npm run validate:minimum
```

`npm run validate` includes the aggregate. Android needs JDK 17 and the Android
SDK/NDK requested by each frozen template. CI uses Node 22.23.2. Builds target
arm64-v8a and do not launch an app.

iOS tool pins live in `toolchains.json`. CI installs the selected CocoaPods gem.
For local builds, install CocoaPods 1.16.2 and select the matching Xcode installation:

```sh
export MINIMUM_BARE_DEVELOPER_DIR=/Applications/Xcode_16.4.app/Contents/Developer
export MINIMUM_EXPO_DEVELOPER_DIR=/Applications/Xcode_26.4.1.app/Contents/Developer
```

The procedure rejects a missing or different Xcode with a non-zero prerequisite
diagnostic.

Each invocation creates and prints its own `build/minimum-<host>-<platform>-*`
directory. Outputs remain there for diagnosis; remove an invocation's directory
when finished. Tracked fixture inputs are never modified by a build. The bare
native files come from the locked RN 0.80.0 community template package. Its compile
SDK is set to 36 and minSdk to 26 to meet the documented host requirements. Expo
uses the template archive shipped inside the locked Expo 57.0.0 package. Its
build-properties plugin selects minSdk 26 and dynamic iOS frameworks. The npm
locks freeze host dependencies independently of SDK development dependencies.

Every integrated build packs the current SDK into its invocation directory and
installs that tarball into the host through npm. Bare hosts run the packed setup
command and include the documented native bootstrap. Expo prebuild runs the
packed config plugin. Release builds bundle the JavaScript entry that imports
the SDK. The latest-version fixtures and their launch checks are separate.

For initial template/toolchain verification without the SDK, run:

```sh
node scripts/minimum-consumer.mjs bare android --baseline
node scripts/minimum-consumer.mjs bare ios --baseline
node scripts/minimum-consumer.mjs expo android --baseline
node scripts/minimum-consumer.mjs expo ios --baseline
```

The baseline uses the same template, host requirements and toolchain as the
integrated command, omitting SDK installation, imports and integration only.
