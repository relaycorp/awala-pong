import baseConfig from '@relaycorp/shared-config/jest.mjs';
export default {
  ...baseConfig,
  setupFilesAfterEnv: [...baseConfig.setupFilesAfterEnv ?? [], 'jest-extended/all'],
  coveragePathIgnorePatterns: [
    "_test_utils\.ts",
    "/bin",
    "/functionalTests",
    "/testUtils",
    "/types",
    "/index\.ts",
  ],
  testPathIgnorePatterns: [
    ...baseConfig.testPathIgnorePatterns,
    "/src/functionalTests/",
  ],
};
