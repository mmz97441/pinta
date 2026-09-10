module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['react', 'react-hooks'],
  rules: {
    'no-undef': 'error', 'no-unreachable': 'error', 'no-constant-condition': 'error',
    'no-dupe-args': 'error', 'no-dupe-keys': 'error', 'no-duplicate-case': 'error',
    'no-unsafe-finally': 'error', 'no-async-promise-executor': 'error',
    'react-hooks/rules-of-hooks': 'error',
    'react/jsx-no-undef': 'error',
  },
};
