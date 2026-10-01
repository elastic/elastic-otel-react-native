import OpenTelemetryApi

let interactionInstrumentationScope =
  "@elastic/otel-react-native.interactions"
let widgetClickEventName = "app.widget.click"

final class InteractionTelemetry {
  private let loggerProvider: () throws -> any LoggerProvider

  init(loggerProvider: @escaping () throws -> any LoggerProvider) {
    self.loggerProvider = loggerProvider
  }

  func recordWidgetClick(
    widgetId: String,
    widgetName: String?,
    timestamp: Double
  ) throws {
    var attributes = [
      "otel.event.name": AttributeValue.string(widgetClickEventName),
      "app.widget.id": AttributeValue.string(
        try BridgeInput.widgetId(widgetId)
      )
    ]
    if let widgetName = try BridgeInput.widgetName(widgetName) {
      attributes["app.widget.name"] = .string(widgetName)
    }

    try loggerProvider()
      .loggerBuilder(
        instrumentationScopeName: interactionInstrumentationScope
      )
      .build()
      .logRecordBuilder()
      .setEventName(widgetClickEventName)
      .setTimestamp(try BridgeInput.eventTimestamp(timestamp))
      .setSpanContext(Self.invalidSpanContext)
      .setAttributes(attributes)
      .emit()
  }

  private static let invalidSpanContext = SpanContext.create(
    traceId: .invalid,
    spanId: .invalid,
    traceFlags: TraceFlags(),
    traceState: TraceState()
  )
}
