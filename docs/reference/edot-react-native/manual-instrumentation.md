---
navigation_title: Manual instrumentation
description: Create related spans and correlate logs through the cross-platform React Native bridge.
---

# Manual instrumentation

The JavaScript surface is identical on Android and iOS. It exposes readiness,
named span start/end, severity-aware logs, and a narrow widget-click EventRecord
API. All calls return promises. Spans and logs created through this API use the
instrumentation scope `@elastic/otel-react-native`; widget-click events use
`@elastic/otel-react-native.interactions`.

## Check readiness

```ts
import { getStatus } from '@elastic/otel-react-native';

const status = await getStatus();
if (!status.ready) {
  // Native bootstrap has not completed.
}
```

`state` is either `ready` or `not_ready`.

## Create a root span

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

## Create parent and child spans

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

Each native SDK creates real OpenTelemetry spans. The exported child shares the
parent's `traceId` and records the parent's `spanId` in the standard parent
field. No package-defined correlation attribute is added. A child remains
valid if it ends after its parent, but the parent handle must still be active
when `startSpan` is called.

## Emit logs

```ts
import { emitLog } from '@elastic/otel-react-native';

await emitLog('checkout started');
await emitLog('payment declined', 'warn');
```

Supported severities are `trace`, `debug`, `info`, `warn`, `error`, and `fatal`.
The default is `info`. Log bodies must not be blank.

Pass an active span handle only when the log should carry that span's native
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

## Handle lifecycle and errors

The value returned by `startSpan` is a monotonic opaque bridge handle. It is not
an OpenTelemetry `traceId` or `spanId`, and applications must not persist,
parse, compare, or derive telemetry identity from it. A handle remains active
until one successful `endSpan` call.

An unknown or already-ended handle rejects the promise. A rejected parent
creates no child, and a rejected log handle emits no log. If child creation or
log emission races `endSpan`, native synchronization gives one of two outcomes:
context use completes before the span ends, or the operation rejects after the
handle has ended. Calls never fall back to another span.

The bridge sets native OpenTelemetry parent or log context directly. It does
not keep a thread-bound active JavaScript scope, so correlation does not depend
on which thread serves a bridge call.

On Android, bridge code obtains OpenTelemetry from the initialized EDOT agent.
On iOS, `ElasticApmAgent.start` registers providers on
`OpenTelemetry.instance`, and bridge code uses those global native providers.
Both approaches keep the platform SDK authoritative and create no second
pipeline.

The asynchronous bridge does not implement the synchronous OpenTelemetry
JavaScript tracing interfaces. Applications needing the full upstream surface
can use the underlying native OpenTelemetry API from Android or iOS code.

## Record a widget click manually

Prefer the [Babel plugin](automatic-instrumentation.md#enable-widget-tap-events)
for supported standard components. For another call site with a stable widget
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

The result is an OpenTelemetry event named `app.widget.click`, using
scope `@elastic/otel-react-native.interactions`, required `app.widget.id`, and
optional `app.widget.name`. It has no log body or implicit span context. EDOT
Android and EDOT iOS both set the top-level EventRecord name `app.widget.click`
and emit the standard compatibility attribute
`otel.event.name=app.widget.click`. The semantic convention is currently
Development.
