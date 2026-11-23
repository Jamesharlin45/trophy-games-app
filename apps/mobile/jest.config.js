/**
 * Jest config for the mobile app.
 *
 * Covers the app under `src/` (expo-router routes use `src/app/...`).
 */
module.exports = {
    rootDir: __dirname,
    roots: ['<rootDir>/src', '<rootDir>/__tests__'],
    testMatch: ['**/*.test.{ts,tsx}'],
    testPathIgnorePatterns: ['/node_modules/', '/\\.expo/'],
    preset: './jest-expo-rn81-preset.js',
};
