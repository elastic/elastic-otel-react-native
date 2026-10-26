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
