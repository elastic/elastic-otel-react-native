/*
 * Copyright Elastic Technologies Inc. and/or licensed to
 * Elastic Technologies Inc. under one or more contributor license
 * agreements. See the NOTICE file distributed with this work for
 * additional information regarding copyright ownership.
 * Elastic Technologies Inc. licenses this file to you under the Apache
 * License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      modulePathIgnorePatterns: ['<rootDir>/build/'],
      testPathIgnorePatterns: ['/node_modules/', '/scroll-components.test.js$'],
      transform: {
        '^.+\\.ts$': '<rootDir>/scripts/jest-typescript-transformer.cjs',
      },
    },
    {
      displayName: 'components',
      preset: '@react-native/jest-preset',
      testMatch: ['<rootDir>/tests/scroll-components.test.js'],
      modulePathIgnorePatterns: ['<rootDir>/build/'],
      moduleNameMapper: {
        '^@elastic/otel-react-native$': '<rootDir>/src/index.ts',
      },
      transform: {
        '^.+\\.(js|ts|tsx)$': [
          // Use the preset's transformer with its compatible Babel peer.
          require.resolve('babel-jest', {
            paths: [require.resolve('@react-native/jest-preset')],
          }),
          {
            babelrc: false,
            configFile: false,
            presets: ['@react-native/babel-preset'],
          },
        ],
      },
    },
  ],
};
