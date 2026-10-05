package co.elastic.otel.reactnative

import io.opentelemetry.api.common.AttributeKey
import io.opentelemetry.sdk.resources.Resource
import java.io.FileNotFoundException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

private val IDENTITY = mapOf("service.name" to "fixture")

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
            BootstrapConfiguration("https://example.test/v1/logs", resourceAttributes = IDENTITY),
            BootstrapConfiguration("https://example.test/v1/metrics", resourceAttributes = IDENTITY),
            BootstrapConfiguration("https://example.test/gateway/v1/traces/", resourceAttributes = IDENTITY),
            BootstrapConfiguration("https://example.test/gateway/v1/logs/", resourceAttributes = IDENTITY),
            BootstrapConfiguration("https://example.test/gateway/v1/metrics/", resourceAttributes = IDENTITY),
            BootstrapConfiguration("https://example.test?signal=traces", resourceAttributes = IDENTITY),
            BootstrapConfiguration("https://example.test#traces", resourceAttributes = IDENTITY),
            BootstrapConfiguration(
                "https://example.test",
                authentication = AuthenticationConfiguration(apiKey = "key", secretToken = "token"),
                resourceAttributes = IDENTITY,
            ),
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
            BootstrapConfiguration("https://example.test", resourceAttributes = emptyMap()),
            BootstrapConfiguration(
                "https://example.test",
                resourceAttributes = mapOf("service.namespace" to "shop"),
            ),
            BootstrapConfiguration(
                "https://example.test",
                resourceAttributes = IDENTITY,
                instrumentationScopeName = " ",
            ),
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
                instrumentationScopeName = " co.elastic.fixture ",
                resourceAttributes = IDENTITY,
            ),
        )

        assertEquals("https://example.test/", validated.exportUrl)
        assertEquals("fixture", validated.serviceName)
        assertEquals(0.25, validated.sessionSampleRate)
        assertEquals("co.elastic.fixture", validated.instrumentationScopeName)
        assertEquals(co.elastic.otel.android.exporters.configuration.ExportProtocol.GRPC, validated.protocol)
        assertEquals("api-key", (validated.authentication as co.elastic.otel.android.connectivity.Authentication.ApiKey).key)
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
    fun duplicateInitializationKeepsTheFirstAgent() {
        val lifecycle = AgentLifecycle<String>()
        val configuration = BootstrapConfiguration("https://example.test", resourceAttributes = IDENTITY)
        var factoryInvocations = 0

        val first = lifecycle.initialize({ configuration }) {
            factoryInvocations += 1
            "agent-${System.nanoTime()}"
        }

        assertThrows(BootstrapException::class.java) {
            lifecycle.initialize({ configuration }) {
                factoryInvocations += 1
                "second-agent"
            }
        }
        assertEquals(first, lifecycle.requireAgent())
        assertEquals(1, factoryInvocations)
    }

    @Test
    fun duplicateInitializationIsReportedBeforeTheConfigurationIsRead() {
        val lifecycle = AgentLifecycle<String>()
        val first = lifecycle.initialize({
            BootstrapConfiguration("https://example.test", resourceAttributes = IDENTITY)
        }) { "agent" }
        var supplierInvocations = 0

        val exception = assertThrows(BootstrapException::class.java) {
            lifecycle.initialize({
                supplierInvocations += 1
                ConfigFileReader.read { name -> throw FileNotFoundException(name) }
            }) { "second-agent" }
        }

        assertEquals("EDOT Android has already been initialized.", exception.message)
        assertEquals(0, supplierInvocations)
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

        assertEquals(co.elastic.otel.android.exporters.configuration.ExportProtocol.HTTP, defaults.protocol)
        assertEquals(co.elastic.otel.android.connectivity.Authentication.None, defaults.authentication)
        assertEquals(DEFAULT_INSTRUMENTATION_SCOPE, defaults.instrumentationScopeName)
        assertEquals(
            "secret",
            (secretToken.authentication as co.elastic.otel.android.connectivity.Authentication.SecretToken).token,
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
