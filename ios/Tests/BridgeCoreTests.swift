import OpenTelemetryApi
import XCTest

@testable import ElasticOtelReactNativeCore

final class BridgeCoreTests: XCTestCase {
  func testBridgeInputValidation() throws {
    XCTAssertEqual(try BridgeInput.spanName("span"), "span")
    XCTAssertEqual(try BridgeInput.logBody("body"), "body")
    XCTAssertEqual(try BridgeInput.severity("WARN"), .warn)
    XCTAssertEqual(try BridgeInput.widgetId("button"), "button")
    XCTAssertNil(try BridgeInput.widgetName(nil))
    XCTAssertEqual(
      try BridgeInput.eventTimestamp(1_500),
      Date(timeIntervalSince1970: 1.5)
    )

    for operation in [
      { _ = try BridgeInput.spanName(" ") },
      { _ = try BridgeInput.logBody("") },
      { _ = try BridgeInput.severity("notice") },
      { _ = try BridgeInput.widgetId("\n") },
      { _ = try BridgeInput.widgetName(" ") },
      { _ = try BridgeInput.eventTimestamp(.nan) },
    ] {
      XCTAssertThrowsError(try operation())
    }
  }

  func testSpanHandlesAreMonotonicOpaqueAndSingleUse() throws {
    var ended: [Int] = []
    let store = SpanHandleStore<Int> { ended.append($0) }

    XCTAssertEqual(store.retain(10), "span-1")
    let second = store.retain(20)
    XCTAssertEqual(second, "span-2")
    XCTAssertEqual(try store.withActive(second) { $0 + 1 }, 21)
    try store.end(second)
    XCTAssertEqual(ended, [20])
    XCTAssertThrowsError(try store.end(second))
    XCTAssertThrowsError(try store.withActive("span-404") { $0 })
  }
}
