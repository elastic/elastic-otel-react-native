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

import Foundation
import OpenTelemetryApi
import React

@objc(ElasticOtelReactNativeModule)
public final class ElasticOtelReactNativeModule: NSObject {
  private static let errorCode = "E_ELASTIC_OTEL_REACT_NATIVE"

  private let telemetry = ManualTelemetry(
    openTelemetry: ElasticOtelReactNativeModule.readyOpenTelemetry
  )
  private let interactions = InteractionTelemetry(
    openTelemetry: ElasticOtelReactNativeModule.readyOpenTelemetry
  )

  private static func readyOpenTelemetry() throws -> OpenTelemetry {
    try ElasticOtelReactNative.requireReady()
    return OpenTelemetry.instance
  }

  @objc
  public static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(getStatus:rejecter:)
  public func getStatus(
    _ resolve: RCTPromiseResolveBlock,
    rejecter _: RCTPromiseRejectBlock
  ) {
    resolve(["ready": ElasticOtelReactNative.isReady])
  }

  @objc(startSpan:parentSpanHandle:resolver:rejecter:)
  public func startSpan(
    _ name: String,
    parentSpanHandle: String?,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    settle(resolve, reject: reject) {
      try telemetry.startSpan(
        name: name,
        parentSpanHandle: parentSpanHandle
      )
    }
  }

  @objc(endSpan:resolver:rejecter:)
  public func endSpan(
    _ handle: String,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    settle(resolve, reject: reject) {
      try telemetry.endSpan(handle: handle)
      return nil
    }
  }

  @objc(emitLog:severity:spanHandle:resolver:rejecter:)
  public func emitLog(
    _ body: String,
    severity: String,
    spanHandle: String?,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    settle(resolve, reject: reject) {
      try telemetry.emitLog(
        body: body,
        severity: severity,
        spanHandle: spanHandle
      )
      return nil
    }
  }

  @objc(recordWidgetClick:widgetName:timestamp:resolver:rejecter:)
  public func recordWidgetClick(
    _ widgetId: String,
    widgetName: String?,
    timestamp: Double,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    settle(resolve, reject: reject) {
      try interactions.recordWidgetClick(
        widgetId: widgetId,
        widgetName: widgetName,
        timestamp: timestamp
      )
      return nil
    }
  }

  private func settle(
    _ resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock,
    operation: () throws -> Any?
  ) {
    do {
      resolve(try operation())
    } catch {
      reject(Self.errorCode, error.localizedDescription, error)
    }
  }
}
