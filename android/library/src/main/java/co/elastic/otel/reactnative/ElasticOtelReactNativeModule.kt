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
    private val openTelemetry = { ElasticOtelReactNative.requireAgent().getOpenTelemetry() }
    private val telemetry = ManualTelemetry(openTelemetry = openTelemetry)
    private val interactions = InteractionTelemetry(openTelemetry = openTelemetry)

    override fun getName(): String = NAME

    @ReactMethod
    fun getStatus(promise: Promise) {
        val status = Arguments.createMap().apply {
            putBoolean("ready", ElasticOtelReactNative.isReady())
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
