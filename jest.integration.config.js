// Integration-test jest config (plan 07-01).
//
// Runs ONLY the real-router integration specs under `test/integration`
// (testMatch: files ending in `.int.ts`). It is deliberately separate from
// the base `jest` config in package.json (roots `<rootDir>/src`) so `npm test`
// never picks these up — integration tests must never run in the unit suite or
// fail when no lab router is reachable.
//
// The two moduleNameMapper entries are the ONLY seam that lets the library
// load under Node jest:
//   - `react-native`            → no-op AppState stub (RouterOSAPI LIFE-01)
//   - `react-native-tcp-socket` → bridge to Node's built-in `net`/`tls`
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test/integration'],
  testMatch: ['**/*.int.ts'],
  setupFiles: ['<rootDir>/test/integration/setup.ts'],
  moduleNameMapper: {
    '^react-native$': '<rootDir>/test/integration/mocks/react-native.ts',
    '^react-native-tcp-socket$':
      '<rootDir>/test/integration/mocks/react-native-tcp-socket.ts',
  },
  testTimeout: 30000, // real-device latency + MD5 login + command round-trips
};
