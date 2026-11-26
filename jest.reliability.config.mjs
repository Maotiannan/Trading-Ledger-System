import nextJest from 'next/jest.js';

export default nextJest({ dir: './' })({
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testMatch: ['<rootDir>/tests/reliability/*.integration.ts'],
  testTimeout: 20000,
});
