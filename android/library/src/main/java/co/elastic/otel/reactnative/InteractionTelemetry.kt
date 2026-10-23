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
