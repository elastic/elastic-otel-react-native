# Copyright Elastic Technologies Inc. and/or licensed to
# Elastic Technologies Inc. under one or more contributor license
# agreements. See the NOTICE file distributed with this work for
# additional information regarding copyright ownership.
# Elastic Technologies Inc. licenses this file to you under the Apache
# License, Version 2.0 (the "License"); you may not use this file except
# in compliance with the License. You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

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
