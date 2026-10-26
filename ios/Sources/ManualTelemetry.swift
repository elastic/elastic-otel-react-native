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

let defaultInstrumentationScopeName = "@elastic/otel-react-native"

// The span context of a log record emitted outside any span. Manual and
// interaction telemetry both use it.
let invalidSpanContext = SpanContext.create(
  traceId: .invalid,
  spanId: .invalid,
  traceFlags: TraceFlags(),
  traceState: TraceState()
)

final class ManualTelemetry {
  private let openTelemetry: () throws -> OpenTelemetry
  private let spans = SpanHandleStore<any Span> { $0.end() }

  init(openTelemetry: @escaping () throws -> OpenTelemetry) {
    self.openTelemetry = openTelemetry
  }

  func startSpan(
    name: String,
    parentSpanHandle: String?
  ) throws -> String {
    let tracer = try openTelemetry().tracerProvider.get(
      instrumentationName: defaultInstrumentationScopeName
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
    let builder = try openTelemetry().loggerProvider
      .get(instrumentationScopeName: defaultInstrumentationScopeName)
      .logRecordBuilder()
      .setBody(.string(try BridgeInput.logBody(body)))
      .setSeverity(try BridgeInput.severity(severity))

    if let spanHandle {
      try spans.withActive(spanHandle) { span in
        builder.setSpanContext(span.context).emit()
      }
    } else {
      builder.setSpanContext(invalidSpanContext).emit()
    }
  }
}
