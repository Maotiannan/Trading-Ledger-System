import nextJest from 'next/jest.js';

const createJestConfig = nextJest({
  dir: './',
});

const customJestConfig = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/tests/e2e/'],
  modulePathIgnorePatterns: ['<rootDir>/.next/standalone/'],
  collectCoverageFrom: [
    'src/components/workspace/modules/invoices/hooks/use-invoice-view-state.ts',
    'src/components/workspace/modules/invoices/hooks/use-invoice-actions.ts',
    'src/components/workspace/modules/customers/hooks/use-customer-forms.ts',
    'src/components/workspace/modules/customers/hooks/use-customer-actions.ts',
    'src/components/workspace/modules/receipts/hooks/use-receipt-actions.ts',
    'src/components/workspace/modules/details/hooks/use-detail-actions.ts',
    'src/components/workspace/modules/swifts/hooks/use-swift-actions.ts',
    'src/components/workspace/modules/settings/hooks/use-settings-forms.ts',
    'src/components/workspace/modules/settings/hooks/use-settings-actions.ts',
    'src/components/workspace/modules/users/hooks/use-user-actions.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 42,
      functions: 68,
      lines: 62,
      statements: 62,
    },
    './src/components/workspace/modules/invoices/hooks/use-invoice-view-state.ts': {
      branches: 60,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    './src/components/workspace/modules/invoices/hooks/use-invoice-actions.ts': {
      branches: 50,
      functions: 75,
      lines: 58,
      statements: 58,
    },
    './src/components/workspace/modules/customers/hooks/use-customer-forms.ts': {
      branches: 45,
      functions: 35,
      lines: 70,
      statements: 70,
    },
    './src/components/workspace/modules/customers/hooks/use-customer-actions.ts': {
      branches: 23,
      functions: 50,
      lines: 39,
      statements: 39,
    },
    './src/components/workspace/modules/receipts/hooks/use-receipt-actions.ts': {
      branches: 45,
      functions: 100,
      lines: 80,
      statements: 79,
    },
    './src/components/workspace/modules/details/hooks/use-detail-actions.ts': {
      branches: 45,
      functions: 100,
      lines: 85,
      statements: 84,
    },
    './src/components/workspace/modules/swifts/hooks/use-swift-actions.ts': {
      branches: 45,
      functions: 100,
      lines: 85,
      statements: 83,
    },
    './src/components/workspace/modules/settings/hooks/use-settings-forms.ts': {
      branches: 60,
      functions: 100,
      lines: 90,
      statements: 90,
    },
    './src/components/workspace/modules/settings/hooks/use-settings-actions.ts': {
      branches: 35,
      functions: 90,
      lines: 64,
      statements: 64,
    },
    './src/components/workspace/modules/users/hooks/use-user-actions.ts': {
      branches: 45,
      functions: 100,
      lines: 85,
      statements: 84,
    },
  },
};

export default createJestConfig(customJestConfig);
