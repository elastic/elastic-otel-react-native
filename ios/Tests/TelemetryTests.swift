import Foundation
import OpenTelemetryApi
import OpenTelemetrySdk
import XCTest

@testable import ElasticOtelReactNativeCore

final class TelemetryTests: XCTestCase {
  private var spanExporter: TestSpanExporter!
  private var logExporter: TestLogExporter!
  private var tracerProvider: TracerProviderSdk!
  private var telemetry: ManualTelemetry!
  private var interactions: InteractionTelemetry!

  override func setUp() {
    super.setUp()
    spanExporter = TestSpanExporter()
    logExporter = TestLogExporter()

    tracerProvider = TracerProviderBuilder()
      .add(
        spanProcessor: SimpleSpanProcessor(spanExporter: spanExporter)
      )
      .build()
    let loggerProvider = LoggerProviderBuilder()
      .with(processors: [
        SimpleLogRecordProcessor(logRecordExporter: logExporter)
      ])
      .build()
    OpenTelemetry.registerTracerProvider(tracerProvider: tracerProvider)
    OpenTelemetry.registerLoggerProvider(loggerProvider: loggerProvider)

    telemetry = ManualTelemetry(openTelemetry: { OpenTelemetry.instance })
    interactions = InteractionTelemetry(
      openTelemetry: { OpenTelemetry.instance }
    )
  }

  func testRootAndExplicitParentSpansUseNativeRelationships() throws {
    let parentHandle = try telemetry.startSpan(
      name: "parent",
      parentSpanHandle: nil
    )
    let childHandle = try telemetry.startSpan(
      name: "child",
      parentSpanHandle: parentHandle
    )

    try telemetry.endSpan(handle: childHandle)
    try telemetry.endSpan(handle: parentHandle)
    tracerProvider.forceFlush()

    let spans = spanExporter.finished
    let parent = try XCTUnwrap(spans.first { $0.name == "parent" })
    let child = try XCTUnwrap(spans.first { $0.name == "child" })
    XCTAssertNil(parent.parentSpanId)
    XCTAssertEqual(child.traceId, parent.traceId)
    XCTAssertEqual(child.parentSpanId, parent.spanId)
    XCTAssertEqual(
      parent.instrumentationScope.name,
      "@elastic/otel-react-native"
    )
  }

  func testLogsAreIndependentOrCorrelatedByExplicitHandle() throws {
    let handle = try telemetry.startSpan(
      name: "operation",
      parentSpanHandle: nil
    )
    try telemetry.emitLog(
      body: "independent",
      severity: "info",
      spanHandle: nil
    )
    try telemetry.emitLog(
      body: "correlated",
      severity: "warn",
      spanHandle: handle
    )
    try telemetry.endSpan(handle: handle)
    tracerProvider.forceFlush()

    let logs = logExporter.finished
    XCTAssertEqual(logs.count, 2)
    XCTAssertEqual(logs[0].body, .string("independent"))
    XCTAssertEqual(logs[0].severity, .info)
    XCTAssertFalse(logs[0].spanContext?.isValid ?? false)
    XCTAssertEqual(logs[1].body, .string("correlated"))
    XCTAssertEqual(logs[1].severity, .warn)
    XCTAssertTrue(logs[1].spanContext?.isValid ?? false)
    XCTAssertEqual(
      logs[1].spanContext?.traceId,
      spanExporter.finished.first?.traceId
    )
    XCTAssertEqual(
      logs[1].instrumentationScopeInfo.name,
      "@elastic/otel-react-native"
    )
  }

  func testInvalidHandlesProduceNoTelemetry() throws {
    XCTAssertThrowsError(
      try telemetry.startSpan(
        name: "child",
        parentSpanHandle: "span-404"
      )
    )
    XCTAssertThrowsError(
      try telemetry.emitLog(
        body: "body",
        severity: "info",
        spanHandle: "span-404"
      )
    )
    XCTAssertTrue(spanExporter.finished.isEmpty)
    XCTAssertTrue(logExporter.finished.isEmpty)
  }

  func testAnUnavailableOpenTelemetryRejectsEveryCallWithItsError() {
    let notReady: () throws -> OpenTelemetry = { throw NotReady() }
    let telemetry = ManualTelemetry(openTelemetry: notReady)
    let interactions = InteractionTelemetry(openTelemetry: notReady)

    XCTAssertThrowsError(
      try telemetry.startSpan(name: "span", parentSpanHandle: nil)
    ) { XCTAssertTrue($0 is NotReady) }
    XCTAssertThrowsError(
      try telemetry.emitLog(body: "body", severity: "info", spanHandle: nil)
    ) { XCTAssertTrue($0 is NotReady) }
    XCTAssertThrowsError(
      try interactions.recordWidgetClick(
        widgetId: "checkout.submit",
        widgetName: nil,
        timestamp: 1_234
      )
    ) { XCTAssertTrue($0 is NotReady) }
    XCTAssertTrue(spanExporter.finished.isEmpty)
    XCTAssertTrue(logExporter.finished.isEmpty)
  }

  func testWidgetClickEmitsAnEventRecordAtTheSuppliedTimestamp() throws {
    try interactions.recordWidgetClick(
      widgetId: "checkout.submit",
      widgetName: "Submit order",
      timestamp: 1_234
    )

    let record = try XCTUnwrap(
      logExporter.finished.first
    )
    XCTAssertEqual(
      record.instrumentationScopeInfo.name,
      interactionInstrumentationScope
    )
    XCTAssertEqual(record.eventName, widgetClickEventName)
    XCTAssertEqual(
      Set(record.attributes.keys),
      ["otel.event.name", "app.widget.id", "app.widget.name"]
    )
    XCTAssertEqual(
      record.attributes["otel.event.name"],
      .string(widgetClickEventName)
    )
    XCTAssertEqual(
      record.attributes["app.widget.id"],
      .string("checkout.submit")
    )
    XCTAssertEqual(
      record.attributes["app.widget.name"],
      .string("Submit order")
    )
    XCTAssertEqual(
      record.timestamp,
      Date(timeIntervalSince1970: 1.234)
    )
    XCTAssertNil(record.body)
    XCTAssertFalse(record.spanContext?.isValid ?? false)
  }
}

private struct NotReady: Error {}

private final class TestSpanExporter: SpanExporter, @unchecked Sendable {
  private let lock = NSLock()
  private var spans: [SpanData] = []

  var finished: [SpanData] {
    lock.lock()
    defer { lock.unlock() }
    return spans
  }

  func export(
    spans: [SpanData],
    explicitTimeout _: TimeInterval?
  ) -> SpanExporterResultCode {
    lock.lock()
    self.spans.append(contentsOf: spans)
    lock.unlock()
    return .success
  }

  func flush(explicitTimeout _: TimeInterval?) -> SpanExporterResultCode {
    .success
  }

  func shutdown(explicitTimeout _: TimeInterval?) {}
}

private final class TestLogExporter: LogRecordExporter {
  private let lock = NSLock()
  private var records: [ReadableLogRecord] = []

  var finished: [ReadableLogRecord] {
    lock.lock()
    defer { lock.unlock() }
    return records
  }

  func export(
    logRecords: [ReadableLogRecord],
    explicitTimeout _: TimeInterval?
  ) -> ExportResult {
    lock.lock()
    records.append(contentsOf: logRecords)
    lock.unlock()
    return .success
  }

  func shutdown(explicitTimeout _: TimeInterval?) {}

  func forceFlush(explicitTimeout _: TimeInterval?) -> ExportResult {
    .success
  }
}
