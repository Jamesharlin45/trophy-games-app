/**
 * Jest preset for the mobile app.
 *
 * Composes RN 0.81.5's compat jest preset (react-native/jest-preset) with the
 * jest-expo pieces (native environment + setup) used by the standard
 * `preset: 'jest-expo'` — the full jest-expo@58 preset expects
 * `@react-native/jest-preset@0.88.x` internals that don't match the installed
 * react-native@0.81.5 (and can't run on this Node build, which has no
 * vm.SourceTextModule). This is the same composition minus the incompatible
 * parts.
 *
 * transformIgnorePatterns is the bun-aware form of the upstream allowlist:
 * bun realpaths modules to `node_modules/.bun/<pkg>+<hash>/node_modules/<pkg>`,
 * which the upstream regex never matches.
 */

'use strict';

const path = require('node:path');

const RN_PRESET = require('react-native/jest-preset.js');
const preset = structuredClone(RN_PRESET);

// jest-expo native test environment.
preset.testEnvironment = require.resolve('jest-expo/src/preset/nativeEnvironment.js');

// Transform project sources with the project babel config (picks up
// apps/mobile/babel.config.js, including babel-preset-expo).
const babelJestPath = require.resolve('babel-jest', { paths: [path.dirname(require.resolve('jest/package.json'))] });
preset.transform['\\.[jt]sx?$'] = [
    babelJestPath,
    require('jest-expo/src/resolveBabelOptions.js').resolveBabelOptions(__dirname),
];

// Allow transforming react-native / @react-native / @react-native-community /
// expo / @expo / react-navigation / @react-navigation / reanimated etc., and
// ignore everything else — in both classic and bun-realpath module layouts.
preset.transformIgnorePatterns = [
    '/node_modules/(?!(.pnpm|.bun|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|react-native-reanimated|react-native-worklets))',
];

// NOTE: jest-expo's setup.js (Expo module mocks) is skipped — it assumes the
// RN 0.88 module layout (react-native/asset-registry, src/private/...) which
// RN 0.81.5 doesn't ship. RN compat setup.js covers the basics.

module.exports = require('jest-expo/src/preset/withTypescriptMapping.js').withTypescriptMapping(preset);
