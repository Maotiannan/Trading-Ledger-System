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
    'src/components/workspace/modules/settings/hooks/use-settings-forms.ts',
    'src/components/workspace/modules/settings/hooks/use-settings-actions.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 25,
      functions: 35,
      lines: 35,
      statements: 35,
    },
    './src/components/workspace/modules/invoices/hooks/use-invoice-view-state.ts': {
      branches: 50,
      functions: 100,
      lines: 80,
      statements: 80,
    },
    './src/components/workspace/modules/invoices/hooks/use-invoice-actions.ts': {
      branches: 17,
      functions: 40,
      lines: 29,
      statements: 29,
    },
    './src/components/workspace/modules/customers/hooks/use-customer-forms.ts': {
      branches: 40,
      functions: 35,
      lines: 60,
      statements: 60,
    },
    './src/components/workspace/modules/customers/hooks/use-customer-actions.ts': {
      branches: 15,
      functions: 25,
      lines: 20,
      statements: 20,
    },
    './src/components/workspace/modules/settings/hooks/use-settings-forms.ts': {
      branches: 50,
      functions: 100,
      lines: 70,
      statements: 70,
    },
    './src/components/workspace/modules/settings/hooks/use-settings-actions.ts': {
      branches: 20,
      functions: 40,
      lines: 35,
      statements: 35,
    },
  },
};

export default createJestConfig(customJestConfig);
