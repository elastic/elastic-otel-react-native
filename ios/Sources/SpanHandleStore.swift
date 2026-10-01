import Foundation

final class SpanHandleStore<Value> {
  private let lock = NSRecursiveLock()
  private let endValue: (Value) -> Void
  private var nextId: UInt64 = 1
  private var values: [String: Value] = [:]

  init(end: @escaping (Value) -> Void) {
    endValue = end
  }

  func retain(_ value: Value) -> String {
    lock.lock()
    defer { lock.unlock() }

    let handle = "span-\(nextId)"
    nextId += 1
    values[handle] = value
    return handle
  }

  func withActive<Result>(
    _ handle: String,
    operation: (Value) throws -> Result
  ) throws -> Result {
    lock.lock()
    defer { lock.unlock() }

    guard let value = values[handle] else {
      throw BootstrapException(
        "Unknown or already-ended span handle: \(handle)"
      )
    }
    return try operation(value)
  }

  func end(_ handle: String) throws {
    lock.lock()
    defer { lock.unlock() }

    guard let value = values.removeValue(forKey: handle) else {
      throw BootstrapException(
        "Unknown or already-ended span handle: \(handle)"
      )
    }
    endValue(value)
  }
}
