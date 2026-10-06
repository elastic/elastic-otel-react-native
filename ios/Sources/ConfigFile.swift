import Foundation

let configFileName = "elastic-otel-config.json"

// Reads elastic-otel-config.json into a BootstrapConfiguration. The file must be
// one strict JSON object; trailing content is rejected, and a repeated key keeps
// one of its values. Beyond syntax, this reader checks only the document shape:
// known keys and JSON types. BootstrapValidator owns every value rule.
enum ConfigFileReader {
  private static let schemaKey = "$schema"
  private static let knownKeys: Set<String> = [
    schemaKey,
    "exportUrl",
    "apiKey",
    "exportProtocol",
    "sessionSampleRate",
    "resourceAttributes",
  ]

  static func read(
    loadResource: (String) -> Data?
  ) throws -> BootstrapConfiguration {
    guard let data = loadResource(configFileName) else {
      throw BootstrapException(
        "\(configFileName) was not found in the app bundle. Create it at the React Native project root, run setup-ios, and check that the file is in the app target's Copy Bundle Resources build phase."
      )
    }
    return try parse(data)
  }

  static func bundleResource(_ name: String) -> Data? {
    let file = name as NSString
    guard
      let url = Bundle.main.url(
        forResource: file.deletingPathExtension,
        withExtension: file.pathExtension
      )
    else {
      return nil
    }
    return try? Data(contentsOf: url)
  }

  static func parse(_ data: Data) throws -> BootstrapConfiguration {
    let document = try readDocument(data)
    for key in document.keys.sorted() where !knownKeys.contains(key) {
      throw BootstrapException(
        "\(configFileName) contains the unknown key \(key)."
      )
    }
    // Editors read $schema; the bridge only checks its type.
    _ = try optionalString(document, schemaKey)

    guard let exportUrl = try optionalString(document, "exportUrl") else {
      throw BootstrapException(
        "\(configFileName) is missing the required key exportUrl."
      )
    }
    return BootstrapConfiguration(
      exportUrl: exportUrl,
      authentication: try optionalString(document, "apiKey")
        .map(AuthenticationConfiguration.apiKey) ?? .none,
      transport: try transport(document),
      sessionSampleRate: try optionalNumber(document, "sessionSampleRate"),
      resourceAttributes: try resourceAttributes(document)
    )
  }

  private static func readDocument(_ data: Data) throws -> [String: Any] {
    let value: Any
    do {
      value = try JSONSerialization.jsonObject(with: data)
    } catch {
      throw notOneObject(
        (error as NSError).userInfo[NSDebugDescriptionErrorKey] as? String
          ?? error.localizedDescription
      )
    }
    guard let document = value as? [String: Any] else {
      throw notOneObject("found an array")
    }
    return document
  }

  private static func notOneObject(_ detail: String) -> BootstrapException {
    BootstrapException("\(configFileName) must contain one JSON object: \(detail)")
  }

  private static func optionalString(
    _ document: [String: Any],
    _ key: String
  ) throws -> String? {
    guard let value = document[key] else {
      return nil
    }
    guard let string = value as? String else {
      throw BootstrapException("\(configFileName) key \(key) must be a string.")
    }
    return string
  }

  private static func optionalNumber(
    _ document: [String: Any],
    _ key: String
  ) throws -> Double? {
    guard let value = document[key] else {
      return nil
    }
    // JSONSerialization returns true and false as NSNumber too.
    guard let number = value as? NSNumber,
      CFGetTypeID(number) != CFBooleanGetTypeID()
    else {
      throw BootstrapException("\(configFileName) key \(key) must be a number.")
    }
    return number.doubleValue
  }

  private static func transport(_ document: [String: Any]) throws -> Transport {
    switch try optionalString(document, "exportProtocol") {
    case nil, "http":
      return .http
    case "grpc":
      return .grpc
    case let value?:
      throw BootstrapException(
        "\(configFileName) key exportProtocol must be \"http\" or \"grpc\", not \"\(value)\"."
      )
    }
  }

  private static func resourceAttributes(
    _ document: [String: Any]
  ) throws -> [String: String] {
    guard let value = document["resourceAttributes"] else {
      return [:]
    }
    guard let attributes = value as? [String: Any] else {
      throw BootstrapException(
        "\(configFileName) key resourceAttributes must be an object."
      )
    }
    var result: [String: String] = [:]
    for (key, value) in attributes.sorted(by: { $0.key < $1.key }) {
      guard let attribute = value as? String else {
        throw BootstrapException(
          "\(configFileName) key resourceAttributes.\(key) must be a string."
        )
      }
      result[key] = attribute
    }
    return result
  }
}
