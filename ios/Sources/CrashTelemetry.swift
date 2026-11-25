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

let crashInstrumentationScope = "@elastic/otel-react-native"
let crashEventName = "app.crash"
let javaScriptExceptionSource = "javascript"

final class CrashTelemetry {
  private let openTelemetry: () throws -> OpenTelemetry

  init(openTelemetry: @escaping () throws -> OpenTelemetry) {
    self.openTelemetry = openTelemetry
  }

  /// Emits the crash record of an uncaught JavaScript exception. Returns
  /// whether the record was emitted; never throws, because the caller runs
  /// inside the app's fatal-error path.
  func recordJavaScriptCrash(
    type: String,
    message: String,
    stacktrace: String,
    timestamp: Double
  ) -> Bool {
    do {
      let attributes: [String: AttributeValue] = [
        "otel.event.name": .string(crashEventName),
        "exception.type": .string(try BridgeInput.exceptionType(type)),
        "exception.message": .string(message),
        "exception.stacktrace": .string(stacktrace),
        "elastic.exception.source": .string(javaScriptExceptionSource)
      ]

      try openTelemetry().loggerProvider
        .loggerBuilder(instrumentationScopeName: crashInstrumentationScope)
        .build()
        .logRecordBuilder()
        .setEventName(crashEventName)
        .setSeverity(.fatal)
        .setTimestamp(try BridgeInput.eventTimestamp(timestamp))
        .setSpanContext(invalidSpanContext)
        .setAttributes(attributes)
        .emit()
      return true
    } catch {
      return false
    }
  }
}
