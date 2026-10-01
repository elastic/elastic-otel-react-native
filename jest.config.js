module.exports = {
  testEnvironment: 'node',
  modulePathIgnorePatterns: ['<rootDir>/build/'],
  transform: {
    '^.+\\.ts$': '<rootDir>/scripts/jest-typescript-transformer.cjs',
  },
};
