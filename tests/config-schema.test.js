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

const Ajv2020 = require('ajv/dist/2020').default;
const schema = require('../elastic-otel-config.schema.json');

describe('elastic-otel-config.json schema', () => {
  it('describes exactly the configuration file keys', () => {
    expect(Object.keys(schema.properties).sort()).toEqual(
      [
        '$schema',
        'apiKey',
        'exportProtocol',
        'exportUrl',
        'resourceAttributes',
        'sessionSampleRate',
      ].sort(),
    );
    expect(schema.required.sort()).toEqual(['exportUrl', 'resourceAttributes']);
  });

  it('rejects keys outside the contract', () => {
    expect(schema.additionalProperties).toBe(false);
  });

  it('requires a service.name resource attribute', () => {
    expect(schema.properties.resourceAttributes.required).toEqual([
      'service.name',
    ]);
  });

  it('accepts any string as the ignored $schema reference', () => {
    expect(schema.properties.$schema).toEqual({
      description: expect.any(String),
      type: 'string',
    });
  });

  it('requires every string the bridge reads to contain a non-whitespace character', () => {
    const nonBlankString = { $ref: '#/$defs/nonBlankString' };
    const stringRules = [
      schema.properties.exportUrl,
      schema.properties.apiKey,
      schema.properties.resourceAttributes.additionalProperties,
      schema.properties.resourceAttributes.propertyNames,
    ];
    for (const rule of stringRules) {
      expect(rule).toMatchObject(nonBlankString);
    }
  });

  it('accepts resource attribute keys of at most 255 printable ASCII characters', () => {
    const validate = new Ajv2020().compile(schema);
    const config = (key) => ({
      exportUrl: 'https://example.com',
      resourceAttributes: { 'service.name': 'service', [key]: 'value' },
    });
    for (const key of [
      'custom,key',
      'custom=key',
      ' custom.key',
      'custom.key ',
      'k'.repeat(255),
    ]) {
      expect(validate(config(key))).toBe(true);
    }
    for (const key of [
      ' ',
      'k'.repeat(256),
      'custom.ключ',
      'custom\tkey',
      'custom\nkey',
    ]) {
      expect(validate(config(key))).toBe(false);
    }
  });

  it('rejects blank strings through the non-blank pattern', () => {
    expect(schema.$defs.nonBlankString.type).toBe('string');
    const pattern = new RegExp(schema.$defs.nonBlankString.pattern, 'u');
    expect(pattern.test('   ')).toBe(false);
    expect(pattern.test('')).toBe(false);
    expect(pattern.test('x')).toBe(true);
    expect(pattern.test('  x  ')).toBe(true);
  });
});
