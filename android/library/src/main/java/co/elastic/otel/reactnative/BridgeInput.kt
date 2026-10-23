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
