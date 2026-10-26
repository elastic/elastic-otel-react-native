// Copyright Elastic Technologies Inc. and/or licensed to
// Elastic Technologies Inc. under one or more contributor license
// agreements. See the NOTICE file distributed with this work for
// additional information regarding copyright ownership.
// Elastic Technologies Inc. licenses this file to you under the Apache
// License, Version 2.0 (the "License"); you may not use this file except
// in compliance with the License. You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import OpenTelemetryApi
import OpenTelemetrySdk
import XCTest

@testable import ElasticOtelReactNativeCore

private let identity = ["service.name": "service"]

// The Android BootstrapTest uses the same lists.
private let signalPaths = [
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
]
private let basePaths = ["", "/gateway", "/v1/tracesx"]
private let acceptedResourceAttributes = [
  "custom,key": "value",
  "custom=key": "value",
  " custom.key": "value",
  "custom.key ": "value",
  "custom.caret": "^value",
  "custom.quote": "value\"",
  "custom.pipe": "|value",
  "custom.dollar": "value$",
  "custom.list": "a,b",
  "custom.pair": "k=v",
  String(repeating: "k", count: 255): "value",
]
private let rejectedResourceAttributeKeys = [
  String(repeating: "k", count: 256),
  "custom.ключ",
  "custom\tkey",
  "custom\nkey",
]

final class BootstrapTests: XCTestCase {
  func testValidatesAndNormalizesConfiguration() throws {
    let validated = try BootstrapValidator.validate(
      BootstrapConfiguration(
        exportUrl: " https://example.com/tenant/otel/ ",
        authentication: .apiKey("key"),
        transport: .grpc,
        sessionSampleRate: 0.25,
        resourceAttributes: [
          "service.name": "service",
          "deployment.environment.name": "production",
        ]
      )
    )

    XCTAssertEqual(
      validated.exportUrl,
      URL(string: "https://example.com/tenant/otel/")
    )
    XCTAssertEqual(validated.authentication, .apiKey("key"))
    XCTAssertEqual(validated.transport, .grpc)
    XCTAssertEqual(validated.sessionSampleRate, 0.25)
    XCTAssertEqual(
      validated.resourceAttributes,
      ["service.name": "service", "deployment.environment.name": "production"]
    )
  }

  func testAcceptsResourceAttributesUnchanged() throws {
    let attributes = identity.merging(acceptedResourceAttributes) { $1 }

    XCTAssertEqual(
      try BootstrapValidator.validate(
        BootstrapConfiguration(
          exportUrl: "https://example.com",
          resourceAttributes: attributes
        )
      ).resourceAttributes,
      attributes
    )
  }

  func testRejectsInvalidBootstrapInputs() {
    let url = "https://example.com"
    var invalid: [(BootstrapConfiguration, String)] = [
      (
        BootstrapConfiguration(exportUrl: " ", resourceAttributes: identity),
        "An OTLP export URL is required."
      ),
      (
        BootstrapConfiguration(
          exportUrl: "https://[invalid",
          resourceAttributes: identity
        ),
        "The OTLP export URL is invalid."
      ),
      (
        BootstrapConfiguration(
          exportUrl: "ftp://example.com",
          resourceAttributes: identity
        ),
        "The OTLP export URL must use http or https."
      ),
      (
        BootstrapConfiguration(
          exportUrl: "https:///path",
          resourceAttributes: identity
        ),
        "The OTLP export URL must include a host."
      ),
      (
        BootstrapConfiguration(
          exportUrl: "https://example.com?tenant=one",
          resourceAttributes: identity
        ),
        "The OTLP base URL must not include a query or fragment."
      ),
      (
        BootstrapConfiguration(exportUrl: url, resourceAttributes: [:]),
        "The resource attribute service.name is required."
      ),
      (
        BootstrapConfiguration(
          exportUrl: url,
          resourceAttributes: ["service.namespace": "shop"]
        ),
        "The resource attribute service.name is required."
      ),
      (
        BootstrapConfiguration(
          exportUrl: url,
          resourceAttributes: ["service.name": "service", " ": "value"]
        ),
        "Resource attribute keys must not be blank."
      ),
      (
        BootstrapConfiguration(
          exportUrl: url,
          resourceAttributes: ["service.name": " "]
        ),
        "The resource attribute service.name must not be blank."
      ),
      (
        BootstrapConfiguration(
          exportUrl: url,
          authentication: .apiKey(" "),
          resourceAttributes: identity
        ),
        "The API key must not be blank."
      ),
      (
        BootstrapConfiguration(
          exportUrl: url,
          authentication: .secretToken(""),
          resourceAttributes: identity
        ),
        "The secret token must not be blank."
      ),
      (
        BootstrapConfiguration(
          exportUrl: url,
          sessionSampleRate: .infinity,
          resourceAttributes: identity
        ),
        "The session sample rate must be between 0 and 1."
      ),
      (
        BootstrapConfiguration(
          exportUrl: url,
          sessionSampleRate: -0.1,
          resourceAttributes: identity
        ),
        "The session sample rate must be between 0 and 1."
      ),
    ]
    for key in rejectedResourceAttributeKeys {
      invalid.append(
        (
          BootstrapConfiguration(
            exportUrl: url,
            resourceAttributes: identity.merging([key: "value"]) { $1 }
          ),
          "The resource attribute key \(key) must be at most 255 printable ASCII characters."
        )
      )
    }

    for (configuration, message) in invalid {
      XCTAssertThrowsError(try BootstrapValidator.validate(configuration)) {
        XCTAssertEqual(($0 as? BootstrapException)?.message, message)
      }
    }
  }

