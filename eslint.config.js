// Flat ESLint config for the plugin. The client bundle is a hand-written
// browser script that intentionally uses globals (window, document, etc.),
// so those are declared here rather than fought in the code.
export default [
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**', 'assets/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        requestAnimationFrame: 'readonly',
        ResizeObserver: 'readonly',
        MutationObserver: 'readonly',
        matchMedia: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        HTMLElement: 'readonly',
        Element: 'readonly',
        CustomEvent: 'readonly',
        Event: 'readonly',
        navigator: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-constant-condition': 'warn',
    },
  },
]
