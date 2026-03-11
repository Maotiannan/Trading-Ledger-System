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
      branches: 40,
      functions: 65,
      lines: 60,
      statements: 60,
    },
    './src/components/workspace/modules/invoices/hooks/use-invoice-view-state.ts': {
      branches: 60,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    './src/components/workspace/modules/invoices/hooks/use-invoice-actions.ts': {
      branches: 45,
      functions: 70,
      lines: 55,
      statements: 55,
    },
    './src/components/workspace/modules/customers/hooks/use-customer-forms.ts': {
      branches: 45,
      functions: 35,
      lines: 70,
      statements: 70,
    },
    './src/components/workspace/modules/customers/hooks/use-customer-actions.ts': {
      branches: 22,
      functions: 45,
      lines: 35,
      statements: 35,
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
      branches: 30,
      functions: 80,
      lines: 60,
      statements: 60,
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
