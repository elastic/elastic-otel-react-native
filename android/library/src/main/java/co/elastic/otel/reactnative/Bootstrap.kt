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

import android.app.Application
import co.elastic.otel.android.ElasticApmAgent
import co.elastic.otel.android.api.ElasticOtelAgent
import co.elastic.otel.android.connectivity.Authentication
import co.elastic.otel.android.exporters.configuration.ExportProtocol
import co.elastic.otel.android.interceptor.Interceptor
import io.opentelemetry.sdk.resources.Resource
import java.net.URI

// EDOT Android identifies its OpAMP central configuration client from the
// builder's service values, so these resource attributes go to its setters
// instead of the resource interceptor.
private const val SERVICE_NAME = "service.name"
private const val SERVICE_VERSION = "service.version"
private const val DEPLOYMENT_ENVIRONMENT_NAME = "deployment.environment.name"
private val BUILDER_RESOURCE_ATTRIBUTES = setOf(SERVICE_NAME, SERVICE_VERSION, DEPLOYMENT_ENVIRONMENT_NAME)

data class BootstrapConfiguration(
    val exportUrl: String,
    val authentication: AuthenticationConfiguration = AuthenticationConfiguration.none(),
    val protocol: Transport = Transport.HTTP,
    val sessionSampleRate: Double? = null,
    val resourceAttributes: Map<String, String>,
)

sealed class AuthenticationConfiguration {
    data class ApiKey(val key: String) : AuthenticationConfiguration() {
        override fun toString(): String = "ApiKey(key.length=${key.length})"
    }

    data class SecretToken(val token: String) : AuthenticationConfiguration() {
        override fun toString(): String = "SecretToken(token.length=${token.length})"
    }

    data object None : AuthenticationConfiguration()

    companion object {
        fun none(): AuthenticationConfiguration = None

        fun apiKey(value: String): AuthenticationConfiguration = ApiKey(value)

        fun secretToken(value: String): AuthenticationConfiguration = SecretToken(value)
    }
}

enum class Transport {
    HTTP,
    GRPC,
}

class BootstrapException(message: String) : IllegalArgumentException(message)

internal data class ValidatedBootstrapConfiguration(
    val exportUrl: String,
    val authentication: Authentication,
    val protocol: ExportProtocol,
    val sessionSampleRate: Double?,
    val serviceName: String,
    val serviceVersion: String?,
    val deploymentEnvironmentName: String?,
    val otherResourceAttributes: Map<String, String>,
)

internal object BootstrapValidator {
    fun validate(configuration: BootstrapConfiguration): ValidatedBootstrapConfiguration {
        val exportUrl = configuration.exportUrl.trim()
        if (exportUrl.isEmpty()) {
            throw BootstrapException("An OTLP export URL is required.")
        }

        val uri = try {
            URI(exportUrl)
        } catch (exception: Exception) {
            throw BootstrapException("The OTLP export URL is invalid.")
        }
        val scheme = uri.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") {
            throw BootstrapException("The OTLP export URL must use http or https.")
        }
        if (uri.host.isNullOrBlank()) {
            throw BootstrapException("The OTLP export URL must include a host.")
        }
        if (uri.rawQuery != null || uri.rawFragment != null) {
            throw BootstrapException("The OTLP base URL must not include a query or fragment.")
        }
        val normalizedPath = uri.path.orEmpty().lowercase().trimEnd('/')
        if (
            normalizedPath.endsWith("/v1/traces") ||
            normalizedPath.endsWith("/v1/logs") ||
            normalizedPath.endsWith("/v1/metrics")
        ) {
            throw BootstrapException("The OTLP base URL must not include a signal-specific path.")
        }
        val sampleRate = configuration.sessionSampleRate
        if (sampleRate != null && (!sampleRate.isFinite() || sampleRate !in 0.0..1.0)) {
            throw BootstrapException("The session sample rate must be between 0 and 1.")
        }
        val attributes = configuration.resourceAttributes
        validateResourceAttributes(attributes)
        val serviceName = attributes[SERVICE_NAME]
            ?: throw BootstrapException("The resource attribute $SERVICE_NAME is required.")