  func testSignalSpecificPathsAreRejectedAndBasePathsAccepted() throws {
    for path in signalPaths {
      XCTAssertThrowsError(
        try BootstrapValidator.validate(
          BootstrapConfiguration(
            exportUrl: "https://example.test\(path)",
            resourceAttributes: identity
          )
        ),
        path
      ) {
        XCTAssertEqual(
          ($0 as? BootstrapException)?.message,
          "The OTLP base URL must not include a signal-specific path.",
          path
        )
      }
    }
    for path in basePaths {
      XCTAssertNoThrow(
        try BootstrapValidator.validate(
          BootstrapConfiguration(
            exportUrl: "https://example.test\(path)",
            resourceAttributes: identity
          )
        ),
        path
      )
    }
  }

  func testLifecycleRetainsOnlySuccessfulFirstInitialization() throws {
    let lifecycle = AgentLifecycle<String>()
    let configuration = BootstrapConfiguration(
      exportUrl: "https://example.com",
      resourceAttributes: identity
    )

    XCTAssertThrowsError(
      try lifecycle.initialize(configuration: { configuration }) { _ in
        throw BootstrapException("factory failed")
      }
    )
    XCTAssertFalse(lifecycle.isInitialized())

    XCTAssertEqual(
      try lifecycle.initialize(configuration: { configuration }) { _ in
        "agent"
      },
      "agent"
    )
    XCTAssertTrue(lifecycle.isInitialized())
    XCTAssertEqual(try lifecycle.requireAgent(), "agent")
  }

  func testDuplicateInitializationIsReportedBeforeTheConfigurationIsRead()
    throws
  {
    let lifecycle = AgentLifecycle<String>()
    _ = try lifecycle.initialize(
      configuration: {
        BootstrapConfiguration(
          exportUrl: "https://example.com",
          resourceAttributes: identity
        )
      }
    ) { _ in "agent" }
    var configurationRead = false

    XCTAssertThrowsError(
      try lifecycle.initialize(
        configuration: {
          configurationRead = true
          return BootstrapConfiguration(exportUrl: "", resourceAttributes: [:])
        }
      ) { _ in "second-agent" }
    ) {
      XCTAssertEqual(
        ($0 as? BootstrapException)?.message,
        "EDOT iOS has already been initialized."
      )
    }
    XCTAssertFalse(configurationRead)
    XCTAssertEqual(try lifecycle.requireAgent(), "agent")
  }

  func testInvalidConfigurationDoesNotInitialize() {
    let lifecycle = AgentLifecycle<String>()
    var factoryCalled = false

    XCTAssertThrowsError(
      try lifecycle.initialize(
        configuration: {
          BootstrapConfiguration(
            exportUrl: "https://example.com",
            resourceAttributes: [:]
          )
        }
      ) { _ in
        factoryCalled = true
        return "agent"
      }
    ) {
      XCTAssertEqual(
        ($0 as? BootstrapException)?.message,
        "The resource attribute service.name is required."
      )
    }
    XCTAssertFalse(factoryCalled)
    XCTAssertFalse(lifecycle.isInitialized())
  }

  func testResourceAttributesAreAddedWithoutRemovingExistingAttributes() {
    let detected = Resource(attributes: [
      "service.name": .string("detected"),
      "os.name": .string("iOS"),
    ])

    let intercepted = resourceAttributesInterceptor([
      "service.name": "service",
      "custom.list": "a,b",
      "custom.pair": "k=v",
      "custom.quoted": "\"quoted\"",
      "custom.edges": "^|value|$",
      "custom,key": "value",
    ]).intercept(detected)

    XCTAssertEqual(
      intercepted.attributes,
      [
        "service.name": .string("service"),
        "os.name": .string("iOS"),
        "custom.list": .string("a,b"),
        "custom.pair": .string("k=v"),
        "custom.quoted": .string("\"quoted\""),
        "custom.edges": .string("^|value|$"),
        "custom,key": .string("value"),
      ]
    )
  }
}
