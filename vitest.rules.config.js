import { defineConfig } from 'vitest/config';

// Security rules tests; need the emulators (npm run test:rules).
export default defineConfig({
  test: {
    include: ['tests/rules/**/*.test.js'],
    testTimeout: 20000,
    fileParallelism: false,
  },
});
