package co.elastic.otel.reactnative

import co.elastic.otel.android.connectivity.Authentication
import co.elastic.otel.android.exporters.configuration.ExportProtocol
import io.opentelemetry.api.common.AttributeKey
import io.opentelemetry.sdk.resources.Resource
import java.io.FileNotFoundException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

private val IDENTITY = mapOf("service.name" to "fixture")

// The iOS BootstrapTests use the same two lists.
private val SIGNAL_PATHS = listOf(
    "/v1/traces",
    "/v1/logs",
    "/v1/metrics",
    "/v1/traces/",
    "/v1/logs/",
    "/v1/metrics/",
    "/gateway/v1/traces/",
    "/gateway/v1/logs/",
    "/gateway/v1/metrics/",
    "/V1/Traces",
    "/V1/Logs",
    "/V1/Metrics",
)
private val BASE_PATHS = listOf("", "/gateway", "/v1/tracesx")

class BootstrapTest {
    @Test
    fun invalidConfigurationsLeaveTheAgentUninitialized() {
        val created = mutableListOf<ValidatedBootstrapConfiguration>()
        val lifecycle = AgentLifecycle<String>()
        val factory: (ValidatedBootstrapConfiguration) -> String = { configuration ->
            created += configuration
            "agent"
        }
        val invalidConfigurations = listOf(
            BootstrapConfiguration("", resourceAttributes = IDENTITY),
            BootstrapConfiguration("ftp://example.test", resourceAttributes = IDENTITY),
            BootstrapConfiguration("https:///path", resourceAttributes = IDENTITY),
            BootstrapConfiguration("https://[invalid", resourceAttributes = IDENTITY),
            BootstrapConfiguration("https://example.test/v1/traces", resourceAttributes = IDENTITY),
            BootstrapConfiguration("https://example.test?signal=traces", resourceAttributes = IDENTITY),
            BootstrapConfiguration("https://example.test#traces", resourceAttributes = IDENTITY),
            BootstrapConfiguration(
                "https://example.test",
                authentication = AuthenticationConfiguration.apiKey(""),
                resourceAttributes = IDENTITY,
            ),
            BootstrapConfiguration(
                "https://example.test",
                authentication = AuthenticationConfiguration.secretToken(""),
                resourceAttributes = IDENTITY,
            ),
            BootstrapConfiguration(
                "https://example.test",
                sessionSampleRate = -0.01,
                resourceAttributes = IDENTITY,
            ),
            BootstrapConfiguration(
                "https://example.test",
                sessionSampleRate = 1.01,
                resourceAttributes = IDENTITY,
            ),
            BootstrapConfiguration(
                "https://example.test",
                sessionSampleRate = Double.NaN,
                resourceAttributes = IDENTITY,
            ),
            BootstrapConfiguration(
                "https://example.test",
                sessionSampleRate = Double.NEGATIVE_INFINITY,
                resourceAttributes = IDENTITY,
            ),
            BootstrapConfiguration(
                "https://example.test",
                sessionSampleRate = Double.POSITIVE_INFINITY,
                resourceAttributes = IDENTITY,
            ),
            BootstrapConfiguration("https://example.test", resourceAttributes = mapOf("service.name" to " ")),
        )

        invalidConfigurations.forEach { configuration ->
            assertThrows(BootstrapException::class.java) { lifecycle.initialize({ configuration }, factory) }
            assertFalse(lifecycle.isInitialized())
        }
        assertTrue(created.isEmpty())
    }

    @Test
    fun validConfigurationMapsToEdotInputs() {
        val validated = BootstrapValidator.validate(
            BootstrapConfiguration(
                exportUrl = " https://example.test/ ",
                authentication = AuthenticationConfiguration.apiKey("api-key"),
                protocol = Transport.GRPC,
                sessionSampleRate = 0.25,
                resourceAttributes = IDENTITY,
            ),
        )

        assertEquals("https://example.test/", validated.exportUrl)
        assertEquals("fixture", validated.serviceName)
        assertEquals(0.25, validated.sessionSampleRate)
        assertEquals(ExportProtocol.GRPC, validated.protocol)
        assertEquals("api-key", (validated.authentication as Authentication.ApiKey).key)
    }

