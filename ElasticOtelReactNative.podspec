require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |spec|
  spec.name = 'ElasticOtelReactNative'
  spec.version = package['version']
  spec.summary = package['description']
  spec.homepage = package['homepage']
  spec.license = package['license']
  spec.authors = 'Elastic'
  spec.source = {
    :git => 'https://github.com/elastic/elastic-otel-react-native.git',
    :tag => spec.version.to_s
  }

  spec.platform = :ios, '16.0'
  spec.source_files = 'ios/Sources/**/*.{m,swift}'
  spec.dependency 'React-Core'
  spec.swift_version = '5.10'
  spec.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  spm_dependency(
    spec,
    url: 'https://github.com/elastic/apm-agent-ios.git',
    requirement: {
      kind: 'exactVersion',
      version: '2.2.0'
    },
    products: ['ElasticApm']
  )
end
