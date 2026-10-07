// Safari 14 is the declared build target (vite.config.js). The build only
// rewrites syntax: these ES2022/ES2023 array and string methods would throw
// there at run time. Only their calls are refused, so a data field named `at`
// (a reminder's date, for instance) stays readable.
const missingInSafari14 = [
  ['at', 'utilisez liste[liste.length - 1] ou texte.charAt(index)'],
  ['findLast', 'parcourez la liste depuis la fin'],
  ['findLastIndex', 'parcourez la liste depuis la fin'],
  ['toSorted', 'utilisez [...liste].sort()'],
  ['toReversed', 'utilisez [...liste].reverse()'],
  ['toSpliced', 'copiez la liste puis utilisez splice()'],
  ['with', 'copiez la liste puis remplacez l’élément'],
].flatMap(([name, instead]) => ['name', 'value'].map(key => ({
  selector: `CallExpression[callee.type='MemberExpression'][callee.property.${key}='${name}']`,
  message: `${name}() n’existe pas dans Safari 14, cible du build (vite.config.js) : ${instead}.`,
})));

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
    'no-restricted-syntax': ['error', ...missingInSafari14],
  },
  // Unit tests run in Node (22.12 or later), never in a browser.
  overrides: [{ files: ['**/*.test.js'], rules: { 'no-restricted-syntax': 'off' } }],
};
