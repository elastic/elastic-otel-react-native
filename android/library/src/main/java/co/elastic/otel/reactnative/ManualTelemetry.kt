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

import io.opentelemetry.api.OpenTelemetry
import io.opentelemetry.api.trace.Span
import io.opentelemetry.context.Context

internal const val DEFAULT_INSTRUMENTATION_SCOPE = "@elastic/otel-react-native"

internal class ManualTelemetry(
    private val openTelemetry: () -> OpenTelemetry,
) {
    private val spans = SpanHandleStore<Span> { it.end() }

    fun startSpan(name: String, parentSpanHandle: String?): String {
        val tracer = openTelemetry().getTracer(DEFAULT_INSTRUMENTATION_SCOPE)
        val spanName = BridgeInput.spanName(name)
        if (parentSpanHandle == null) {
            return spans.retain(
                tracer.spanBuilder(spanName)
                    .setNoParent()
                    .startSpan(),
            )
        }

        return spans.withActive(parentSpanHandle) { parent ->
            val child = tracer.spanBuilder(spanName)
                .setParent(parent.storeInContext(Context.root()))
                .startSpan()
            spans.retain(child)
        }
    }

    fun endSpan(handle: String) {
        spans.end(handle)
    }

    fun emitLog(body: String, severity: String, spanHandle: String?) {
        val level = BridgeInput.severity(severity)
        val builder = openTelemetry()
            .logsBridge
            .get(DEFAULT_INSTRUMENTATION_SCOPE)
            .logRecordBuilder()
            .setBody(BridgeInput.logBody(body))
            .setSeverity(level)
            .setSeverityText(level.name)

        if (spanHandle == null) {
            builder.setContext(Context.root()).emit()
        } else {
            spans.withActive(spanHandle) { span ->
                builder.setContext(span.storeInContext(Context.root())).emit()
            }
        }
    }
}
