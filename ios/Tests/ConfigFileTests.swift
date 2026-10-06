import XCTest

@testable import ElasticOtelReactNativeCore

private let identity = ["service.name": "fixture"]

final class ConfigFileTests: XCTestCase {
  func testCompleteDocumentMapsEveryKey() throws {
    let configuration = try parse(
      """
      {
        "$schema": "./node_modules/@elastic/otel-react-native/elastic-otel-config.schema.json",
        "exportUrl": "https://example.test",
        "apiKey": "api-key",
        "exportProtocol": "grpc",
        "sessionSampleRate": 0.5,
        "resourceAttributes": {
          "service.name": "fixture",
          "service.version": "1.2.3",
          "deployment.environment.name": "production",
          "service.namespace": "shop"
        }
      }
      """
    )

    XCTAssertEqual(
      configuration,
      BootstrapConfiguration(
        exportUrl: "https://example.test",
        authentication: .apiKey("api-key"),
        transport: .grpc,
        sessionSampleRate: 0.5,
        resourceAttributes: [
          "service.name": "fixture",
          "service.version": "1.2.3",
          "deployment.environment.name": "production",
          "service.namespace": "shop",
        ]
      )
    )
  }

  func testMinimalDocumentKeepsDefaults() throws {
    XCTAssertEqual(
      try parse(
        #"{ "exportUrl": "http://localhost:4318", "resourceAttributes": { "service.name": "fixture" }, "sessionSampleRate": 1 }"#
      ),
      BootstrapConfiguration(
        exportUrl: "http://localhost:4318",
        sessionSampleRate: 1,
        resourceAttributes: identity
      )
    )
    XCTAssertEqual(
      try parse(#"{ "exportUrl": "https://example.test" }"#),
      BootstrapConfiguration(
        exportUrl: "https://example.test",
        resourceAttributes: [:]
      )
    )
  }

  func testSchemaReferenceIsIgnored() throws {
    XCTAssertEqual(
      try parse(
        #"{ "$schema": " ", "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture" } }"#
      ),
      BootstrapConfiguration(
        exportUrl: "https://example.test",
        resourceAttributes: identity
      )
    )
  }

  func testDuplicateKeysAreAccepted() throws {
    let configuration = try parse(
      #"{ "exportUrl": "https://a.test", "exportUrl": "https://b.test", "resourceAttributes": { "service.name": "fixture" } }"#
    )

    XCTAssertTrue(
      ["https://a.test", "https://b.test"].contains(configuration.exportUrl)
    )
  }

  func testUnknownTopLevelKeysAreRejected() {
    for key in [
      "apikey", "transport", "ios", "serviceName", "deploymentEnvironmentName",
    ] {
      assertRejected(
        #"{ "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture" }, "\#(key)": "value" }"#,
        "elastic-otel-config.json contains the unknown key \(key)."
      )
    }
  }

  func testMistypedValuesAreRejected() {
    let cases: [(String, String)] = [
      (
        #"{ "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture" }, "sessionSampleRate": "1" }"#,
        "elastic-otel-config.json key sessionSampleRate must be a number."
      ),
      (
        #"{ "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture" }, "sessionSampleRate": true }"#,
        "elastic-otel-config.json key sessionSampleRate must be a number."
      ),
      (
        #"{ "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture" }, "apiKey": 42 }"#,
        "elastic-otel-config.json key apiKey must be a string."
      ),
      (
        #"{ "exportUrl": true, "resourceAttributes": { "service.name": "fixture" } }"#,
        "elastic-otel-config.json key exportUrl must be a string."
      ),
      (
        #"{ "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture", "service.namespace": 1 } }"#,
        "elastic-otel-config.json key resourceAttributes.service.namespace must be a string."
      ),
      (
        #"{ "exportUrl": "https://example.test", "resourceAttributes": ["a"] }"#,
        "elastic-otel-config.json key resourceAttributes must be an object."
      ),
      (
        #"{ "exportUrl": "https://example.test", "resourceAttributes": null }"#,
        "elastic-otel-config.json key resourceAttributes must be an object."
      ),
      (
        #"{ "$schema": 1, "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture" } }"#,
        "elastic-otel-config.json key $schema must be a string."
      ),
      (
        #"{ "resourceAttributes": { "service.name": "fixture" } }"#,
        "elastic-otel-config.json is missing the required key exportUrl."
      ),
      (
        #"{ "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture" }, "exportProtocol": "https" }"#,
        #"elastic-otel-config.json key exportProtocol must be "http" or "grpc", not "https"."#
      ),
    ]

    for (json, message) in cases {
      assertRejected(json, message)
    }
  }

  func testDocumentsOtherThanOneObjectAreRejected() {
    for json in [
      #"["https://example.test"]"#,
      #"{ "exportUrl": "https://example.test", "#,
      #"{ "exportUrl": "https://example.test" } {}"#,
      #"{ "exportUrl": "https://example.test" } x"#,
      #"{ "exportUrl": 'https://example.test' }"#,
      "",
    ] {
      XCTAssertThrowsError(try parse(json), json) {
        let message = ($0 as? BootstrapException)?.message ?? ""
        XCTAssertTrue(
          message.hasPrefix(
            "elastic-otel-config.json must contain one JSON object: "
          ),
          message
        )
      }
    }
  }

  func testMissingResourceNamesTheFileAndSetupIos() {
    var requested: [String] = []

    XCTAssertThrowsError(
      try ConfigFileReader.read { name in
        requested.append(name)
        return nil
      }
    ) {
      XCTAssertEqual(
        ($0 as? BootstrapException)?.message,
        "elastic-otel-config.json was not found in the app bundle. Create it at the React Native project root, run setup-ios, and check that the file is in the app target's Copy Bundle Resources build phase."
      )
    }
    XCTAssertEqual(requested, ["elastic-otel-config.json"])
  }

  func testPresentResourceIsParsed() throws {
    XCTAssertEqual(
      try ConfigFileReader.read { _ in
        Data(
          #"{ "exportUrl": "https://example.test", "resourceAttributes": { "service.name": "fixture" } }"#
            .utf8
        )
      },
      BootstrapConfiguration(
        exportUrl: "https://example.test",
        resourceAttributes: identity
      )
    )
  }

  private func parse(_ json: String) throws -> BootstrapConfiguration {
    try ConfigFileReader.parse(Data(json.utf8))
  }

  private func assertRejected(
    _ json: String,
    _ message: String,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    XCTAssertThrowsError(try parse(json), file: file, line: line) {
      XCTAssertEqual(
        ($0 as? BootstrapException)?.message,
        message,
        file: file,
        line: line
      )
    }
  }
}
