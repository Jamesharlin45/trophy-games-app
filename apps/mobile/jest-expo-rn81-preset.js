/**
 * Jest preset for the mobile app.
 *
 * Expo SDK 54 ships jest-expo 54 alongside React Native 0.81, and its official
 * preset is the supported composition for this pair. The previous local
 * composition referenced `jest-expo/src/preset/nativeEnvironment.js`, which no
 * longer exists in jest-expo 54, so Jest could not start at all.
 *
 * Kept as a named module so jest.config.js (and any external tooling) can keep
 * pointing at the same path.
 */

'use strict';

module.exports = require('jest-expo/jest-preset');
