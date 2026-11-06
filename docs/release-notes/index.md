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

For changes that require action before an upgrade, refer to [Breaking changes](breaking-changes.md).

To check for security updates, go to [Security announcements for the Elastic stack](https://discuss.elastic.co/c/announcements/security-announcements/31).

% Release notes includes only features, enhancements, and fixes. Add breaking changes, deprecations, and known issues to the applicable release notes sections.

% ## version.next [edot-react-native-versionext-release-notes]
% **Release date:** Month day, year

% ### Features and enhancements [edot-react-native-versionext-features-enhancements]

% ### Fixes [edot-react-native-versionext-fixes]

% next_release_notes

## version.next [edot-react-native-versionext-release-notes]

### Features and enhancements [edot-react-native-versionext-features-enhancements]

- Default `data_stream.dataset` to `react_native` for resources configured by the React Native bridge. This replaces an inherited native SDK dataset. An explicit dataset in React Native configuration overrides the default. Refer to [the migration instructions](breaking-changes.md#react-native-dataset).

## 0.1.0 [edot-react-native-010-release-notes]

**Release date:** November 4, 2026

### Features and enhancements [edot-react-native-010-features-enhancements]

- Initial release of EDOT React Native: run EDOT Android and EDOT iOS in React Native apps, including Expo apps that use `npx expo prebuild`, to send traces, logs, and crash reports to Elastic.
