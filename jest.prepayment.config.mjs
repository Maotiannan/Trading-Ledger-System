import nextJest from 'next/jest.js';

export default nextJest({ dir: './' })({
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  modulePathIgnorePatterns: ['<rootDir>/.next', '<rootDir>/out/'],
  testMatch: ['<rootDir>/tests/prepayment/*.integration.ts'],
  testTimeout: 30000,
});
