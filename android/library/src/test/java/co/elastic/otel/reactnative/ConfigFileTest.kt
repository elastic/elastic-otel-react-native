package co.elastic.otel.reactnative

import java.io.FileNotFoundException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ConfigFileTest {
    @Test
    fun completeDocumentMapsEveryKey() {
        val configuration = ConfigFileReader.parse(
            """
            {
              "${'$'}schema": "./node_modules/@elastic/otel-react-native/elastic-otel-config.schema.json",
              "exportUrl": "https://example.test",
              "apiKey": "api-key",
              "exportProtocol": "grpc",
              "serviceName": "fixture",
              "serviceVersion": "1.2.3",
              "deploymentEnvironmentName": "production",
              "sessionSampleRate": 0.5,
              "resourceAttributes": { "service.namespace": "shop" }
            }
            """,
        )

        assertEquals(
            BootstrapConfiguration(
                exportUrl = "https://example.test",
                authentication = AuthenticationConfiguration.apiKey("api-key"),
                protocol = Transport.GRPC,
                sessionSampleRate = 0.5,
                serviceName = "fixture",
                serviceVersion = "1.2.3",
                deploymentEnvironmentName = "production",
                resourceAttributes = mapOf("service.namespace" to "shop"),
            ),
            configuration,
        )
    }

    @Test
    fun minimalDocumentKeepsDefaults() {
        val configuration = ConfigFileReader.parse(
            """{ "exportUrl": "http://localhost:4318", "serviceName": "fixture", "sessionSampleRate": 1 }""",
        )

        assertEquals(
            BootstrapConfiguration(
                exportUrl = "http://localhost:4318",
                serviceName = "fixture",
                sessionSampleRate = 1.0,
            ),
            configuration,
        )
        assertEquals(
            BootstrapConfiguration(exportUrl = "http://localhost:4318", serviceName = "fixture"),
            ConfigFileReader.parse("""{ "exportUrl": "http://localhost:4318", "serviceName": "fixture" }"""),
        )
        assertEquals(AuthenticationConfiguration.none(), configuration.authentication)
        assertEquals(Transport.HTTP, configuration.protocol)
        assertEquals(emptyMap<String, String>(), configuration.resourceAttributes)
    }

    @Test
    fun unknownTopLevelKeysAreRejected() {
        for (key in listOf("apikey", "transport", "android")) {
            assertRejected(
                """{ "exportUrl": "https://example.test", "serviceName": "fixture", "$key": "value" }""",
                key,
            )
        }
    }

    @Test
    fun mistypedValuesAreRejected() {
        assertRejected(
            """{ "exportUrl": "https://example.test", "serviceName": "fixture", "sessionSampleRate": "1" }""",
            "sessionSampleRate",
        )
        assertRejected(
            """{ "exportUrl": "https://example.test", "serviceName": "fixture", "apiKey": 42 }""",
            "apiKey",
        )
        assertRejected(
            """{ "exportUrl": "https://example.test", "serviceName": "fixture", "resourceAttributes": { "service.namespace": 1 } }""",
            "resourceAttributes.service.namespace",
        )
        assertRejected(
            """{ "exportUrl": "https://example.test", "serviceName": "fixture", "resourceAttributes": ["a"] }""",
            "resourceAttributes",
        )
        assertRejected(
            """{ "exportUrl": "https://example.test", "serviceName": null }""",
            "serviceName",
        )
        assertRejected("""{ "serviceName": "fixture" }""", "exportUrl")
        assertRejected("""["https://example.test"]""", CONFIG_FILE_NAME)
    }

    @Test
    fun blankSchemaReferenceIsRejected() {
        assertRejected(
            """{ "${'$'}schema": " ", "exportUrl": "https://example.test", "serviceName": "fixture" }""",
            "${'$'}schema",
        )
    }

    @Test
    fun unsupportedExportProtocolIsRejected() {
        assertRejected(
            """{ "exportUrl": "https://example.test", "serviceName": "fixture", "exportProtocol": "https" }""",
            "exportProtocol",
        )
    }

    @Test
    fun invalidExportUrlSurfacesTheValidatorMessage() {
        val configuration = ConfigFileReader.parse(
            """{ "exportUrl": "https://example.test/v1/traces", "serviceName": "fixture" }""",
        )

        val exception = assertThrows(BootstrapException::class.java) {
            BootstrapValidator.validate(configuration)
        }
        assertEquals("The OTLP base URL must not include a signal-specific path.", exception.message)
    }

    @Test
    fun missingAssetNamesTheFileAndTheGradleScript() {
        val requested = mutableListOf<String>()

        val exception = assertThrows(BootstrapException::class.java) {
            ConfigFileReader.read { name ->
                requested += name
                throw FileNotFoundException(name)
            }
        }

        assertEquals(listOf("elastic-otel-config.json"), requested)
        assertEquals(
            "elastic-otel-config.json was not found in the app assets. Create it at the React Native " +
                "project root and apply the bridge's Gradle script in android/app/build.gradle.",
            exception.message,
        )
    }

    @Test
    fun presentAssetIsParsed() {
        val configuration = ConfigFileReader.read {
            """{ "exportUrl": "https://example.test", "serviceName": "fixture" }""".byteInputStream()
        }

        assertEquals(BootstrapConfiguration("https://example.test", serviceName = "fixture"), configuration)
    }

    private fun assertRejected(json: String, expectedName: String) {
        val exception = assertThrows(BootstrapException::class.java) { ConfigFileReader.parse(json) }
        assertTrue(exception.message!!, exception.message!!.contains(expectedName))
    }
}
