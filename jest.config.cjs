/** @type {import('jest').Config} */
const tsJestOptions = {
  tsconfig: {
    module: 'commonjs',
    moduleResolution: 'node',
    resolvePackageJsonExports: false,
    esModuleInterop: true,
    emitDecoratorMetadata: true,
    experimentalDecorators: true,
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
  moduleNameMapper: {
    '^@nestjs/typeorm$': '<rootDir>/testing/typeorm-jest.mock.ts',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
