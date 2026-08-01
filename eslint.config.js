import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

// Flat config (ESLint 9+). Two scopes, matching the two workspaces:
//   - backend/**: Node.js ESM (see backend/package.json -> "type": "module")
//   - frontend/src/**: browser + JSX (React 18, new JSX transform — no `React` import
//     needed per-file, but main.jsx still imports it explicitly for React.StrictMode)
// See ARCHITECTURE.md -> Testing & CI/CD -> "On every push/PR: install, lint, run unit +
// integration tests."
export default [
  js.configs.recommended,
  {
    ignores: ['**/node_modules/**', 'backend/data/**', 'frontend/dist/**', 'frontend/node_modules/**'],
  },
  {
    files: ['backend/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['frontend/src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    settings: { react: { version: '18.3' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
