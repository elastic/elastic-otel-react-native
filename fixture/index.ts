/*
 * Copyright Elastic Technologies Inc. and/or licensed to
 * Elastic Technologies Inc. under one or more contributor license
 * agreements. See the NOTICE file distributed with this work for
 * additional information regarding copyright ownership.
 * Elastic Technologies Inc. licenses this file to you under the Apache
 * License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
