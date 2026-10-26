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

import ElasticApm
import Foundation
import OpenTelemetrySdk

public enum AuthenticationConfiguration: Equatable {
  case none
  case apiKey(String)
  case secretToken(String)
}

public enum Transport: Equatable {
  case http
  case grpc
}

public struct BootstrapConfiguration: Equatable {
  public let exportUrl: String
  public let authentication: AuthenticationConfiguration
  public let transport: Transport
  public let sessionSampleRate: Double?
  public let resourceAttributes: [String: String]

  public init(
    exportUrl: String,
    authentication: AuthenticationConfiguration = .none,
    transport: Transport = .http,
    sessionSampleRate: Double? = nil,
    resourceAttributes: [String: String]
  ) {
    self.exportUrl = exportUrl
    self.authentication = authentication
    self.transport = transport
    self.sessionSampleRate = sessionSampleRate
    self.resourceAttributes = resourceAttributes
  }
}

public struct BootstrapException: Error, Equatable, LocalizedError {
  public let message: String

  public init(_ message: String) {
    self.message = message
  }

  public var errorDescription: String? {
    message
  }
}

struct ValidatedBootstrapConfiguration: Equatable {
  let exportUrl: URL
  let authentication: AuthenticationConfiguration
  let transport: Transport
  let sessionSampleRate: Double?
  let resourceAttributes: [String: String]
}

enum BootstrapValidator {
  static let serviceNameKey = "service.name"

  static func validate(
    _ configuration: BootstrapConfiguration
  ) throws -> ValidatedBootstrapConfiguration {
    let exportUrl = configuration.exportUrl.trimmingCharacters(
      in: .whitespacesAndNewlines
    )
    guard !exportUrl.isEmpty else {
      throw BootstrapException("An OTLP export URL is required.")
    }
    guard let components = URLComponents(string: exportUrl) else {
      throw BootstrapException("The OTLP export URL is invalid.")
    }
    let scheme = components.scheme?.lowercased()
    guard scheme == "http" || scheme == "https" else {
      throw BootstrapException("The OTLP export URL must use http or https.")
    }
    guard let host = components.host, !host.isEmpty else {
      throw BootstrapException("The OTLP export URL must include a host.")
    }
    guard let url = components.url else {
      throw BootstrapException("The OTLP export URL is invalid.")
    }
    guard components.query == nil, components.fragment == nil else {
      throw BootstrapException(
        "The OTLP base URL must not include a query or fragment."
      )
    }
    let normalizedPath = components.path.lowercased().trimmingCharacters(
      in: CharacterSet(charactersIn: "/")
    )
    if ["v1/traces", "v1/logs", "v1/metrics"].contains(where: {
      normalizedPath == $0 || normalizedPath.hasSuffix("/\($0)")
    }) {
      throw BootstrapException(
        "The OTLP base URL must not include a signal-specific path."
      )
    }

    if let sampleRate = configuration.sessionSampleRate,
      !sampleRate.isFinite || !(0.0 ... 1.0).contains(sampleRate)
    {
      throw BootstrapException(
        "The session sample rate must be between 0 and 1."
      )
    }

    let resourceAttributes = configuration.resourceAttributes
    try validateResourceAttributes(resourceAttributes)
    guard resourceAttributes[serviceNameKey] != nil else {
      throw BootstrapException(
        "The resource attribute \(serviceNameKey) is required."
      )
    }

    switch configuration.authentication {
    case .none:
      break
    case .apiKey(let value):
      guard !isBlank(value) else {
        throw BootstrapException("The API key must not be blank.")
      }
    case .secretToken(let value):
      guard !isBlank(value) else {
        throw BootstrapException("The secret token must not be blank.")
      }
    }

    return ValidatedBootstrapConfiguration(
      exportUrl: url,
      authentication: configuration.authentication,
      transport: configuration.transport,
      sessionSampleRate: configuration.sessionSampleRate,
      resourceAttributes: resourceAttributes
    )
  }

