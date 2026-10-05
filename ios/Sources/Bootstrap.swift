import Darwin
import ElasticApm
import Foundation

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
  public let serviceName: String

  public init(
    exportUrl: String,
    authentication: AuthenticationConfiguration = .none,
    transport: Transport = .http,
    sessionSampleRate: Double? = nil,
    serviceName: String
  ) {
    self.exportUrl = exportUrl
    self.authentication = authentication
    self.transport = transport
    self.sessionSampleRate = sessionSampleRate
    self.serviceName = serviceName
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
  let serviceName: String
}

enum BootstrapValidator {
  static func validate(
    _ configuration: BootstrapConfiguration
  ) throws -> ValidatedBootstrapConfiguration {
    let exportUrl = configuration.exportUrl.trimmingCharacters(
      in: .whitespacesAndNewlines
    )
    guard !exportUrl.isEmpty else {
      throw BootstrapException("An OTLP export URL is required.")
    }
    guard
      let components = URLComponents(string: exportUrl),
      let scheme = components.scheme?.lowercased(),
      scheme == "http" || scheme == "https",
      let host = components.host,
      !host.isEmpty,
      let url = components.url
    else {
      throw BootstrapException(
        "The OTLP export URL must use http or https and include a host."
      )
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

    let serviceName = configuration.serviceName.trimmingCharacters(
      in: .whitespacesAndNewlines
    )
    guard !serviceName.isEmpty else {
      throw BootstrapException("A service name is required.")
    }
    guard !serviceName.contains(","), !serviceName.contains("=") else {
      throw BootstrapException(
        "On iOS, the service name must not contain ',' or '='."
      )
    }

    if let sampleRate = configuration.sessionSampleRate,
      !sampleRate.isFinite || !(0.0 ... 1.0).contains(sampleRate)
    {
      throw BootstrapException(
        "The session sample rate must be between 0 and 1."
      )
    }

    switch configuration.authentication {
    case .none:
      break
    case .apiKey(let value):
      guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      else {
        throw BootstrapException("The API key must not be blank.")
      }
    case .secretToken(let value):
      guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      else {
        throw BootstrapException("The secret token must not be blank.")
      }
    }

    return ValidatedBootstrapConfiguration(
      exportUrl: url,
      authentication: configuration.authentication,
      transport: configuration.transport,
      sessionSampleRate: configuration.sessionSampleRate,
      serviceName: serviceName
    )
  }
}

final class AgentLifecycle<Agent> {
  private let lock = NSRecursiveLock()
  private var initializedAgent: Agent?

  func initialize(
    configuration: ValidatedBootstrapConfiguration,
    factory: (ValidatedBootstrapConfiguration) throws -> Agent
  ) throws -> Agent {
    lock.lock()
    defer { lock.unlock() }

    guard initializedAgent == nil else {
      throw BootstrapException("EDOT iOS has already been initialized.")
    }

    let agent = try factory(configuration)
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

enum ResourceEnvironment {
  static let key = AgentEnvResource.otelResourceAttributesEnv

  static func withServiceName<T>(
    _ serviceName: String,
    operation: () throws -> T
  ) throws -> T {
    let original = getenv(key).map { String(cString: $0) }
    let existing = original?
      .split(separator: ",", omittingEmptySubsequences: true)
      .map(String.init)
      .filter { entry in
        entry.split(separator: "=", maxSplits: 1)
          .first?
          .trimmingCharacters(in: .whitespacesAndNewlines) != "service.name"
      } ?? []
    let resourceAttributes = (existing + ["service.name=\(serviceName)"])
      .joined(separator: ",")

    guard setenv(key, resourceAttributes, 1) == 0 else {
      throw BootstrapException(
        "Could not configure the EDOT iOS service name resource."
      )
    }
    defer {
      if let original {
        setenv(key, original, 1)
      } else {
        unsetenv(key)
      }
    }
    return try operation()
  }
}

public enum ElasticOtelReactNative {
  private static let lifecycle = AgentLifecycle<ElasticApmAgent>()

  public static func initialize(
    _ configuration: BootstrapConfiguration
  ) throws {
    let validated = try BootstrapValidator.validate(configuration)
    _ = try lifecycle.initialize(configuration: validated) { validated in
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

      try ResourceEnvironment.withServiceName(validated.serviceName) {
        ElasticApmAgent.start(with: builder.build())
      }
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
