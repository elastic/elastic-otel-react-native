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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class BridgeInputTest {
    @Test
    fun bridgeRejectsBlankBodiesNamesAndUnknownSeverities() {
        assertThrows(BootstrapException::class.java) { BridgeInput.spanName(" ") }
        assertThrows(BootstrapException::class.java) { BridgeInput.logBody(" ") }
        assertThrows(BootstrapException::class.java) { BridgeInput.severity("verbose") }
    }

    @Test
    fun bridgeMapsOnlyStandardSeverities() {
        assertEquals(Severity.TRACE, BridgeInput.severity("trace"))
        assertEquals(Severity.DEBUG, BridgeInput.severity("debug"))
        assertEquals(Severity.INFO, BridgeInput.severity("info"))
        assertEquals(Severity.WARN, BridgeInput.severity("warn"))
        assertEquals(Severity.ERROR, BridgeInput.severity("error"))
        assertEquals(Severity.FATAL, BridgeInput.severity("fatal"))
    }
}
