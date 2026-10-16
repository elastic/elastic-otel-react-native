---
navigation_title: Manual instrumentation
description: Learn how to manually instrument React Native applications using the Elastic Distribution of OpenTelemetry React Native (EDOT React Native) to create spans, correlate logs, and record widget clicks.
products:
  - id: cloud-serverless
  - id: observability
  - id: edot-sdk
---

# Manual instrumentation using the Elastic Distribution of OpenTelemetry React Native

Learn how to manually instrument React Native applications with EDOT React
Native to create spans, correlate logs, and record widget clicks from
JavaScript.

## OpenTelemetry APIs

The JavaScript API of `@elastic/otel-react-native` is identical on Android and
iOS. It exposes readiness, named span start and end, logs with a severity, and
widget click events. All calls return promises. Spans and logs created through
this API use the instrumentation scope `@elastic/otel-react-native`; widget
click events use `@elastic/otel-react-native.interactions`.

Each call creates real OpenTelemetry spans and logs in EDOT Android or EDOT
iOS, which export them with the rest of your app's telemetry.

Check that native bootstrap has completed before you rely on manual
telemetry:

```ts
import { getStatus } from '@elastic/otel-react-native';

const status = await getStatus();
if (!status.ready) {
  // Native bootstrap has not completed.
}
```

The asynchronous API does not implement the synchronous OpenTelemetry
JavaScript tracing interfaces, and it does not create metrics or set custom
span and log attributes. For those, use the OpenTelemetry API of EDOT Android
or EDOT iOS from Android or iOS code.

## Create spans

### Create a root span

```ts
import { endSpan, startSpan } from '@elastic/otel-react-native';

const handle = await startSpan('checkout');
try {
  await submitOrder();
} finally {
  await endSpan(handle);
}
```

Span names must not be blank.

### Create parent and child spans

Pass an active parent handle when creating the child:

```ts
const parent = await startSpan('checkout');
try {
  const child = await startSpan('charge-card', {
    parentSpanHandle: parent,
  });
  try {
    await chargeCard();
  } finally {
    await endSpan(child);
  }
} finally {
  await endSpan(parent);
}
```

The exported child shares the parent's `traceId` and records the parent's
`spanId` in the standard parent field. No package-defined correlation
attribute is added. A child is valid if it ends after its parent, but the
parent handle must be active when `startSpan` is called.

## Create logs

```ts
import { emitLog } from '@elastic/otel-react-native';

await emitLog('checkout started');
await emitLog('payment declined', 'warn');
```

Supported severities are `trace`, `debug`, `info`, `warn`, `error`, and `fatal`.
The default is `info`. Log bodies must not be blank.

Pass an active span handle only when the log should carry that span's
OpenTelemetry context:

```ts
const handle = await startSpan('checkout');
try {
  await emitLog('checkout started', 'info', { spanHandle: handle });
} finally {
  await endSpan(handle);
}
```

The correlated log carries the selected span's standard `traceId` and `spanId`.
Omitting `spanHandle` emits an independent log without valid span context.

## Record widget clicks

Prefer the [Babel plugin](automatic-instrumentation.md#widget-tap-events)
for the components it instruments. For another call site with a stable widget
identity:

```ts
import { recordWidgetClick } from '@elastic/otel-react-native';

await recordWidgetClick({
  widgetId: 'checkout.submit',
  widgetName: 'Submit order',
  timestamp: Date.now(),
});
```

`widgetId` is required and nonblank. `widgetName` is optional and nonblank when
present. `timestamp` is a finite epoch millisecond value captured when the
interaction occurs.

The call records the same `app.widget.click` event as the Babel plugin; see
[What a tap records](automatic-instrumentation.md#what-a-tap-records) for its
attributes and semantic convention status.

## Lifecycle and errors

The value returned by `startSpan` is an opaque handle. It is not an
OpenTelemetry `traceId` or `spanId`, and applications must not persist, parse,
compare, or derive telemetry identity from it. A handle is active until one
successful `endSpan` call, and it cannot be used after its span ends.

Correlation is explicit: there is no implicit active JavaScript context, so a
child span or a correlated log uses the handle you pass, whichever thread
serves the call.

For which calls reject and what a rejected call creates, see
[Initialization and errors](configuration.md#initialization-and-errors). If
child creation or log emission races `endSpan`, one of two outcomes happens:
the context use completes before the span ends, or the operation rejects after
the handle has ended. Calls never fall back to another span.
