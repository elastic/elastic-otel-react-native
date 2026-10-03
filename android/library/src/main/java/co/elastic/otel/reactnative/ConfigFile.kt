package co.elastic.otel.reactnative

import java.io.FileNotFoundException
import java.io.InputStream
import org.json.JSONException
import org.json.JSONObject

internal const val CONFIG_FILE_NAME = "elastic-otel-config.json"

// Reads elastic-otel-config.json into a BootstrapConfiguration. This reader
// checks only the document shape: known keys and JSON types. BootstrapValidator
// owns every value rule, except the nonblank $schema reference, which never
// reaches it.
internal object ConfigFileReader {
    private const val SCHEMA_KEY = "\$schema"
    private val KNOWN_KEYS = setOf(
        SCHEMA_KEY,
        "exportUrl",
        "apiKey",
        "exportProtocol",
        "serviceName",
        "serviceVersion",
        "deploymentEnvironmentName",
        "sessionSampleRate",
        "resourceAttributes",
    )

    fun read(openAsset: (String) -> InputStream): BootstrapConfiguration {
        val json = try {
            openAsset(CONFIG_FILE_NAME).use { it.readBytes().toString(Charsets.UTF_8) }
        } catch (exception: FileNotFoundException) {
            throw BootstrapException(
                "$CONFIG_FILE_NAME was not found in the app assets. Create it at the React Native " +
                    "project root and apply the bridge's Gradle script in android/app/build.gradle.",
            )
        }
        return parse(json)
    }

    fun parse(json: String): BootstrapConfiguration {
        val document = try {
            JSONObject(json)
        } catch (exception: JSONException) {
            throw BootstrapException("$CONFIG_FILE_NAME must contain one JSON object: ${exception.message}")
        }
        for (key in document.keys()) {
            if (key !in KNOWN_KEYS) {
                throw BootstrapException("$CONFIG_FILE_NAME contains the unknown key $key.")
            }
        }
        if (optionalString(document, SCHEMA_KEY)?.isBlank() == true) {
            throw BootstrapException("$CONFIG_FILE_NAME key $SCHEMA_KEY must not be blank.")
        }

        return BootstrapConfiguration(
            exportUrl = requiredString(document, "exportUrl"),
            authentication = optionalString(document, "apiKey")
                ?.let(AuthenticationConfiguration::apiKey)
                ?: AuthenticationConfiguration.none(),
            protocol = protocol(document),
            sessionSampleRate = optionalNumber(document, "sessionSampleRate"),
            serviceName = requiredString(document, "serviceName"),
            serviceVersion = optionalString(document, "serviceVersion"),
            deploymentEnvironmentName = optionalString(document, "deploymentEnvironmentName"),
            resourceAttributes = resourceAttributes(document),
        )
    }

    private fun requiredString(document: JSONObject, key: String): String =
        optionalString(document, key)
            ?: throw BootstrapException("$CONFIG_FILE_NAME is missing the required key $key.")

    private fun optionalString(document: JSONObject, key: String): String? {
        if (!document.has(key)) {
            return null
        }
        return document.get(key) as? String
            ?: throw BootstrapException("$CONFIG_FILE_NAME key $key must be a string.")
    }

    private fun optionalNumber(document: JSONObject, key: String): Double? {
        if (!document.has(key)) {
            return null
        }
        val value = document.get(key) as? Number
            ?: throw BootstrapException("$CONFIG_FILE_NAME key $key must be a number.")
        return value.toDouble()
    }

    private fun protocol(document: JSONObject): Transport =
        when (val value = optionalString(document, "exportProtocol")) {
            null, "http" -> Transport.HTTP
            "grpc" -> Transport.GRPC
            else -> throw BootstrapException(
                "$CONFIG_FILE_NAME key exportProtocol must be \"http\" or \"grpc\", not \"$value\".",
            )
        }

    private fun resourceAttributes(document: JSONObject): Map<String, String> {
        if (!document.has("resourceAttributes")) {
            return emptyMap()
        }
        val attributes = document.get("resourceAttributes") as? JSONObject
            ?: throw BootstrapException("$CONFIG_FILE_NAME key resourceAttributes must be an object.")
        return attributes.keys().asSequence().associateWith { key ->
            attributes.get(key) as? String
                ?: throw BootstrapException(
                    "$CONFIG_FILE_NAME key resourceAttributes.$key must be a string.",
                )
        }
    }
}
