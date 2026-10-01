import Darwin
import XCTest

@testable import ElasticOtelReactNativeCore

final class BootstrapTests: XCTestCase {
  func testValidatesAndNormalizesConfiguration() throws {
    let validated = try BootstrapValidator.validate(
      BootstrapConfiguration(
        exportUrl: " https://example.com/tenant/otel/ ",
        authentication: .apiKey("key"),
        transport: .grpc,
        sessionSampleRate: 0.25,
        serviceName: " service ",
        instrumentationScopeName: " scope "
      )
    )

    XCTAssertEqual(
      validated.exportUrl,
      URL(string: "https://example.com/tenant/otel/")
    )
    XCTAssertEqual(validated.authentication, .apiKey("key"))
    XCTAssertEqual(validated.transport, .grpc)
    XCTAssertEqual(validated.sessionSampleRate, 0.25)
    XCTAssertEqual(validated.serviceName, "service")
    XCTAssertEqual(validated.instrumentationScopeName, "scope")
  }

  func testRejectsInvalidBootstrapInputs() {
    let valid = BootstrapConfiguration(
      exportUrl: "https://example.com",
      serviceName: "service"
    )
    let invalid: [(BootstrapConfiguration, String)] = [
      (
        BootstrapConfiguration(exportUrl: " ", serviceName: "service"),
        "An OTLP export URL is required."
      ),
      (
        BootstrapConfiguration(
          exportUrl: "ftp://example.com",
          serviceName: "service"
        ),
        "The OTLP export URL must use http or https and include a host."
      ),
      (
        BootstrapConfiguration(
          exportUrl: "https:///path",
          serviceName: "service"
        ),
        "The OTLP export URL must use http or https and include a host."
      ),
      (
        BootstrapConfiguration(
          exportUrl: "https://example.com/v1/traces",
          serviceName: "service"
        ),
        "The OTLP base URL must not include a signal-specific path."
      ),
      (
        BootstrapConfiguration(
          exportUrl: "https://example.com?tenant=one",
          serviceName: "service"
        ),
        "The OTLP base URL must not include a query or fragment."
      ),
      (
        BootstrapConfiguration(
          exportUrl: valid.exportUrl,
          serviceName: " "
        ),
        "A service name is required."
      ),
      (
        BootstrapConfiguration(
          exportUrl: valid.exportUrl,
          serviceName: "service,other"
        ),
        "On iOS, the service name must not contain ',' or '='."
      ),
      (
        BootstrapConfiguration(
          exportUrl: valid.exportUrl,
          serviceName: valid.serviceName,
          instrumentationScopeName: " "
        ),
        "The instrumentation scope name must not be blank."
      ),
      (
        BootstrapConfiguration(
          exportUrl: valid.exportUrl,
          authentication: .apiKey(" "),
          serviceName: valid.serviceName
        ),
        "The API key must not be blank."
      ),
      (
        BootstrapConfiguration(
          exportUrl: valid.exportUrl,
          sessionSampleRate: .infinity,
          serviceName: valid.serviceName
        ),
        "The session sample rate must be between 0 and 1."
      ),
      (
        BootstrapConfiguration(
          exportUrl: valid.exportUrl,
          sessionSampleRate: -0.1,
          serviceName: valid.serviceName
        ),
        "The session sample rate must be between 0 and 1."
      ),
    ]

    for (configuration, message) in invalid {
      XCTAssertThrowsError(try BootstrapValidator.validate(configuration)) {
        XCTAssertEqual(($0 as? BootstrapException)?.message, message)
      }
    }
  }

  func testLifecycleRetainsOnlySuccessfulFirstInitialization() throws {
    let lifecycle = AgentLifecycle<String>()
    let configuration = try BootstrapValidator.validate(
      BootstrapConfiguration(
        exportUrl: "https://example.com",
        serviceName: "service"
      )
    )

    XCTAssertThrowsError(
      try lifecycle.initialize(configuration: configuration) { _ in
        throw BootstrapException("factory failed")
      }
    )
    XCTAssertFalse(lifecycle.isInitialized())

    XCTAssertEqual(
      try lifecycle.initialize(configuration: configuration) { _ in "agent" },
      "agent"
    )
    XCTAssertTrue(lifecycle.isInitialized())
    XCTAssertEqual(try lifecycle.requireAgent(), "agent")
    XCTAssertThrowsError(
      try lifecycle.initialize(configuration: configuration) { _ in "other" }
    ) {
      XCTAssertEqual(
        ($0 as? BootstrapException)?.message,
        "EDOT iOS has already been initialized."
      )
    }
  }

  func testServiceNameResourceOverridesAndRestoresEnvironment() throws {
    let key = ResourceEnvironment.key
    let original = getenv(key).map { String(cString: $0) }
    setenv(key, "custom=value,service.name=old", 1)
    defer {
      if let original {
        setenv(key, original, 1)
      } else {
        unsetenv(key)
      }
    }

    try ResourceEnvironment.withServiceName("mobile-service") {
      XCTAssertEqual(
        getenv(key).map { String(cString: $0) },
        "custom=value,service.name=mobile-service"
      )
      XCTAssertEqual(
        ProcessInfo.processInfo.environment[key],
        "custom=value,service.name=mobile-service"
      )
    }
    XCTAssertEqual(
      getenv(key).map { String(cString: $0) },
      "custom=value,service.name=old"
    )
  }
}
