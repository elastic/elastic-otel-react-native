package co.elastic.otel.reactnative

import io.opentelemetry.api.logs.Severity

internal object BridgeInput {
    fun spanName(value: String): String {
        if (value.isBlank()) {
            throw BootstrapException("A span name is required.")
        }
        return value
    }

    fun logBody(value: String): String {
        if (value.isBlank()) {
            throw BootstrapException("A log body is required.")
        }
        return value
    }

    fun severity(value: String): Severity {
        return when (value.lowercase()) {
            "trace" -> Severity.TRACE
            "debug" -> Severity.DEBUG
            "info" -> Severity.INFO
            "warn" -> Severity.WARN
            "error" -> Severity.ERROR
            "fatal" -> Severity.FATAL
            else -> throw BootstrapException("Unsupported log severity: $value")
        }
    }

    fun widgetId(value: String): String {
        if (value.isBlank()) {
            throw BootstrapException("A widget ID is required.")
        }
        return value
    }

    fun widgetName(value: String?): String? {
        if (value != null && value.isBlank()) {
            throw BootstrapException("A widget name must not be blank.")
        }
        return value
    }

    fun eventTimestamp(value: Double): Double {
        if (!value.isFinite()) {
            throw BootstrapException("A finite event timestamp is required.")
        }
        return value
    }
}
