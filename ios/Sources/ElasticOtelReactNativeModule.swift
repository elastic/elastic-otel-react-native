import Foundation
import OpenTelemetryApi
import React

@objc(ElasticOtelReactNativeModule)
public final class ElasticOtelReactNativeModule: NSObject {
  private static let errorCode = "E_ELASTIC_OTEL_REACT_NATIVE"

  private let telemetry = ManualTelemetry(
    instrumentationScopeName: {
      ElasticOtelReactNative.instrumentationScopeName
    },
    tracerProvider: {
      try ElasticOtelReactNative.requireReady()
      return OpenTelemetry.instance.tracerProvider
    },
    loggerProvider: {
      try ElasticOtelReactNative.requireReady()
      return OpenTelemetry.instance.loggerProvider
    }
  )
  private let interactions = InteractionTelemetry(
    loggerProvider: {
      try ElasticOtelReactNative.requireReady()
      return OpenTelemetry.instance.loggerProvider
    }
  )

  @objc
  public static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(getStatus:rejecter:)
  public func getStatus(
    _ resolve: RCTPromiseResolveBlock,
    rejecter _: RCTPromiseRejectBlock
  ) {
    let ready = ElasticOtelReactNative.isReady
    resolve([
      "ready": ready,
      "state": ready ? "ready" : "not_ready",
    ])
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
