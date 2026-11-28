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
import io.opentelemetry.api.common.AttributeKey
import io.opentelemetry.api.logs.Severity
import io.opentelemetry.context.Context
import java.util.concurrent.TimeUnit

internal const val CRASH_INSTRUMENTATION_SCOPE = "@elastic/otel-react-native"
internal const val CRASH_EVENT_NAME = "app.crash"
internal const val EXCEPTION_SOURCE_JAVASCRIPT = "javascript"

internal class CrashTelemetry(
    private val openTelemetry: () -> OpenTelemetry,
) {
    /**
     * Emits the crash record of an uncaught JavaScript exception. Returns
     * whether the record was emitted; never throws, because the caller runs
     * inside the app's fatal-error path.
     */
    fun recordJavaScriptCrash(
        type: String,
        message: String,
        stacktrace: String,
        timestamp: Double,
    ): Boolean {
        return try {
            openTelemetry()
                .logsBridge
                .get(CRASH_INSTRUMENTATION_SCOPE)
                .logRecordBuilder()
                .setEventName(CRASH_EVENT_NAME)
                .setSeverity(Severity.FATAL)
                .setTimestamp(
                    BridgeInput.eventTimestamp(timestamp).toLong(),
                    TimeUnit.MILLISECONDS,
                )
                .setContext(Context.root())
                .setAttribute(
                    AttributeKey.stringKey("otel.event.name"),
                    CRASH_EVENT_NAME,
                )
                .setAttribute(
                    AttributeKey.stringKey("exception.type"),
                    BridgeInput.exceptionType(type),
                )
                .setAttribute(AttributeKey.stringKey("exception.message"), message)
                .setAttribute(
                    AttributeKey.stringKey("exception.stacktrace"),
                    stacktrace,
                )
                .setAttribute(
                    AttributeKey.stringKey("elastic.exception.source"),
                    EXCEPTION_SOURCE_JAVASCRIPT,
                )
                .emit()
            true
        } catch (_: Exception) {
            false
        }
    }
}
