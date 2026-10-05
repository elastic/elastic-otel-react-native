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
