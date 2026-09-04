import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { CustomerNotificationEmailDialog } from './customer-notification-email-dialog';

jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="notification-dialog-content" className={className}>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <footer data-testid="notification-dialog-footer" className={className}>{children}</footer>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

describe('CustomerNotificationEmailDialog', () => {
  const tx = (zh: string) => zh;
  const baseProps = {
    open: true,
    customerLabel: 'MAB / Mamadou Aliou Barry',
    emails: [
      { id: 'email-1', email: 'primary@example.com', isPrimary: true },
      { id: 'email-2', email: 'accounts@example.com', isPrimary: false },
    ],
    language: 'ENGLISH' as const,
    inputValue: '',
    editingEmailId: null,
    loading: false,
    submitting: false,
    error: '',
    tx,
    onOpenChange: jest.fn(),
    onInputChange: jest.fn(),
    onSubmit: jest.fn(),
    onStartEdit: jest.fn(),
    onCancelEdit: jest.fn(),
    onDelete: jest.fn(),
    onSetPrimary: jest.fn(),
    onLanguageChange: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('supports primary selection, editing, deletion, and language changes', () => {
    const onSetPrimary = jest.fn();
    const onStartEdit = jest.fn();
    const onDelete = jest.fn();
    const onLanguageChange = jest.fn();

    render(
      <CustomerNotificationEmailDialog
        {...baseProps}
        onSetPrimary={onSetPrimary}
        onStartEdit={onStartEdit}
        onDelete={onDelete}
        onLanguageChange={onLanguageChange}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'accounts@example.com' }));
    fireEvent.click(screen.getByRole('button', { name: /编辑 accounts@example.com/ }));
    fireEvent.click(screen.getByRole('button', { name: /删除 accounts@example.com/ }));
    fireEvent.change(screen.getByRole('combobox', { name: /语言偏好/ }), { target: { value: 'FRENCH' } });

    expect(screen.getByRole('radio', { name: 'primary@example.com' })).toBeChecked();
    expect(onSetPrimary).toHaveBeenCalledWith('email-2');
    expect(onStartEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'email-2' }));
    expect(onDelete).toHaveBeenCalledWith('email-2');
    expect(onLanguageChange).toHaveBeenCalledWith('FRENCH');
  });

  it('keeps backend errors visible and disables repeated actions while submitting', () => {
    render(
      <CustomerNotificationEmailDialog
        {...baseProps}
        inputValue="duplicate@example.com"
        submitting
        error="该客户已存在相同邮箱"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('该客户已存在相同邮箱');
    expect(screen.getByRole('button', { name: /新增/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /编辑 accounts@example.com/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /删除 accounts@example.com/ })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /语言偏好/ })).toBeDisabled();
  });

  it('keeps the mobile dialog bounded with a reachable sticky footer', () => {
    render(<CustomerNotificationEmailDialog {...baseProps} />);

    expect(screen.getByTestId('notification-dialog-content')).toHaveClass('max-h-[85dvh]');
    expect(screen.getByTestId('notification-dialog-footer')).toHaveClass('sticky', 'bottom-0');
  });
});
