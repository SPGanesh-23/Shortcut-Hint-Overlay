// ESLint flat config. The extension runs in the browser with the Chrome
// APIs available; the tests run in Node. No globals package is used — the
// few globals we need are listed explicitly.
'use strict';

const browserGlobals = {
  chrome: 'readonly',
  document: 'readonly',
  window: 'readonly',
  location: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  URL: 'readonly',
  console: 'readonly',
  navigator: 'readonly',
  module: 'readonly', // only used by eslint.config.js itself
};

const nodeGlobals = {
  require: 'readonly',
  module: 'readonly',
  global: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  process: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  URL: 'readonly',
};

module.exports = [
  {
    ignores: ['node_modules/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: browserGlobals,
    },
    rules: {
      // catch (err) {} is used deliberately as "ignore this failure"
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-undef': 'error',
      'no-redeclare': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: nodeGlobals },
  },
];
