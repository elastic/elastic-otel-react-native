package co.elastic.otel.reactnative

import io.opentelemetry.api.OpenTelemetry
import io.opentelemetry.api.common.AttributeKey
import io.opentelemetry.context.Context
import java.util.concurrent.TimeUnit

internal const val INTERACTION_INSTRUMENTATION_SCOPE =
    "@elastic/otel-react-native.interactions"
internal const val WIDGET_CLICK_EVENT_NAME = "app.widget.click"

internal class InteractionTelemetry(
    private val openTelemetry: () -> OpenTelemetry,
) {
    fun recordWidgetClick(
        widgetId: String,
        widgetName: String?,
        timestamp: Double,
    ) {
        val builder = openTelemetry()
            .logsBridge
            .get(INTERACTION_INSTRUMENTATION_SCOPE)
            .logRecordBuilder()
            .setEventName(WIDGET_CLICK_EVENT_NAME)
            .setTimestamp(
                BridgeInput.eventTimestamp(timestamp).toLong(),
                TimeUnit.MILLISECONDS,
            )
            .setContext(Context.root())
            .setAttribute(
                AttributeKey.stringKey("otel.event.name"),
                WIDGET_CLICK_EVENT_NAME,
            )
            .setAttribute(
                AttributeKey.stringKey("app.widget.id"),
                BridgeInput.widgetId(widgetId),
            )

        BridgeInput.widgetName(widgetName)?.let {
            builder.setAttribute(AttributeKey.stringKey("app.widget.name"), it)
        }
        builder.emit()
    }
}
