import Foundation
import OpenTelemetryApi

enum BridgeInput {
  static func spanName(_ value: String) throws -> String {
    guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      throw BootstrapException("A span name is required.")
    }
    return value
  }

  static func logBody(_ value: String) throws -> String {
    guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      throw BootstrapException("A log body is required.")
    }
    return value
  }

  static func severity(_ value: String) throws -> Severity {
    switch value.lowercased() {
    case "trace":
      return .trace
    case "debug":
      return .debug
    case "info":
      return .info
    case "warn":
      return .warn
    case "error":
      return .error
    case "fatal":
      return .fatal
    default:
      throw BootstrapException("Unsupported log severity: \(value)")
    }
  }

  static func widgetId(_ value: String) throws -> String {
    guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      throw BootstrapException("A widget ID is required.")
    }
    return value
  }

  static func widgetName(_ value: String?) throws -> String? {
    if let value,
      value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    {
      throw BootstrapException("A widget name must not be blank.")
    }
    return value
  }

  static func eventTimestamp(_ value: Double) throws -> Date {
    guard value.isFinite else {
      throw BootstrapException("A finite event timestamp is required.")
    }
    return Date(timeIntervalSince1970: value / 1_000)
  }
}
