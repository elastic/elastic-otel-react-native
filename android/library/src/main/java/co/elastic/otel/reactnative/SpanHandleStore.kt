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

internal class SpanHandleStore<T>(
    private val end: (T) -> Unit,
) {
    private var nextId = 1L
    private val values = mutableMapOf<String, T>()

    @Synchronized
    fun retain(value: T): String {
        val handle = "span-${nextId++}"
        values[handle] = value
        return handle
    }

    @Synchronized
    fun <R> withActive(handle: String, block: (T) -> R): R {
        val value = values[handle]
            ?: throw BootstrapException("Unknown or already-ended span handle: $handle")
        return block(value)
    }

    @Synchronized
    fun end(handle: String) {
        val value = values.remove(handle)
            ?: throw BootstrapException("Unknown or already-ended span handle: $handle")
        end(value)
    }
}
