import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.js'],
    exclude: ['tests/**', 'node_modules/**'],
  },
});
