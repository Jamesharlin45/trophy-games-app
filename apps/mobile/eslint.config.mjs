import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
    {
        ignores: ['.expo/**', 'node_modules/**', 'assets/**', 'babel.config.js', 'metro.config.js'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
        },
        plugins: {
            'react-hooks': reactHooks,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/ban-ts-comment': 'error',
            // The billing bridge is deliberately require()'d lazily so Expo Go
            // can run without the native module installed.
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
    {
        // The billing module is resolved once at startup and never changes
        // between renders, so its conditional useIAP() call keeps a stable
        // hook order for the lifetime of the app.
        files: ['src/hooks/useIap.ts'],
        rules: {
            'react-hooks/rules-of-hooks': 'off',
        },
    },
    {
        // Jest configs are CommonJS Node scripts, not app code.
        files: ['jest.config.js', 'jest-expo-rn81-preset.js', 'scripts/**/*.{js,cjs,mjs}'],
        languageOptions: {
            globals: {
                require: 'readonly',
                module: 'readonly',
                exports: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                process: 'readonly',
                console: 'readonly',
                structuredClone: 'readonly',
                Buffer: 'readonly',
                setImmediate: 'readonly',
                clearImmediate: 'readonly',
                jest: 'readonly',
            },
        },
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
);