        return ValidatedBootstrapConfiguration(
            exportUrl = exportUrl,
            authentication = validateAuthentication(configuration.authentication),
            protocol = if (configuration.protocol == Transport.HTTP) {
                ExportProtocol.HTTP
            } else {
                ExportProtocol.GRPC
            },
            sessionSampleRate = sampleRate,
            serviceName = serviceName,
            serviceVersion = attributes[SERVICE_VERSION],
            deploymentEnvironmentName = attributes[DEPLOYMENT_ENVIRONMENT_NAME],
            otherResourceAttributes = attributes - BUILDER_RESOURCE_ATTRIBUTES,
        )
    }

    private fun validateResourceAttributes(attributes: Map<String, String>) {
        for ((key, value) in attributes) {
            if (key.isBlank()) {
                throw BootstrapException("Resource attribute keys must not be blank.")
            }
            if (value.isBlank()) {
                throw BootstrapException("The resource attribute $key must not be blank.")
            }
            if (key.length > 255 || key.any { it.code !in 32..126 }) {
                throw BootstrapException(
                    "The resource attribute key $key must be at most 255 printable ASCII characters.",
                )
            }
        }
    }

    private fun validateAuthentication(configuration: AuthenticationConfiguration): Authentication =
        when (configuration) {
            is AuthenticationConfiguration.ApiKey -> {
                if (configuration.key.isBlank()) {
                    throw BootstrapException("The API key must not be blank.")
                }
                Authentication.ApiKey(configuration.key)
            }
            is AuthenticationConfiguration.SecretToken -> {
                if (configuration.token.isBlank()) {
                    throw BootstrapException("The secret token must not be blank.")
                }
                Authentication.SecretToken(configuration.token)
            }
            AuthenticationConfiguration.None -> Authentication.None
        }
}

// Replaces the native dataset with the React Native default, then applies
// explicit bridge attributes. Other native resource attributes are preserved.
internal fun resourceAttributesInterceptor(attributes: Map<String, String>): Interceptor<Resource> =
    Interceptor { resource ->
        resource.toBuilder()
            .put("data_stream.dataset", "react_native")
            .apply { attributes.forEach { (key, value) -> put(key, value) } }
            .build()
    }

internal class AgentLifecycle<A> {
    private var initializedAgent: A? = null

    // Supplies the configuration only after the duplicate check, so a repeated
    // call reports the duplicate instead of a configuration error.
    @Synchronized
    fun initialize(
        configuration: () -> BootstrapConfiguration,
        factory: (ValidatedBootstrapConfiguration) -> A,
    ): A {
        if (initializedAgent != null) {
            throw BootstrapException("EDOT Android has already been initialized.")
        }
        val validated = BootstrapValidator.validate(configuration())

        return factory(validated).also { initializedAgent = it }
    }

    @Synchronized
    fun requireAgent(): A {
        return initializedAgent
            ?: throw BootstrapException("EDOT Android is not initialized. Bootstrap it in Application.onCreate.")
    }

    @Synchronized
    fun isInitialized(): Boolean = initializedAgent != null
}

object ElasticOtelReactNative {
    private val lifecycle = AgentLifecycle<ElasticOtelAgent>()

    // Reads elastic-otel-config.json, which the bridge's Gradle script copies
    // from the React Native project root into the app assets.
    @JvmStatic
    fun initialize(application: Application): ElasticOtelAgent =
        initialize(application) { ConfigFileReader.read(application.assets::open) }

    @JvmStatic
    fun initialize(application: Application, configuration: BootstrapConfiguration): ElasticOtelAgent =
        initialize(application) { configuration }

    private fun initialize(
        application: Application,
        configuration: () -> BootstrapConfiguration,
    ): ElasticOtelAgent =
        lifecycle.initialize(configuration) { validated ->
            ElasticApmAgent.builder(application)
                .setExportUrl(validated.exportUrl)
                .setExportAuthentication(validated.authentication)
                .setExportProtocol(validated.protocol)
                .setServiceName(validated.serviceName)
                .apply {
                    validated.sessionSampleRate?.let(::setSessionSampleRate)
                    validated.serviceVersion?.let(::setServiceVersion)
                    validated.deploymentEnvironmentName?.let(::setDeploymentEnvironment)
                    setResourceInterceptor(resourceAttributesInterceptor(validated.otherResourceAttributes))
                }
                .build()
        }

    @JvmStatic
    fun isReady(): Boolean = lifecycle.isInitialized()

    internal fun requireAgent(): ElasticOtelAgent = lifecycle.requireAgent()
}
