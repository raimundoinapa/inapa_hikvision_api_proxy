module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/tests/**/*.test.js',
    '**/*.test.js'
  ],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/'
  ],
  setupFilesAfterEnv: [],
  testTimeout: 10000,
  verbose: true,
  testPathIgnorePatterns: [
    '/node_modules/'
  ]
}; 