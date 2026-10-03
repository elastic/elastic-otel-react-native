const schema = require('../elastic-otel-config.schema.json');

describe('elastic-otel-config.json schema', () => {
  it('describes exactly the configuration file keys', () => {
    expect(Object.keys(schema.properties).sort()).toEqual(
      [
        '$schema',
        'apiKey',
        'deploymentEnvironmentName',
        'exportProtocol',
        'exportUrl',
        'resourceAttributes',
        'serviceName',
        'serviceVersion',
        'sessionSampleRate',
      ].sort(),
    );
    expect(schema.required.sort()).toEqual(['exportUrl', 'serviceName']);
  });

  it('rejects keys outside the contract', () => {
    expect(schema.additionalProperties).toBe(false);
  });
});
