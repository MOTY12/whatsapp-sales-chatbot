/** @type {import('jest').Config} */
const tsJestOptions = {
  isolatedModules: true,
  tsconfig: {
    module: 'commonjs',
    moduleResolution: 'node',
    esModuleInterop: true,
    emitDecoratorMetadata: true,
    experimentalDecorators: true,
    allowJs: true,
    strictNullChecks: true,
    skipLibCheck: true,
  },
};

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', tsJestOptions],
  },
  // @nestjs/typeorm 12 ships ESM; transform it so Jest can load repository tests.
  transformIgnorePatterns: ['node_modules/(?!(@nestjs/typeorm)/)'],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
