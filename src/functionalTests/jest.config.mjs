import { fileURLToPath } from 'node:url';
import path from 'node:path';

import mainJestConfig from '../../jest.config.mjs';

const currentDirName = path.dirname(fileURLToPath(import.meta.url));

const config = {
  ...mainJestConfig,
  roots: [currentDirName],
  testPathIgnorePatterns: [],
  preset: null,
};

export default config;
