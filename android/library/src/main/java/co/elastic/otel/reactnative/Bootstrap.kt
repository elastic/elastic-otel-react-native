package co.elastic.otel.reactnative

import android.app.Application
import co.elastic.otel.android.ElasticApmAgent
import co.elastic.otel.android.api.ElasticOtelAgent
import co.elastic.otel.android.connectivity.Authentication
import co.elastic.otel.android.exporters.configuration.ExportProtocol
import java.net.URI

internal const val DEFAULT_INSTRUMENTATION_SCOPE = "@elastic/otel-react-native"

data class BootstrapConfiguration(
    val exportUrl: String,
    val authentication: AuthenticationConfiguration = AuthenticationConfiguration.none(),
    val protocol: Transport = Transport.HTTP,
    val sessionSampleRate: Double? = null,
    val serviceName: String,
    val instrumentationScopeName: String = DEFAULT_INSTRUMENTATION_SCOPE,
)

data class AuthenticationConfiguration(
    val apiKey: String? = null,
    val secretToken: String? = null,
) {
    companion object {
        fun none() = AuthenticationConfiguration()

        fun apiKey(value: String) = AuthenticationConfiguration(apiKey = value)

        fun secretToken(value: String) = AuthenticationConfiguration(secretToken = value)
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
    val instrumentationScopeName: String,
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
        val normalizedPath = uri.path.orEmpty().trimEnd('/')
        if (
            normalizedPath.endsWith("/v1/traces") ||
            normalizedPath.endsWith("/v1/logs") ||
            normalizedPath.endsWith("/v1/metrics")
        ) {
            throw BootstrapException("The OTLP base URL must not include a signal-specific path.")
        }
        if (configuration.serviceName.isBlank()) {
            throw BootstrapException("A service name is required.")
        }
        val instrumentationScopeName = configuration.instrumentationScopeName.trim()
        if (instrumentationScopeName.isEmpty()) {
            throw BootstrapException("The instrumentation scope name must not be blank.")
        }
        val sampleRate = configuration.sessionSampleRate
        if (sampleRate != null && (!sampleRate.isFinite() || sampleRate !in 0.0..1.0)) {
            throw BootstrapException("The session sample rate must be between 0 and 1.")
        }

        return ValidatedBootstrapConfiguration(
            exportUrl = exportUrl,
            authentication = validateAuthentication(configuration.authentication),
            protocol = if (configuration.protocol == Transport.HTTP) {
                ExportProtocol.HTTP
            } else {
                ExportProtocol.GRPC
            },
            sessionSampleRate = sampleRate,
            serviceName = configuration.serviceName.trim(),
            instrumentationScopeName = instrumentationScopeName,
        )
    }

    private fun validateAuthentication(configuration: AuthenticationConfiguration): Authentication {
        val apiKey = configuration.apiKey
        val secretToken = configuration.secretToken
        if (apiKey != null && secretToken != null) {
            throw BootstrapException("Choose only one authentication method.")
        }
        if (apiKey != null) {
            if (apiKey.isBlank()) {
                throw BootstrapException("The API key must not be blank.")
            }
            return Authentication.ApiKey(apiKey)
        }
        if (secretToken != null) {
            if (secretToken.isBlank()) {
                throw BootstrapException("The secret token must not be blank.")
            }
            return Authentication.SecretToken(secretToken)
        }
        return Authentication.None
    }
}

internal class AgentLifecycle<A> {
    private var initializedAgent: A? = null

    @Synchronized
    fun initialize(
        configuration: BootstrapConfiguration,
        factory: (ValidatedBootstrapConfiguration) -> A,
    ): A {
        val validated = BootstrapValidator.validate(configuration)
        if (initializedAgent != null) {
            throw BootstrapException("EDOT Android has already been initialized.")
        }

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
    @Volatile
    private var configuredInstrumentationScopeName = DEFAULT_INSTRUMENTATION_SCOPE

    @JvmStatic
    fun initialize(application: Application, configuration: BootstrapConfiguration): ElasticOtelAgent {
        var instrumentationScopeName = DEFAULT_INSTRUMENTATION_SCOPE
        val agent = lifecycle.initialize(configuration) { validated ->
            instrumentationScopeName = validated.instrumentationScopeName
            ElasticApmAgent.builder(application)
                .setExportUrl(validated.exportUrl)
                .setExportAuthentication(validated.authentication)
                .setExportProtocol(validated.protocol)
                .setServiceName(validated.serviceName)
                .apply {
                    validated.sessionSampleRate?.let(::setSessionSampleRate)
                }
                .build()
        }
        configuredInstrumentationScopeName = instrumentationScopeName
        return agent
    }

    @JvmStatic
    fun isReady(): Boolean = lifecycle.isInitialized()

    internal fun requireAgent(): ElasticOtelAgent = lifecycle.requireAgent()

    internal fun instrumentationScopeName(): String = configuredInstrumentationScopeName
}
