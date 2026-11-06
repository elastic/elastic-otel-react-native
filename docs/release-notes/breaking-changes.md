---
navigation_title: Breaking changes
description: Breaking changes for EDOT React Native.
applies_to:
  stack:
  serverless:
    observability:
products:
  - id: cloud-serverless
  - id: observability
  - id: edot-sdk
---

# EDOT React Native breaking changes

## Next version

### React Native dataset

EDOT React Native now sets `data_stream.dataset` to `react_native`. This
replaces any dataset inherited from EDOT Android or EDOT iOS. An explicit
dataset string in React Native configuration remains unchanged.

**Impact**

With default Elastic OTel-native routing, new traces and logs use
`traces-react_native.otel-*` and `logs-react_native.otel-*`. Metrics exported
with the same resource use `metrics-react_native.otel-*`. Other ingest
routing settings can change the destination. Existing data stays in its
original streams.

**Action**

If ingest or read permissions cover only the previous streams, add access
to the new streams. Check dashboards and retention settings that target
only the previous streams. Update them if needed.

To query data from before and after the change, include both sets of
streams. Queries that already cover both sets need no change.

To retain the previous default dataset, set `"data_stream.dataset": "generic"`
in the React Native `resourceAttributes` configuration. To retain another
inherited dataset, set that value explicitly in React Native configuration.
Refer to [Data stream routing](../reference/edot-react-native/configuration.md#data-stream-routing).
