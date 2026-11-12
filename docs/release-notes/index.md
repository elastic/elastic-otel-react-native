---
navigation_title: EDOT React Native
description: Release notes for the Elastic Distribution of OpenTelemetry React Native (EDOT React Native).
applies_to:
  stack:
  serverless:
    observability:
products:
  - id: cloud-serverless
  - id: observability
  - id: edot-sdk
---

# Elastic Distribution of OpenTelemetry React Native release notes

Review the changes, fixes, and more in each version of Elastic Distribution of OpenTelemetry React Native.

To check for security updates, go to [Security announcements for the Elastic stack](https://discuss.elastic.co/c/announcements/security-announcements/31).

% Release notes includes only features, enhancements, and fixes. Add breaking changes, deprecations, and known issues to the applicable release notes sections.

% ## version.next [edot-react-native-versionext-release-notes]
% **Release date:** Month day, year

% ### Features and enhancements [edot-react-native-versionext-features-enhancements]

% ### Fixes [edot-react-native-versionext-fixes]

% next_release_notes

## 0.2.0 [edot-react-native-020-release-notes]

**Release date:** November 12, 2026

- Update EDOT Android (`co.elastic.otel.android:agent-sdk`) to 1.11.0.: [#56](https://github.com/elastic/elastic-otel-react-native/pull/56)
- Update `xcode` to v4.: [#43](https://github.com/elastic/elastic-otel-react-native/pull/43)

### Features and enhancements [edot-react-native-020-features-enhancements]

- Support apps that use Android Gradle Plugin 9, and keep support for apps on Android Gradle Plugin 8.: [#67](https://github.com/elastic/elastic-otel-react-native/pull/67)
- Publish the npm package with signed provenance, which links each release to its source commit and publishing workflow.: [#68](https://github.com/elastic/elastic-otel-react-native/pull/68)

## 0.1.0 [edot-react-native-010-release-notes]

**Release date:** November 4, 2026

### Features and enhancements [edot-react-native-010-features-enhancements]

- Initial release of EDOT React Native: run EDOT Android and EDOT iOS in React Native apps, including Expo apps that use `npx expo prebuild`, to send traces, logs, and crash reports to Elastic.
