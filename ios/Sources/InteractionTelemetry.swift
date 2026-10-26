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
