// swift-tools-version: 5.10
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


import PackageDescription

let package = Package(
  name: "ElasticOtelReactNativeCore",
  platforms: [
    .iOS("15.1"),
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
      exact: "2.3.0"
    ),
    .package(
      url: "https://github.com/open-telemetry/opentelemetry-swift-core",
      from: "2.3.0"
    ),
  ],
  targets: [
    .target(
      name: "ElasticOtelReactNativeCore",
      dependencies: [
        .product(name: "ElasticApm", package: "apm-agent-ios"),
        .product(
          name: "OpenTelemetryApi",
          package: "opentelemetry-swift-core"
        ),
        .product(
          name: "OpenTelemetrySdk",
          package: "opentelemetry-swift-core"
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
          package: "opentelemetry-swift-core"
        ),
      ],
      path: "Tests"
    ),
  ]
)
