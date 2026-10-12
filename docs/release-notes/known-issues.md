---
navigation_title: Known issues
description: Known limitations of EDOT React Native.
---

# Known issues

- Only bare React Native applications and Expo applications that generate
  their native projects with the package's config plugin are supported. The
  [tested versions](../reference/edot-react-native/getting-started.md#tested-versions)
  list the validated combinations.
- Android setup supports only the React Native template's Groovy
  `buildscript` and `apply plugin` layout.
- iOS setup supports the stock React Native Podfile and one Xcode project with
  one application target. It adds only the configuration file reference to
  that target. EDOT iOS requires iOS 16 or later, and React Native recommends
  dynamic frameworks for its SwiftPM integration.
- Android hosts must declare `minSdkVersion = 26` or higher. See [Supported configuration](../reference/edot-react-native/getting-started.md#supported-configuration).
- EDOT Android and EDOT iOS own native crash reporting. JavaScript fatal errors,
  rejected promises, and source maps are not intercepted by this bridge.
- On iOS, resource attribute keys and values must not contain `,` or `=`,
  keys must not start or end with whitespace, and values must not start or
  end with `^`, `"`, `|`, or `$`. Initialization rejects such attributes.
- Automatic OkHttp and URLSession instrumentation must be validated with
  representative application request paths.
- Source maps, automatic navigation telemetry, arbitrary attributes, and
  metrics are not exposed by the bridge.
- Automatic interaction events match components imported by name or by
  default, or defined in the same file. Components used as namespace members,
  such as `<Paper.Button>`, or bound with `require` are not matched. An element
  with a spread attribute after its handler or an id prop such as `testID` is
  skipped.
  Long presses are not recorded.
- `app.widget.click` is a Development OpenTelemetry semantic convention and can
  change before stabilization.
- Manual span and log correlation is explicit. The bridge provides no implicit
  active JavaScript context, and opaque handles cannot be used after their span
  ends.
