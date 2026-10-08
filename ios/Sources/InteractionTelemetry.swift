import OpenTelemetryApi

let interactionInstrumentationScope =
  "@elastic/otel-react-native.interactions"
let widgetClickEventName = "app.widget.click"

final class InteractionTelemetry {
  private let openTelemetry: () throws -> OpenTelemetry

  init(openTelemetry: @escaping () throws -> OpenTelemetry) {
    self.openTelemetry = openTelemetry
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

    try openTelemetry().loggerProvider
      .loggerBuilder(
        instrumentationScopeName: interactionInstrumentationScope
      )
      .build()
      .logRecordBuilder()
      .setEventName(widgetClickEventName)
      .setTimestamp(try BridgeInput.eventTimestamp(timestamp))
      .setSpanContext(invalidSpanContext)
      .setAttributes(attributes)
      .emit()
  }
}
