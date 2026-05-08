import { render, screen } from '@testing-library/react';
import { LoginPage } from './login-page';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      title: 'Login',
      subtitle: 'Sign in to continue',
      email: 'Email',
      password: 'Password',
      submit: 'Sign in',
      loginFailed: 'Login failed',
      networkError: 'Network error',
    };
    return messages[key] || key;
  },
}));

jest.mock('@/lib/store', () => ({
  useStore: () => ({ setUser: jest.fn() }),
}));

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

describe('LoginPage', () => {
  it('renders blank credential fields without admin defaults or browser credential autofill hints', () => {
    render(<LoginPage />);

    const email = screen.getByLabelText('Email');
    const password = screen.getByLabelText('Password');
    const form = email.closest('form');

    expect(email).toHaveValue('');
    expect(password).toHaveValue('');
    expect(email).not.toHaveAttribute('placeholder', 'admin@example.com');
    expect(password).not.toHaveAttribute('placeholder', '••••••');
    expect(form).toHaveAttribute('autoComplete', 'off');
    expect(email).not.toHaveAttribute('id', 'email');
    expect(password).not.toHaveAttribute('id', 'password');
    expect(email).toHaveAttribute('autoComplete', 'new-password');
    expect(password).toHaveAttribute('autoComplete', 'new-password');
  });
});
