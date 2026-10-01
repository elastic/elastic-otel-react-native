// swift-tools-version: 5.10

import PackageDescription

let package = Package(
  name: "ElasticOtelReactNativeCore",
  platforms: [
    .iOS(.v16),
    .macOS(.v13),
  ],
  products: [
    .library(
      name: "ElasticOtelReactNativeCore",
      targets: ["ElasticOtelReactNativeCore"]
    ),
  ],
  dependencies: [
    .package(
      url: "https://github.com/elastic/apm-agent-ios.git",
      exact: "1.4.0"
    ),
    .package(
      url: "https://github.com/open-telemetry/opentelemetry-swift",
      exact: "1.17.0"
    ),
  ],
  targets: [
    .target(
      name: "ElasticOtelReactNativeCore",
      dependencies: [
        .product(name: "ElasticApm", package: "apm-agent-ios"),
        .product(
          name: "OpenTelemetryApi",
          package: "opentelemetry-swift"
        ),
      ],
      path: "Sources",
      exclude: [
        "ElasticOtelReactNativeModule.m",
        "ElasticOtelReactNativeModule.swift",
      ]
    ),
    .testTarget(
      name: "ElasticOtelReactNativeCoreTests",
      dependencies: [
        "ElasticOtelReactNativeCore",
        .product(
          name: "OpenTelemetrySdk",
          package: "opentelemetry-swift"
        ),
      ],
      path: "Tests"
    ),
  ]
)
