module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended'],
  rules: {
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'prefer-const': 'error',
    'no-var': 'error',
    'no-console': 'off',
    'no-redeclare': 'off', // Allow type and const with same name
  },
  env: {
    node: true,
    es6: true,
    jest: true,
  },
  ignorePatterns: [
    'dist/',
    'node_modules/',
    '*.js',
  ],
};