    @Test
    fun gatewayPathPrefixesAreValidOtlpBaseUrls() {
        val withoutTrailingSlash = BootstrapValidator.validate(
            BootstrapConfiguration(
                exportUrl = "https://example.test/tenant/otel",
                resourceAttributes = IDENTITY,
            ),
        )
        val withTrailingSlash = BootstrapValidator.validate(
            BootstrapConfiguration(
                exportUrl = "https://example.test/tenant/otel/",
                resourceAttributes = IDENTITY,
            ),
        )

        assertEquals("https://example.test/tenant/otel", withoutTrailingSlash.exportUrl)
        assertEquals("https://example.test/tenant/otel/", withTrailingSlash.exportUrl)
    }

    @Test
    fun signalSpecificPathsAreRejectedAndBasePathsAccepted() {
        SIGNAL_PATHS.forEach { path ->
            val exception = assertThrows(path, BootstrapException::class.java) {
                BootstrapValidator.validate(
                    BootstrapConfiguration("https://example.test$path", resourceAttributes = IDENTITY),
                )
            }
            assertEquals(path, "The OTLP base URL must not include a signal-specific path.", exception.message)
        }
        BASE_PATHS.forEach { path ->
            BootstrapValidator.validate(
                BootstrapConfiguration("https://example.test$path", resourceAttributes = IDENTITY),
            )
        }
    }

    @Test
    fun secretsAreNotPrintedByTheirStringForm() {
        val apiKey = AuthenticationConfiguration.apiKey("api-key-secret").toString()
        val secretToken = AuthenticationConfiguration.secretToken("secret-token-value").toString()

        assertEquals("ApiKey(key.length=14)", apiKey)
        assertEquals("SecretToken(token.length=18)", secretToken)
    }

    @Test
    fun duplicateInitializationIsReportedBeforeTheConfigurationIsRead() {
        val lifecycle = AgentLifecycle<String>()
        var factoryInvocations = 0
        val first = lifecycle.initialize({
            BootstrapConfiguration("https://example.test", resourceAttributes = IDENTITY)
        }) {
            factoryInvocations += 1
            "agent"
        }
        var supplierInvocations = 0

        val exception = assertThrows(BootstrapException::class.java) {
            lifecycle.initialize({
                supplierInvocations += 1
                ConfigFileReader.read { name -> throw FileNotFoundException(name) }
            }) {
                factoryInvocations += 1
                "second-agent"
            }
        }

        assertEquals("EDOT Android has already been initialized.", exception.message)
        assertEquals(0, supplierInvocations)
        assertEquals(1, factoryInvocations)
        assertEquals(first, lifecycle.requireAgent())
    }

    @Test
    fun readinessChangesOnlyAfterBootstrap() {
        val lifecycle = AgentLifecycle<String>()

        assertFalse(lifecycle.isInitialized())
        assertThrows(BootstrapException::class.java) { lifecycle.requireAgent() }
        lifecycle.initialize({ BootstrapConfiguration("https://example.test", resourceAttributes = IDENTITY) }) {
            "agent"
        }

        assertTrue(lifecycle.isInitialized())
    }

    @Test
    fun aFactoryFailureLeavesTheAgentUninitialized() {
        val lifecycle = AgentLifecycle<String>()

        assertThrows(IllegalStateException::class.java) {
            lifecycle.initialize({ BootstrapConfiguration("https://example.test", resourceAttributes = IDENTITY) }) {
                throw IllegalStateException("factory failed")
            }
        }

        assertFalse(lifecycle.isInitialized())
    }

