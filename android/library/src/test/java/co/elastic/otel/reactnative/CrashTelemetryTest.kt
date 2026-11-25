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

import io.opentelemetry.api.common.AttributeKey
import io.opentelemetry.api.logs.Severity
import io.opentelemetry.sdk.OpenTelemetrySdk
import io.opentelemetry.sdk.logs.SdkLoggerProvider
import io.opentelemetry.sdk.logs.export.SimpleLogRecordProcessor
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class CrashTelemetryTest {
    private lateinit var sdk: OpenTelemetrySdk
    private lateinit var logs: InMemoryLogRecordExporter
    private lateinit var telemetry: CrashTelemetry

    @Before
    fun setUp() {
        logs = InMemoryLogRecordExporter()
        sdk = OpenTelemetrySdk.builder()
            .setLoggerProvider(
                SdkLoggerProvider.builder()
                    .addLogRecordProcessor(SimpleLogRecordProcessor.create(logs))
                    .build(),
            )
            .build()
        telemetry = CrashTelemetry { sdk }
    }

    @After
    fun tearDown() {
        sdk.close()
    }

    @Test
    fun emitsJavaScriptCrashRecord() {
        assertTrue(
            telemetry.recordJavaScriptCrash("TypeError", "boom", "at a:1\nat b:2", 1234.0),
        )

        val event = logs.finishedLogRecordItems.single()
        assertEquals(CRASH_EVENT_NAME, event.eventName)
        assertEquals(CRASH_INSTRUMENTATION_SCOPE, event.instrumentationScopeInfo.name)
        assertEquals(Severity.FATAL, event.severity)
        assertEquals(1_234_000_000, event.timestampEpochNanos)
        assertEquals("TypeError", event.attributes.get(AttributeKey.stringKey("exception.type")))
        assertEquals("boom", event.attributes.get(AttributeKey.stringKey("exception.message")))
        assertEquals(
            "at a:1\nat b:2",
            event.attributes.get(AttributeKey.stringKey("exception.stacktrace")),
        )
        assertEquals(
            "javascript",
            event.attributes.get(AttributeKey.stringKey("elastic.exception.source")),
        )
        assertEquals(
            CRASH_EVENT_NAME,
            event.attributes.get(AttributeKey.stringKey("otel.event.name")),
        )
        assertFalse(event.spanContext.isValid)
        assertNull(event.bodyValue)
    }

    @Test
    fun acceptsEmptyMessageAndStacktrace() {
        assertTrue(telemetry.recordJavaScriptCrash("Error", "", "", 1.0))

        assertEquals(1, logs.finishedLogRecordItems.size)
    }

    @Test
    fun returnsFalseWithoutEmissionForInvalidInput() {
        assertFalse(telemetry.recordJavaScriptCrash(" ", "m", "s", 1.0))
        assertFalse(telemetry.recordJavaScriptCrash("Error", "m", "s", Double.NaN))
        assertFalse(telemetry.recordJavaScriptCrash("Error", "m", "s", Double.POSITIVE_INFINITY))

        assertTrue(logs.finishedLogRecordItems.isEmpty())
    }

    @Test
    fun returnsFalseWhenTheSdkIsNotReady() {
        val notReady = CrashTelemetry { throw BootstrapException("not ready") }

        assertFalse(notReady.recordJavaScriptCrash("Error", "m", "s", 1.0))
    }
}
