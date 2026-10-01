import {
  emitLog,
  endSpan,
  recordWidgetClick,
  startSpan,
} from '@elastic/otel-react-native';

async function exerciseManualTelemetry(): Promise<void> {
  const legacy = await startSpan('legacy');
  await emitLog('legacy log', 'info');
  await endSpan(legacy);

  const parent = await startSpan('parent');
  const child = await startSpan('child', { parentSpanHandle: parent });
  await emitLog('correlated log', 'warn', { spanHandle: child });
  await endSpan(child);
  await endSpan(parent);
  await recordWidgetClick({
    widgetId: 'fixture.manual',
    timestamp: Date.now(),
  });
}

void exerciseManualTelemetry();
