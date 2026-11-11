module.exports = {
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          resolvePackageJsonExports: false,
          // Resolve imported column types when emitting TypeORM metadata.
          isolatedModules: false,
        },
      },
    ],
  },
  testEnvironment: 'node',
  testMatch: ['<rootDir>/integration/**/*.spec.ts'],
  testTimeout: 30000,
};
