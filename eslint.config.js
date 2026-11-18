import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['www/**', 'dist-artifact/**', 'dev-dist/**', 'android/**', 'node_modules/**',
      'playwright-report/**', 'test-results/**', 'screenshots/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^(h|_)' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Node scripts, configs and tests
    files: ['*.config.js', 'scripts/**', 'artifact/build.mjs', 'tests/**', 'src/**/__tests__/**', 'worker/**/*.test.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['worker/**'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    // Code passed to page.evaluate runs in the browser and uses the app's global.
    files: ['tests/e2e/**'],
    languageOptions: { globals: { app: 'readonly' } },
  },
];
