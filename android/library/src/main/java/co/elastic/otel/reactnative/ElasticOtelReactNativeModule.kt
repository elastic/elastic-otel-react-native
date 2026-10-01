package co.elastic.otel.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = ElasticOtelReactNativeModule.NAME)
class ElasticOtelReactNativeModule(
    reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
    private val telemetry = ManualTelemetry(
        openTelemetry = { ElasticOtelReactNative.requireAgent().getOpenTelemetry() },
        instrumentationScopeName = { ElasticOtelReactNative.instrumentationScopeName() },
    )
    private val interactions = InteractionTelemetry(
        openTelemetry = { ElasticOtelReactNative.requireAgent().getOpenTelemetry() },
    )

    override fun getName(): String = NAME

    @ReactMethod
    fun getStatus(promise: Promise) {
        val status = Arguments.createMap().apply {
            putBoolean("ready", ElasticOtelReactNative.isReady())
            putString("state", if (ElasticOtelReactNative.isReady()) "ready" else "not_ready")
        }
        promise.resolve(status)
    }

    @ReactMethod
    fun startSpan(name: String, parentSpanHandle: String?, promise: Promise) {
        resolve(promise) {
            telemetry.startSpan(name, parentSpanHandle)
        }
    }

    @ReactMethod
    fun endSpan(handle: String, promise: Promise) {
        resolve(promise) {
            telemetry.endSpan(handle)
            null
        }
    }

    @ReactMethod
    fun emitLog(body: String, severity: String, spanHandle: String?, promise: Promise) {
        resolve(promise) {
            telemetry.emitLog(body, severity, spanHandle)
            null
        }
    }

    @ReactMethod
    fun recordWidgetClick(
        widgetId: String,
        widgetName: String?,
        timestamp: Double,
        promise: Promise,
    ) {
        resolve(promise) {
            interactions.recordWidgetClick(widgetId, widgetName, timestamp)
            null
        }
    }

    private fun <T> resolve(promise: Promise, block: () -> T) {
        try {
            promise.resolve(block())
        } catch (exception: Exception) {
            promise.reject("E_ELASTIC_OTEL_REACT_NATIVE", exception.message, exception)
        }
    }

    companion object {
        const val NAME = "ElasticOtelReactNative"
    }
}
