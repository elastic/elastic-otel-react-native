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
      guard ResourceEnvironment.preserves(key: key, value: value) else {
        throw BootstrapException(
          "On iOS, the resource attribute \(key) is not supported: keys and values must not contain ',' or '=', keys must not start or end with whitespace, and values must not start or end with '^', '\"', '|', or '$'."
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

// EDOT iOS 2.1.0 reads resource attributes only from OTEL_RESOURCE_ATTRIBUTES.
// Its parser splits entries on ',' and each entry on '=', drops entries that
// do not split into exactly a key and a value, trims whitespace from keys, and
// trims '^', '"', '|', and '$' from both ends of values. `preserves` accepts
// only attributes that parser reads back unchanged.
enum ResourceEnvironment {
  static let key = AgentEnvResource.otelResourceAttributesEnv
  private static let separators = CharacterSet(charactersIn: ",=")
  private static let trimmedValueCharacters = CharacterSet(
    charactersIn: "^\"|$"
  )

  static func preserves(key: String, value: String) -> Bool {
    key.rangeOfCharacter(from: separators) == nil
      && value.rangeOfCharacter(from: separators) == nil
      && key.trimmingCharacters(in: .whitespacesAndNewlines) == key
      && value.trimmingCharacters(in: trimmedValueCharacters) == value
  }

  // Sets every attribute in OTEL_RESOURCE_ATTRIBUTES, replacing existing
  // entries with the same keys and keeping the others, and restores the
  // original value after the operation.
  static func withResourceAttributes<T>(
    _ attributes: [String: String],
    operation: () throws -> T
  ) throws -> T {
    let original = getenv(key).map { String(cString: $0) }
    let existing = original?
      .split(separator: ",", omittingEmptySubsequences: true)
      .map(String.init)
      .filter { entry in
        guard
          let entryKey = entry.split(separator: "=", maxSplits: 1).first
        else {
          return true
        }
        return attributes[
          entryKey.trimmingCharacters(in: .whitespacesAndNewlines)
        ] == nil
      } ?? []
    let configured = attributes.sorted(by: { $0.key < $1.key })
      .map { "\($0.key)=\($0.value)" }

    guard setenv(key, (existing + configured).joined(separator: ","), 1) == 0
    else {
      throw BootstrapException(
        "Could not configure the EDOT iOS resource attributes."
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

      try ResourceEnvironment.withResourceAttributes(
        validated.resourceAttributes
      ) {
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
