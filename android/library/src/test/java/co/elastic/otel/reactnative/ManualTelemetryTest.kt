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

import io.opentelemetry.api.trace.SpanId
import io.opentelemetry.sdk.OpenTelemetrySdk
import io.opentelemetry.sdk.logs.SdkLoggerProvider
import io.opentelemetry.sdk.logs.export.SimpleLogRecordProcessor
import io.opentelemetry.sdk.testing.exporter.InMemoryLogRecordExporter
import io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter
import io.opentelemetry.sdk.trace.SdkTracerProvider
import io.opentelemetry.sdk.trace.export.SimpleSpanProcessor
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ManualTelemetryTest {
    private lateinit var sdk: OpenTelemetrySdk
    private lateinit var spans: InMemorySpanExporter
    private lateinit var logs: InMemoryLogRecordExporter
    private lateinit var telemetry: ManualTelemetry

    @Before
    fun setUp() {
        spans = InMemorySpanExporter.create()
        logs = InMemoryLogRecordExporter.create()
        sdk = OpenTelemetrySdk.builder()
            .setTracerProvider(
                SdkTracerProvider.builder()
                    .addSpanProcessor(SimpleSpanProcessor.create(spans))
                    .build(),
            )
            .setLoggerProvider(
                SdkLoggerProvider.builder()
                    .addLogRecordProcessor(SimpleLogRecordProcessor.create(logs))
                    .build(),
            )
            .build()
        telemetry = ManualTelemetry { sdk }
    }

    @After
    fun tearDown() {
        sdk.close()
    }

    @Test
    fun selectedContextsCorrelateChildrenAndLogsWhileOmittedHandlesStayIndependent() {
        val parent = telemetry.startSpan("parent", null)
        val child = telemetry.startSpan("child", parent)
        telemetry.emitLog("correlated", "info", child)
        telemetry.emitLog("independent", "info", null)

        telemetry.endSpan(child)
        telemetry.endSpan(parent)

        val spanData = spans.finishedSpanItems.associateBy { it.name }
        val parentData = spanData.getValue("parent")
        val childData = spanData.getValue("child")
        assertTrue(parentData.spanContext.isValid)
        assertTrue(childData.spanContext.isValid)
        assertEquals(SpanId.getInvalid(), parentData.parentSpanId)
        assertEquals(parentData.traceId, childData.traceId)
        assertEquals(parentData.spanId, childData.parentSpanId)

        val correlated = logs.finishedLogRecordItems[0]
        val independent = logs.finishedLogRecordItems[1]
        assertTrue(correlated.spanContext.isValid)
        assertEquals(childData.traceId, correlated.spanContext.traceId)
        assertEquals(childData.spanId, correlated.spanContext.spanId)
        assertFalse(independent.spanContext.isValid)
    }

    @Test
    fun spansAndLogsUseTheBridgeInstrumentationScope() {
        val span = telemetry.startSpan("scope-test", null)
        telemetry.emitLog("scope-test", "info", null)
        telemetry.endSpan(span)

        assertEquals(
            "@elastic/otel-react-native",
            spans.finishedSpanItems.single().instrumentationScopeInfo.name,
        )
        assertEquals(
            "@elastic/otel-react-native",
            logs.finishedLogRecordItems.single().instrumentationScopeInfo.name,
        )
    }

    @Test
    fun unknownMalformedAndEndedHandlesCreateNoTelemetry() {
        for (handle in listOf("", "not-a-handle", "span-404")) {
            assertThrows(BootstrapException::class.java) {
                telemetry.startSpan("child", handle)
            }
            assertThrows(BootstrapException::class.java) {
                telemetry.emitLog("log", "info", handle)
            }
        }
        assertTrue(spans.finishedSpanItems.isEmpty())
        assertTrue(logs.finishedLogRecordItems.isEmpty())

        val ended = telemetry.startSpan("ended", null)
        telemetry.endSpan(ended)
        assertThrows(BootstrapException::class.java) {
            telemetry.startSpan("child", ended)
        }
        assertThrows(BootstrapException::class.java) {
            telemetry.emitLog("log", "info", ended)
        }
        assertEquals(listOf("ended"), spans.finishedSpanItems.map { it.name })
        assertTrue(logs.finishedLogRecordItems.isEmpty())
    }

    @Test
    fun simultaneousHandlesNeverCrossAssociate() {
        val first = telemetry.startSpan("first", null)
        val second = telemetry.startSpan("second", null)
        val executor = Executors.newFixedThreadPool(4)

        try {
            val firstChild = executor.submit<String> {
                telemetry.startSpan("first-child", first)
            }
            val secondChild = executor.submit<String> {
                telemetry.startSpan("second-child", second)
            }
            val firstLog = executor.submit {
                telemetry.emitLog("first-log", "info", first)
            }
            val secondLog = executor.submit {
                telemetry.emitLog("second-log", "info", second)
            }

            val firstChildHandle = firstChild.get(5, TimeUnit.SECONDS)
            val secondChildHandle = secondChild.get(5, TimeUnit.SECONDS)
            firstLog.get(5, TimeUnit.SECONDS)
            secondLog.get(5, TimeUnit.SECONDS)
            telemetry.endSpan(firstChildHandle)
            telemetry.endSpan(secondChildHandle)
            telemetry.endSpan(first)
            telemetry.endSpan(second)
        } finally {
            executor.shutdownNow()
        }

        val spanData = spans.finishedSpanItems.associateBy { it.name }
        assertEquals(
            spanData.getValue("first").spanId,
            spanData.getValue("first-child").parentSpanId,
        )
        assertEquals(
            spanData.getValue("second").spanId,
            spanData.getValue("second-child").parentSpanId,
        )
        val logContexts = logs.finishedLogRecordItems
            .associateBy { requireNotNull(it.bodyValue).asString() }
            .mapValues { it.value.spanContext }
        assertEquals(
            spanData.getValue("first").spanId,
            logContexts.getValue("first-log").spanId,
        )
        assertEquals(
            spanData.getValue("second").spanId,
            logContexts.getValue("second-log").spanId,
        )
    }

    @Test
    fun childAndLogRacesEitherUseContextBeforeEndOrRejectAfterEnd() {
        repeat(25) { index ->
            val parent = telemetry.startSpan("race-parent-$index", null)
            val gate = CountDownLatch(1)
            val executor = Executors.newFixedThreadPool(3)

            try {
                val child = executor.submit<Result<String>> {
                    gate.await()
                    runCatching {
                        telemetry.startSpan("race-child-$index", parent)
                    }
                }
                val log = executor.submit<Result<Unit>> {
                    gate.await()
                    runCatching {
                        telemetry.emitLog("race-log-$index", "info", parent)
                    }
                }
                val end = executor.submit {
                    gate.await()
                    telemetry.endSpan(parent)
                }
                gate.countDown()

                end.get(5, TimeUnit.SECONDS)
                val childResult = child.get(5, TimeUnit.SECONDS)
                val logResult = log.get(5, TimeUnit.SECONDS)
                childResult.onSuccess(telemetry::endSpan)
                childResult.exceptionOrNull()?.let {
                    assertTrue(it is BootstrapException)
                }
                logResult.exceptionOrNull()?.let {
                    assertTrue(it is BootstrapException)
                }
            } finally {
                executor.shutdownNow()
            }
        }

        val spanData = spans.finishedSpanItems
        val parents = spanData.filter { it.name.startsWith("race-parent-") }
            .associateBy { it.name.removePrefix("race-parent-") }
        val children = spanData.filter { it.name.startsWith("race-child-") }
        assertEquals(25, parents.size)
        children.forEach { child ->
            val parent = parents.getValue(child.name.removePrefix("race-child-"))
            assertEquals(parent.traceId, child.traceId)
            assertEquals(parent.spanId, child.parentSpanId)
        }
        logs.finishedLogRecordItems.forEach { log ->
            val body = requireNotNull(log.bodyValue).asString()
            val parent = parents.getValue(body.removePrefix("race-log-"))
            assertEquals(parent.traceId, log.spanContext.traceId)
            assertEquals(parent.spanId, log.spanContext.spanId)
        }
    }
}
