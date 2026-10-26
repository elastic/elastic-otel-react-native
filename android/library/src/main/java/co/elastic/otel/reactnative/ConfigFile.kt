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

import android.util.JsonReader
import android.util.JsonToken
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.io.StringReader

internal const val CONFIG_FILE_NAME = "elastic-otel-config.json"

// Reads elastic-otel-config.json into a BootstrapConfiguration. The file must be
// one strict JSON object: comments, single quotes, unquoted names, and trailing
// content are rejected. A repeated key uses one of its values. Beyond syntax, this
// reader checks only the document shape: known keys and JSON types.
// BootstrapValidator owns every value rule.
internal object ConfigFileReader {
    private const val SCHEMA_KEY = "\$schema"
    private val KNOWN_KEYS = setOf(
        SCHEMA_KEY,
        "exportUrl",
        "apiKey",
        "exportProtocol",
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
        val document = readDocument(json)
        for (key in document.keys) {
            if (key !in KNOWN_KEYS) {
                throw BootstrapException("$CONFIG_FILE_NAME contains the unknown key $key.")
            }
        }
        // Editors read $schema; the bridge only checks its type.
        optionalString(document, SCHEMA_KEY)

        return BootstrapConfiguration(
            exportUrl = requiredString(document, "exportUrl"),
            authentication = optionalString(document, "apiKey")
                ?.let(AuthenticationConfiguration::apiKey)
                ?: AuthenticationConfiguration.none(),
            protocol = protocol(document),
            sessionSampleRate = optionalNumber(document, "sessionSampleRate"),
            resourceAttributes = resourceAttributes(document),
        )
    }

    private fun readDocument(json: String): Map<String, Any?> =
        try {
            JsonReader(StringReader(json)).use { reader ->
                val first = reader.peek()
                if (first != JsonToken.BEGIN_OBJECT) {
                    throw notOneObject("found $first")
                }
                val document = readObject(reader)
                // Strict mode fails this peek when content follows the object.
                val next = reader.peek()
                if (next != JsonToken.END_DOCUMENT) {
                    throw notOneObject("found $next after the object")
                }
                document
            }
        } catch (exception: IOException) {
            throw notOneObject(exception.message)
        } catch (exception: IllegalStateException) {
            throw notOneObject(exception.message)
        }

    private fun notOneObject(detail: String?) =
        BootstrapException("$CONFIG_FILE_NAME must contain one JSON object: $detail")

    private fun readValue(reader: JsonReader): Any? =
        when (val token = reader.peek()) {
            JsonToken.BEGIN_OBJECT -> readObject(reader)
            JsonToken.BEGIN_ARRAY -> readArray(reader)
            JsonToken.STRING -> reader.nextString()
            JsonToken.NUMBER -> reader.nextDouble()
            JsonToken.BOOLEAN -> reader.nextBoolean()
            JsonToken.NULL -> reader.nextNull().let { null }
            else -> throw IllegalStateException("Expected a value but was $token")
        }

    private fun readObject(reader: JsonReader): Map<String, Any?> {
        val members = LinkedHashMap<String, Any?>()
        reader.beginObject()
        while (reader.hasNext()) {
            members[reader.nextName()] = readValue(reader)
        }
        reader.endObject()
        return members
    }

    private fun readArray(reader: JsonReader): List<Any?> {
        val elements = mutableListOf<Any?>()
        reader.beginArray()
        while (reader.hasNext()) {
            elements += readValue(reader)
        }
        reader.endArray()
        return elements
    }

    private fun requiredString(document: Map<String, Any?>, key: String): String =
        optionalString(document, key)
            ?: throw BootstrapException("$CONFIG_FILE_NAME is missing the required key $key.")

    private fun optionalString(document: Map<String, Any?>, key: String): String? {
        if (key !in document) {
            return null
        }
        return document[key] as? String
            ?: throw BootstrapException("$CONFIG_FILE_NAME key $key must be a string.")
    }

    private fun optionalNumber(document: Map<String, Any?>, key: String): Double? {
        if (key !in document) {
            return null
        }
        val value = document[key] as? Number
            ?: throw BootstrapException("$CONFIG_FILE_NAME key $key must be a number.")
        return value.toDouble()
    }

    private fun protocol(document: Map<String, Any?>): Transport =
        when (val value = optionalString(document, "exportProtocol")) {
            null, "http" -> Transport.HTTP
            "grpc" -> Transport.GRPC
            else -> throw BootstrapException(
                "$CONFIG_FILE_NAME key exportProtocol must be \"http\" or \"grpc\", not \"$value\".",
            )
        }

    private fun resourceAttributes(document: Map<String, Any?>): Map<String, String> {
        if ("resourceAttributes" !in document) {
            return emptyMap()
        }
        val attributes = document["resourceAttributes"] as? Map<*, *>
            ?: throw BootstrapException("$CONFIG_FILE_NAME key resourceAttributes must be an object.")
        return attributes.entries.associate { (key, value) ->
            val attribute = value as? String
                ?: throw BootstrapException(
                    "$CONFIG_FILE_NAME key resourceAttributes.$key must be a string.",
                )
            key as String to attribute
        }
    }
}
