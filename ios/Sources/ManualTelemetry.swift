import OpenTelemetryApi

final class ManualTelemetry {
  private let instrumentationScopeName: () -> String
  private let tracerProvider: () throws -> any TracerProvider
  private let loggerProvider: () throws -> any LoggerProvider
  private let spans = SpanHandleStore<any Span> { $0.end() }

  init(
    instrumentationScopeName: @escaping () -> String,
    tracerProvider: @escaping () throws -> any TracerProvider,
    loggerProvider: @escaping () throws -> any LoggerProvider
  ) {
    self.instrumentationScopeName = instrumentationScopeName
    self.tracerProvider = tracerProvider
    self.loggerProvider = loggerProvider
  }

  func startSpan(
    name: String,
    parentSpanHandle: String?
  ) throws -> String {
    let tracer = try tracerProvider().get(
      instrumentationName: instrumentationScopeName()
    )
    let builder = tracer.spanBuilder(
      spanName: try BridgeInput.spanName(name)
    )
    if let parentSpanHandle {
      return try spans.withActive(parentSpanHandle) { parent in
        spans.retain(builder.setParent(parent).startSpan())
      }
    }
    return spans.retain(builder.setNoParent().startSpan())
  }

  func endSpan(handle: String) throws {
    try spans.end(handle)
  }

  func emitLog(
    body: String,
    severity: String,
    spanHandle: String?
  ) throws {
    let builder = try loggerProvider()
      .get(instrumentationScopeName: instrumentationScopeName())
      .logRecordBuilder()
      .setBody(.string(try BridgeInput.logBody(body)))
      .setSeverity(try BridgeInput.severity(severity))

    if let spanHandle {
      try spans.withActive(spanHandle) { span in
        builder.setSpanContext(span.context).emit()
      }
    } else {
      builder.setSpanContext(Self.invalidSpanContext).emit()
    }
  }

  private static let invalidSpanContext = SpanContext.create(
    traceId: .invalid,
    spanId: .invalid,
    traceFlags: TraceFlags(),
    traceState: TraceState()
  )
}
