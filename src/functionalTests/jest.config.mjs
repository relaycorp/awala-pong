import { fileURLToPath } from 'node:url';
import path from 'node:path';

import mainJestConfig from '../../jest.config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  ...mainJestConfig,
  roots: [__dirname],
  testPathIgnorePatterns: [],
  preset: null,
};
