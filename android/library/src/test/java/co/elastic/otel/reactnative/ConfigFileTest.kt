package co.elastic.otel.reactnative

import java.io.FileNotFoundException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

private val IDENTITY = mapOf("service.name" to "fixture")

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [26])
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
              "sessionSampleRate": 0.5,
              "resourceAttributes": {
                "service.name": "fixture",
                "service.version": "1.2.3",
                "deployment.environment.name": "production",
                "service.namespace": "shop"
              }
            }
            """,
        )

        assertEquals(
            BootstrapConfiguration(
                exportUrl = "https://example.test",
                authentication = AuthenticationConfiguration.apiKey("api-key"),
                protocol = Transport.GRPC,
                sessionSampleRate = 0.5,
                resourceAttributes = mapOf(
                    "service.name" to "fixture",
                    "service.version" to "1.2.3",
                    "deployment.environment.name" to "production",
                    "service.namespace" to "shop",
                ),
            ),
            configuration,
        )
    }

    @Test
    fun minimalDocumentKeepsDefaults() {
        val configuration = ConfigFileReader.parse(
            """{ "exportUrl": "http://localhost:4318", "resourceAttributes": { "service.name": "fixture" }, "sessionSampleRate": 1 }""",
        )

        assertEquals(
            BootstrapConfiguration(
                exportUrl = "http://localhost:4318",
                resourceAttributes = IDENTITY,
                sessionSampleRate = 1.0,
            ),
            configuration,
        )
    }

    @Test
    fun unknownTopLevelKeysAreRejected() {
        for (key in listOf("apikey", "transport", "android", "serviceName", "deploymentEnvironmentName")) {
            assertRejected(
                """{ "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture" }, "$key": "value" }""",
                key,
            )
        }
    }

    @Test
    fun mistypedValuesAreRejected() {
        assertRejected(
            """{ "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture" }, "sessionSampleRate": "1" }""",
            "sessionSampleRate",
        )
        assertRejected(
            """{ "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture" }, "apiKey": 42 }""",
            "apiKey",
        )
        assertRejected(
            """{ "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture", "service.namespace": 1 } }""",
            "resourceAttributes.service.namespace",
        )
        assertRejected(
            """{ "exportUrl": "https://example.test", "resourceAttributes": ["a"] }""",
            "resourceAttributes",
        )
        assertRejected(
            """{ "exportUrl": "https://example.test", "resourceAttributes": null }""",
            "resourceAttributes",
        )
        assertRejected(
            """{ "${'$'}schema": 1, "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture" } }""",
            "${'$'}schema",
        )
        assertRejected("""{ "resourceAttributes": { "service.name": "fixture" } }""", "exportUrl")
        assertRejected("""["https://example.test"]""", CONFIG_FILE_NAME)
    }

    @Test
    fun nonStrictJsonSyntaxIsRejected() {
        val documents = listOf(
            """{ "exportUrl": "https://example.test", // comment
              "resourceAttributes": { "service.name": "fixture" } }""",
            """{ "exportUrl": 'https://example.test', "resourceAttributes": { "service.name": "fixture" } }""",
            """{ exportUrl: "https://example.test", "resourceAttributes": { "service.name": "fixture" } }""",
            """{ "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture" } } {}""",
            """{ "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture" } } x""",
        )

        for (json in documents) {
            val exception = assertThrows(BootstrapException::class.java) { ConfigFileReader.parse(json) }
            assertTrue(
                exception.message!!,
                exception.message!!.startsWith("$CONFIG_FILE_NAME must contain one JSON object: "),
            )
        }
    }

    @Test
    fun duplicateKeysAreRejected() {
        assertEquals(
            "$CONFIG_FILE_NAME contains the duplicate key exportUrl.",
            assertThrows(BootstrapException::class.java) {
                ConfigFileReader.parse(
                    """{ "exportUrl": "https://a.test", "exportUrl": "https://b.test", "resourceAttributes": { "service.name": "fixture" } }""",
                )
            }.message,
        )
        assertRejected(
            """{ "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture", "service.namespace": "a", "service.namespace": "b" } }""",
            "duplicate key resourceAttributes.service.namespace",
        )
    }

    @Test
    fun schemaReferenceIsIgnored() {
        assertEquals(
            BootstrapConfiguration("https://example.test", resourceAttributes = IDENTITY),
            ConfigFileReader.parse(
                """{ "${'$'}schema": " ", "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture" } }""",
            ),
        )
    }

    @Test
    fun missingResourceAttributesAreReadAsEmpty() {
        assertEquals(
            BootstrapConfiguration("https://example.test", resourceAttributes = emptyMap()),
            ConfigFileReader.parse("""{ "exportUrl": "https://example.test" }"""),
        )
    }

    @Test
    fun unsupportedExportProtocolIsRejected() {
        assertRejected(
            """{ "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture" }, "exportProtocol": "https" }""",
            "exportProtocol",
        )
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
            """{ "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture" } }""".byteInputStream()
        }

        assertEquals(BootstrapConfiguration("https://example.test", resourceAttributes = IDENTITY), configuration)
    }

    private fun assertRejected(json: String, expectedName: String) {
        val exception = assertThrows(BootstrapException::class.java) { ConfigFileReader.parse(json) }
        assertTrue(exception.message!!, exception.message!!.contains(expectedName))
    }
}
