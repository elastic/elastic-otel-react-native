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

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class SpanHandleStoreTest {
    @Test
    fun invalidHandlesCannotEndAnotherSpan() {
        val ended = mutableListOf<String>()
        val handles = SpanHandleStore<String> { ended += it }
        val first = handles.retain("first")
        val second = handles.retain("second")

        assertThrows(BootstrapException::class.java) { handles.end("unknown") }
        handles.end(first)
        assertThrows(BootstrapException::class.java) { handles.end(first) }
        assertEquals(listOf("first"), ended)

        handles.end(second)
        assertEquals(listOf("first", "second"), ended)
    }

    @Test
    fun activeUseCompletesBeforeConcurrentEnd() {
        val ended = mutableListOf<String>()
        val handles = SpanHandleStore<String> { ended += it }
        val handle = handles.retain("value")
        val callbackEntered = CountDownLatch(1)
        val releaseCallback = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)

        try {
            val use = executor.submit<String> {
                handles.withActive(handle) { value ->
                    callbackEntered.countDown()
                    releaseCallback.await(5, TimeUnit.SECONDS)
                    value
                }
            }
            callbackEntered.await(5, TimeUnit.SECONDS)
            val end = executor.submit { handles.end(handle) }

            assertFalse(end.isDone)
            releaseCallback.countDown()
            assertEquals("value", use.get(5, TimeUnit.SECONDS))
            end.get(5, TimeUnit.SECONDS)
            assertEquals(listOf("value"), ended)
            assertThrows(BootstrapException::class.java) {
                handles.withActive(handle) { value -> check(value.isNotEmpty()) }
            }
        } finally {
            executor.shutdownNow()
        }
    }
}