  private static func validateResourceAttributes(
    _ attributes: [String: String]
  ) throws {
    for (key, value) in attributes.sorted(by: { $0.key < $1.key }) {
      guard !isBlank(key) else {
        throw BootstrapException("Resource attribute keys must not be blank.")
      }
      guard !isBlank(value) else {
        throw BootstrapException(
          "The resource attribute \(key) must not be blank."
        )
      }
      guard
        key.unicodeScalars.count <= 255,
        key.unicodeScalars.allSatisfy({ (32 ... 126).contains($0.value) })
      else {
        throw BootstrapException(
          "The resource attribute key \(key) must be at most 255 printable ASCII characters."
        )
      }
    }
  }

  private static func isBlank(_ value: String) -> Bool {
    value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }
}

final class AgentLifecycle<Agent> {
  private let lock = NSRecursiveLock()
  private var initializedAgent: Agent?

  // Supplies the configuration only after the duplicate check, so a repeated
  // call reports the duplicate instead of a configuration error.
  func initialize(
    configuration: () throws -> BootstrapConfiguration,
    factory: (ValidatedBootstrapConfiguration) throws -> Agent
  ) throws -> Agent {
    lock.lock()
    defer { lock.unlock() }

    guard initializedAgent == nil else {
      throw BootstrapException("EDOT iOS has already been initialized.")
    }

    let validated = try BootstrapValidator.validate(configuration())
    let agent = try factory(validated)
    initializedAgent = agent
    return agent
  }

  func requireAgent() throws -> Agent {
    lock.lock()
    defer { lock.unlock() }

    guard let initializedAgent else {
      throw BootstrapException(
        "EDOT iOS is not initialized. Bootstrap it in AppDelegate before React Native starts."
      )
    }
    return initializedAgent
  }

  func isInitialized() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return initializedAgent != nil
  }
}

// Adds the configured attributes to the resource EDOT iOS builds, keeping
// every attribute it already holds.
func resourceAttributesInterceptor(
  _ attributes: [String: String]
) -> any Interceptor<Resource> {
  ClosureInterceptor<Resource> { resource in
    resource.merging(
      other: Resource(attributes: attributes.mapValues { .string($0) })
    )
  }
}

public enum ElasticOtelReactNative {
  private static let lifecycle = AgentLifecycle<ElasticApmAgent>()

  // Reads elastic-otel-config.json, which the resource reference that
  // setup-ios adds copies from the React Native project root into the app
  // bundle.
  public static func initialize() throws {
    try initialize {
      try ConfigFileReader.read(loadResource: ConfigFileReader.bundleResource)
    }
  }

  public static func initialize(
    _ configuration: BootstrapConfiguration
  ) throws {
    try initialize { configuration }
  }

  private static func initialize(
    configuration: () throws -> BootstrapConfiguration
  ) throws {
    _ = try lifecycle.initialize(configuration: configuration) { validated in
      guard ElasticApmAgent.shared() == nil else {
        throw BootstrapException(
          "EDOT iOS was initialized outside @elastic/otel-react-native."
        )
      }

      let builder = AgentConfigBuilder()
        .withExportUrl(validated.exportUrl)
        .useConnectionType(
          validated.transport == .http ? .http : .grpc
        )
        .addResourceInterceptor(
          resourceAttributesInterceptor(validated.resourceAttributes)
        )
      switch validated.authentication {
      case .none:
        break
      case .apiKey(let value):
        builder.withApiKey(value)
      case .secretToken(let value):
        builder.withSecretToken(value)
      }
      if let sessionSampleRate = validated.sessionSampleRate {
        builder.withSessionSampleRate(sessionSampleRate)
      }

      ElasticApmAgent.start(with: builder.build())
      guard let agent = ElasticApmAgent.shared() else {
        throw BootstrapException("EDOT iOS failed to initialize.")
      }
      return agent
    }
  }

  public static var isReady: Bool {
    lifecycle.isInitialized()
  }

  static func requireReady() throws {
    _ = try lifecycle.requireAgent()
  }
}
