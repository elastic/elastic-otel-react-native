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
