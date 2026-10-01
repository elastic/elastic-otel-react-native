package co.elastic.otel.reactnative

import io.opentelemetry.api.common.AttributeKey
import io.opentelemetry.sdk.OpenTelemetrySdk
import io.opentelemetry.sdk.logs.SdkLoggerProvider
import io.opentelemetry.sdk.logs.export.SimpleLogRecordProcessor
import io.opentelemetry.sdk.testing.exporter.InMemoryLogRecordExporter
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class InteractionTelemetryTest {
    private lateinit var sdk: OpenTelemetrySdk
    private lateinit var logs: InMemoryLogRecordExporter
    private lateinit var telemetry: InteractionTelemetry

    @Before
    fun setUp() {
        logs = InMemoryLogRecordExporter.create()
        sdk = OpenTelemetrySdk.builder()
            .setLoggerProvider(
                SdkLoggerProvider.builder()
                    .addLogRecordProcessor(SimpleLogRecordProcessor.create(logs))
                    .build(),
            )
            .build()
        telemetry = InteractionTelemetry { sdk }
    }

    @After
    fun tearDown() {
        sdk.close()
    }

    @Test
    fun emitsWidgetClickEventWithTimestampScopeAndAttributes() {
        telemetry.recordWidgetClick("forecast.fetch", "Fetch forecast", 1234.0)

        val event = logs.finishedLogRecordItems.single()
        assertEquals(WIDGET_CLICK_EVENT_NAME, event.eventName)
        assertEquals(1_234_000_000, event.timestampEpochNanos)
        assertEquals(
            INTERACTION_INSTRUMENTATION_SCOPE,
            event.instrumentationScopeInfo.name,
        )
        assertEquals(
            "forecast.fetch",
            event.attributes.get(AttributeKey.stringKey("app.widget.id")),
        )
        assertEquals(
            WIDGET_CLICK_EVENT_NAME,
            event.attributes.get(AttributeKey.stringKey("otel.event.name")),
        )
        assertEquals(
            "Fetch forecast",
            event.attributes.get(AttributeKey.stringKey("app.widget.name")),
        )
        assertFalse(event.spanContext.isValid)
        assertNull(event.bodyValue)
    }

    @Test
    fun omitsOptionalName() {
        telemetry.recordWidgetClick("forecast.fetch", null, 1234.0)

        val event = logs.finishedLogRecordItems.single()
        assertFalse(
            event.attributes.asMap().containsKey(
                AttributeKey.stringKey("app.widget.name"),
            ),
        )
    }

    @Test
    fun rejectsInvalidInputWithoutEmission() {
        for (
            invalid in listOf(
                Triple("", null, 1.0),
                Triple("id", " ", 1.0),
                Triple("id", null, Double.NaN),
                Triple("id", null, Double.POSITIVE_INFINITY),
            )
        ) {
            assertThrows(BootstrapException::class.java) {
                telemetry.recordWidgetClick(invalid.first, invalid.second, invalid.third)
            }
        }
        assertTrue(logs.finishedLogRecordItems.isEmpty())
    }
}
