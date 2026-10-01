package co.elastic.otel.reactnative

import org.junit.Assert.assertTrue
import org.junit.Test

class ElasticOtelReactNativeModuleTest {
    @Test
    fun bridgeMethodsAreDeclaredOnTheNativeModule() {
        val methodNames = ElasticOtelReactNativeModule::class.java.declaredMethods
            .map { it.name }
            .toSet()

        assertTrue(methodNames.contains("emitLog"))
        assertTrue(methodNames.contains("recordWidgetClick"))
    }
}