    @Test
    fun defaultHttpAndNoAuthenticationMapToEdot() {
        val defaults = BootstrapValidator.validate(
            BootstrapConfiguration("https://example.test", resourceAttributes = IDENTITY),
        )
        val secretToken = BootstrapValidator.validate(
            BootstrapConfiguration(
                "https://example.test",
                authentication = AuthenticationConfiguration.secretToken("secret"),
                resourceAttributes = IDENTITY,
            ),
        )

        assertEquals(ExportProtocol.HTTP, defaults.protocol)
        assertEquals(Authentication.None, defaults.authentication)
        assertEquals(
            "secret",
            (secretToken.authentication as Authentication.SecretToken).token,
        )
    }

    @Test
    fun builderIdentityAttributesAreSplitFromTheOtherResourceAttributes() {
        val validated = BootstrapValidator.validate(
            BootstrapConfiguration(
                "https://example.test",
                resourceAttributes = mapOf(
                    "service.name" to "fixture",
                    "service.version" to "1.2.3",
                    "deployment.environment.name" to "production",
                    "service.namespace" to "shop",
                    "custom.key" to "value",
                ),
            ),
        )
        val nameOnly = BootstrapValidator.validate(
            BootstrapConfiguration("https://example.test", resourceAttributes = IDENTITY),
        )

        assertEquals("fixture", validated.serviceName)
        assertEquals("1.2.3", validated.serviceVersion)
        assertEquals("production", validated.deploymentEnvironmentName)
        assertEquals(
            mapOf("service.namespace" to "shop", "custom.key" to "value"),
            validated.otherResourceAttributes,
        )
        assertEquals("fixture", nameOnly.serviceName)
        assertEquals(null, nameOnly.serviceVersion)
        assertEquals(null, nameOnly.deploymentEnvironmentName)
        assertEquals(emptyMap<String, String>(), nameOnly.otherResourceAttributes)
    }

    @Test
    fun blankResourceIdentityFieldsAreRejected() {
        val invalidConfigurations = mapOf(
            "service.version" to BootstrapConfiguration(
                "https://example.test",
                resourceAttributes = IDENTITY + ("service.version" to " "),
            ),
            "deployment.environment.name" to BootstrapConfiguration(
                "https://example.test",
                resourceAttributes = IDENTITY + ("deployment.environment.name" to ""),
            ),
            "keys" to BootstrapConfiguration(
                "https://example.test",
                resourceAttributes = IDENTITY + (" " to "value"),
            ),
            "service.namespace" to BootstrapConfiguration(
                "https://example.test",
                resourceAttributes = IDENTITY + ("service.namespace" to " "),
            ),
        )

        invalidConfigurations.forEach { (subject, configuration) ->
            val exception = assertThrows(BootstrapException::class.java) {
                BootstrapValidator.validate(configuration)
            }
            assertTrue(exception.message!!, exception.message!!.contains(subject))
        }
    }

    @Test
    fun aMissingServiceNameIsRejected() {
        listOf(emptyMap(), mapOf("service.namespace" to "shop")).forEach { attributes ->
            val exception = assertThrows(BootstrapException::class.java) {
                BootstrapValidator.validate(
                    BootstrapConfiguration("https://example.test", resourceAttributes = attributes),
                )
            }
            assertEquals("The resource attribute service.name is required.", exception.message)
        }
    }

    @Test
    fun resourceAttributesAreAddedWithoutRemovingExistingAttributes() {
        val existing = Resource.builder()
            .put("service.name", "fixture")
            .put("os.name", "Android")
            .build()

        val intercepted = resourceAttributesInterceptor(mapOf("service.namespace" to "x"))
            .intercept(existing)

        assertEquals(
            mapOf(
                AttributeKey.stringKey("service.name") to "fixture",
                AttributeKey.stringKey("os.name") to "Android",
                AttributeKey.stringKey("service.namespace") to "x",
            ),
            intercepted.attributes.asMap(),
        )
    }
}
