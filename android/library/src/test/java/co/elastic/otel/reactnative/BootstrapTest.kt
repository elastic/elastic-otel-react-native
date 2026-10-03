package co.elastic.otel.reactnative

import io.opentelemetry.api.common.AttributeKey
import io.opentelemetry.sdk.resources.Resource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

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
            BootstrapConfiguration("", serviceName = "fixture"),
            BootstrapConfiguration("ftp://example.test", serviceName = "fixture"),
            BootstrapConfiguration("https:///path", serviceName = "fixture"),
            BootstrapConfiguration("https://[invalid", serviceName = "fixture"),
            BootstrapConfiguration("https://example.test/v1/traces", serviceName = "fixture"),
            BootstrapConfiguration("https://example.test/v1/logs", serviceName = "fixture"),
            BootstrapConfiguration("https://example.test/v1/metrics", serviceName = "fixture"),
            BootstrapConfiguration("https://example.test/gateway/v1/traces/", serviceName = "fixture"),
            BootstrapConfiguration("https://example.test/gateway/v1/logs/", serviceName = "fixture"),
            BootstrapConfiguration("https://example.test/gateway/v1/metrics/", serviceName = "fixture"),
            BootstrapConfiguration("https://example.test?signal=traces", serviceName = "fixture"),
            BootstrapConfiguration("https://example.test#traces", serviceName = "fixture"),
            BootstrapConfiguration(
                "https://example.test",
                authentication = AuthenticationConfiguration(apiKey = "key", secretToken = "token"),
                serviceName = "fixture",
            ),
            BootstrapConfiguration(
                "https://example.test",
                authentication = AuthenticationConfiguration.apiKey(""),
                serviceName = "fixture",
            ),
            BootstrapConfiguration(
                "https://example.test",
                authentication = AuthenticationConfiguration.secretToken(""),
                serviceName = "fixture",
            ),
            BootstrapConfiguration(
                "https://example.test",
                sessionSampleRate = -0.01,
                serviceName = "fixture",
            ),
            BootstrapConfiguration(
                "https://example.test",
                sessionSampleRate = 1.01,
                serviceName = "fixture",
            ),
            BootstrapConfiguration(
                "https://example.test",
                sessionSampleRate = Double.NaN,
                serviceName = "fixture",
            ),
            BootstrapConfiguration(
                "https://example.test",
                sessionSampleRate = Double.NEGATIVE_INFINITY,
                serviceName = "fixture",
            ),
            BootstrapConfiguration(
                "https://example.test",
                sessionSampleRate = Double.POSITIVE_INFINITY,
                serviceName = "fixture",
            ),
            BootstrapConfiguration("https://example.test", serviceName = " "),
            BootstrapConfiguration(
                "https://example.test",
                serviceName = "fixture",
                instrumentationScopeName = " ",
            ),
        )

        invalidConfigurations.forEach { configuration ->
            assertThrows(BootstrapException::class.java) { lifecycle.initialize(configuration, factory) }
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
                serviceName = " fixture ",
                instrumentationScopeName = " co.elastic.fixture ",
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
                serviceName = "fixture",
            ),
        )
        val withTrailingSlash = BootstrapValidator.validate(
            BootstrapConfiguration(
                exportUrl = "https://example.test/tenant/otel/",
                serviceName = "fixture",
            ),
        )

        assertEquals("https://example.test/tenant/otel", withoutTrailingSlash.exportUrl)
        assertEquals("https://example.test/tenant/otel/", withTrailingSlash.exportUrl)
    }

    @Test
    fun duplicateInitializationKeepsTheFirstAgent() {
        val lifecycle = AgentLifecycle<String>()
        val configuration = BootstrapConfiguration("https://example.test", serviceName = "fixture")
        var factoryInvocations = 0

        val first = lifecycle.initialize(configuration) {
            factoryInvocations += 1
            "agent-${System.nanoTime()}"
        }

        assertThrows(BootstrapException::class.java) {
            lifecycle.initialize(configuration) {
                factoryInvocations += 1
                "second-agent"
            }
        }
        assertEquals(first, lifecycle.requireAgent())
        assertEquals(1, factoryInvocations)
    }

    @Test
    fun readinessChangesOnlyAfterBootstrap() {
        val lifecycle = AgentLifecycle<String>()

        assertFalse(lifecycle.isInitialized())
        assertThrows(BootstrapException::class.java) { lifecycle.requireAgent() }
        lifecycle.initialize(BootstrapConfiguration("https://example.test", serviceName = "fixture")) {
            "agent"
        }

        assertTrue(lifecycle.isInitialized())
    }

    @Test
    fun aFactoryFailureLeavesTheAgentUninitialized() {
        val lifecycle = AgentLifecycle<String>()

        assertThrows(IllegalStateException::class.java) {
            lifecycle.initialize(BootstrapConfiguration("https://example.test", serviceName = "fixture")) {
                throw IllegalStateException("factory failed")
            }
        }

        assertFalse(lifecycle.isInitialized())
    }

    @Test
    fun defaultHttpAndNoAuthenticationMapToEdot() {
        val defaults = BootstrapValidator.validate(
            BootstrapConfiguration("https://example.test", serviceName = "fixture"),
        )
        val secretToken = BootstrapValidator.validate(
            BootstrapConfiguration(
                "https://example.test",
                authentication = AuthenticationConfiguration.secretToken("secret"),
                serviceName = "fixture",
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
    fun resourceIdentityFieldsMapToEdotInputs() {
        val validated = BootstrapValidator.validate(
            BootstrapConfiguration(
                "https://example.test",
                serviceName = "fixture",
                serviceVersion = " 1.2.3 ",
                deploymentEnvironmentName = " production ",
                resourceAttributes = mapOf("service.namespace" to "shop"),
            ),
        )
        val defaults = BootstrapValidator.validate(
            BootstrapConfiguration("https://example.test", serviceName = "fixture"),
        )

        assertEquals("1.2.3", validated.serviceVersion)
        assertEquals("production", validated.deploymentEnvironmentName)
        assertEquals(mapOf("service.namespace" to "shop"), validated.resourceAttributes)
        assertEquals(null, defaults.serviceVersion)
        assertEquals(null, defaults.deploymentEnvironmentName)
        assertEquals(emptyMap<String, String>(), defaults.resourceAttributes)
    }

    @Test
    fun blankResourceIdentityFieldsAreRejected() {
        val invalidConfigurations = mapOf(
            "service version" to BootstrapConfiguration(
                "https://example.test",
                serviceName = "fixture",
                serviceVersion = " ",
            ),
            "deployment environment name" to BootstrapConfiguration(
                "https://example.test",
                serviceName = "fixture",
                deploymentEnvironmentName = "",
            ),
            "keys" to BootstrapConfiguration(
                "https://example.test",
                serviceName = "fixture",
                resourceAttributes = mapOf(" " to "value"),
            ),
            "service.namespace" to BootstrapConfiguration(
                "https://example.test",
                serviceName = "fixture",
                resourceAttributes = mapOf("service.namespace" to " "),
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
    fun reservedResourceAttributesNameTheDedicatedField() {
        mapOf(
            "service.name" to "serviceName",
            "service.version" to "serviceVersion",
            "deployment.environment.name" to "deploymentEnvironmentName",
        ).forEach { (key, dedicatedField) ->
            val exception = assertThrows(BootstrapException::class.java) {
                BootstrapValidator.validate(
                    BootstrapConfiguration(
                        "https://example.test",
                        serviceName = "fixture",
                        resourceAttributes = mapOf(key to "value"),
                    ),
                )
            }
            assertTrue(exception.message!!, exception.message!!.contains(key))
            assertTrue(exception.message!!, exception.message!!.contains(dedicatedField))
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
