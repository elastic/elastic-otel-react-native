import Darwin
import XCTest

@testable import ElasticOtelReactNativeCore

private let identity = ["service.name": "service"]

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

  func testAcceptsResourceAttributesThatEdotIosReadsBackUnchanged() throws {
    let attributes = [
      "service.name": "my service",
      "service.namespace": "a/b:c;d",
      "custom.url": "https://example.com/path?x",
    ]

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
    let unsupportedCharacters = { (key: String) in
      "On iOS, the resource attribute \(key) is not supported: keys and values must not contain ',' or '=', keys must not start or end with whitespace, and values must not start or end with '^', '\"', '|', or '$'."
    }
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
          exportUrl: "https://example.com/v1/traces",
          resourceAttributes: identity
        ),
        "The OTLP base URL must not include a signal-specific path."
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
    let unsupported: [(String, String)] = [
      ("service.name", "service,other"),
      ("service.name", "service=other"),
      ("custom,key", "value"),
      ("custom=key", "value"),
      (" custom.key", "value"),
      ("custom.key ", "value"),
      ("custom.key", "^value"),
      ("custom.key", "value\""),
      ("custom.key", "|value"),
      ("custom.key", "value$"),
    ]
    for (key, value) in unsupported {
      invalid.append(
        (
          BootstrapConfiguration(
            exportUrl: url,
            resourceAttributes: identity.merging([key: value]) { $1 }
          ),
          unsupportedCharacters(key)
        )
      )
    }

    for (configuration, message) in invalid {
      XCTAssertThrowsError(try BootstrapValidator.validate(configuration)) {
        XCTAssertEqual(($0 as? BootstrapException)?.message, message)
      }
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

  func testResourceAttributesOverrideAndRestoreEnvironment() throws {
    let key = ResourceEnvironment.key
    let original = getenv(key).map { String(cString: $0) }
    setenv(key, "custom=value,service.name=old, service.version =0.1", 1)
    defer {
      if let original {
        setenv(key, original, 1)
      } else {
        unsetenv(key)
      }
    }
    let expected =
      "custom=value,deployment.environment.name=local,service.name=mobile-service,service.version=1.2.3"

    try ResourceEnvironment.withResourceAttributes([
      "service.name": "mobile-service",
      "service.version": "1.2.3",
      "deployment.environment.name": "local",
    ]) {
      XCTAssertEqual(getenv(key).map { String(cString: $0) }, expected)
      XCTAssertEqual(ProcessInfo.processInfo.environment[key], expected)
    }
    XCTAssertEqual(
      getenv(key).map { String(cString: $0) },
      "custom=value,service.name=old, service.version =0.1"
    )
  }
}
