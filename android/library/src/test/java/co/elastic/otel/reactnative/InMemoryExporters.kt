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

package co.elastic.otel.reactnative

import io.opentelemetry.sdk.common.CompletableResultCode
import io.opentelemetry.sdk.logs.data.LogRecordData
import io.opentelemetry.sdk.logs.export.LogRecordExporter
import io.opentelemetry.sdk.trace.data.SpanData
import io.opentelemetry.sdk.trace.export.SpanExporter

private class FinishedItems<T> {
    private val items = mutableListOf<T>()

    fun add(exported: Collection<T>): CompletableResultCode {
        synchronized(items) { items.addAll(exported) }
        return CompletableResultCode.ofSuccess()
    }

    fun snapshot(): List<T> = synchronized(items) { items.toList() }
}

class InMemorySpanExporter : SpanExporter {
    private val finished = FinishedItems<SpanData>()

    val finishedSpanItems: List<SpanData>
        get() = finished.snapshot()

    override fun export(spans: Collection<SpanData>): CompletableResultCode =
        finished.add(spans)

    override fun flush(): CompletableResultCode = CompletableResultCode.ofSuccess()

    override fun shutdown(): CompletableResultCode = CompletableResultCode.ofSuccess()
}

class InMemoryLogRecordExporter : LogRecordExporter {
    private val finished = FinishedItems<LogRecordData>()

    val finishedLogRecordItems: List<LogRecordData>
        get() = finished.snapshot()

    override fun export(logs: Collection<LogRecordData>): CompletableResultCode =
        finished.add(logs)

    override fun flush(): CompletableResultCode = CompletableResultCode.ofSuccess()

    override fun shutdown(): CompletableResultCode = CompletableResultCode.ofSuccess()
}
