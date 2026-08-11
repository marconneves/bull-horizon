module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Only the TypeScript sources are the tests. Without this, a stale `dist/`
  // from a previous build gets collected too and jest reports the compiled
  // `.d.ts` files as empty suites.
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/build/'],
  modulePathIgnorePatterns: ['<rootDir>/examples/'],
};
