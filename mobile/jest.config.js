module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native|@react-native(-community)?|expo|expo-modules-core|expo(nent)?|@expo(nent)?|@expo/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|lucide-react-native|zustand)',
  ],
  moduleNameMapper: {
    // lucide-react-native's ESM build ships as .mjs, which jest-expo's
    // transform doesn't match; point Jest at the CJS build instead.
    '^lucide-react-native$':
      '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
  testMatch: ['**/__tests__/**/*.test.(ts|tsx)'],
};
