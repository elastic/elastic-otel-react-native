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
    ];
    for (const rule of stringRules) {
      expect(rule).toMatchObject(nonBlankString);
    }
    expect(schema.properties.resourceAttributes.propertyNames.pattern).toBe(
      schema.$defs.nonBlankString.pattern,
    );
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
