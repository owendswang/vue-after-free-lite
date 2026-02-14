import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig } from 'eslint/config'
import neostandard from 'neostandard'

export default defineConfig([
  {
    ignores: ['**/vid/**/*.ts'], // Ignore MPEG-TS video files
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: {
      globals: {
        ...globals.browser,
        jsmaf: 'readonly',
        log: 'readonly',
      }
    },
  },
  { files: ['**/*.js'], languageOptions: { sourceType: 'script' } },
  tseslint.configs.recommended,
  neostandard({
    ts: true,
    env: ['browser', 'es2015'],
  }),
  {
    rules: {

      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],

      '@stylistic/quote-props': ['error', 'consistent-as-needed'],

      'quotes': 'off',
      'quote-props': 'off',

      'camelcase': 'off',
      'no-unused-vars': 'off',
      'no-var': 'off',
      'no-undef': 'off',
      'no-redeclare': 'off',
      'no-unused-expressions': 'off',
      'no-fallthrough': 'off',
      'no-new-native-nonconstructor': 'off',
      'no-extend-native': 'off',
      'no-new': 'off',

      '@stylistic/indent': 'off',
      '@stylistic/semi': 'off',
      '@stylistic/spaced-comment': 'off',
      '@stylistic/no-trailing-spaces': 'off',
      '@stylistic/space-before-function-paren': 'off',
      '@stylistic/keyword-spacing': 'off',

      'no-useless-escape': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-restricted-globals': ['error', 'Promise'],
      'no-restricted-syntax': [
        'error',
        {
          selector: "FunctionDeclaration[async=true], FunctionExpression[async=true], ArrowFunctionExpression[async=true]",
          message: 'PS4 WebKit: async/await banned（which relies on Promise)'
        },
        {
          selector: "AwaitExpression",
          message: 'PS4 WebKit: await banned（which relies on Promise)'
        }
      ]
    },
  },
])
