'use client';

import { render, screen } from '@testing-library/react';
import { CustomerFormDialog } from './customer-form-dialog';

describe('CustomerFormDialog', () => {
  const tx = (zh: string, _en: string) => zh;
  const txEn = (_zh: string, en: string) => en;

  it('highlights phone input when a phone conflict exists', () => {
    render(
      <CustomerFormDialog
        open
        editing={{ id: 'customer-1' }}
        form={{
          mark: 'IB',
          orderName: 'IB',
          orderNames: [],
          name: 'Ibrahima',
          phone: '622443103',
          city: 'Conakry',
          consignee: '',
          companyName: '',
          credit: '',
          companyAddress: '',
          ownerId: 'sales-1',
        }}
        isAdmin={false}
        ownerOptions={[]}
        tx={tx}
        phoneConflict
        phoneConflictMessage="手机号冲突，请修改"
        onOpenChange={() => undefined}
        onFormChange={() => undefined}
        onSubmit={() => undefined}
      />
    );

    const phoneInput = screen.getByPlaceholderText(/^PHONE\*$/);
    expect(phoneInput).toHaveClass('border-red-500');
    expect(phoneInput).toHaveAttribute('title', '手机号冲突，请修改');
    expect(screen.getByText('手机号冲突，请修改')).toBeInTheDocument();
  });

  it('renders english phone conflict copy when locale text is english', () => {
    render(
      <CustomerFormDialog
        open
        editing={{ id: 'customer-1' }}
        form={{
          mark: 'IB',
          orderName: 'IB',
          orderNames: [],
          name: 'Ibrahima',
          phone: '622443103',
          city: 'Conakry',
          consignee: '',
          companyName: '',
          credit: '',
          companyAddress: '',
          ownerId: 'sales-1',
        }}
        isAdmin={false}
        ownerOptions={[]}
        tx={txEn}
        phoneConflict
        phoneConflictMessage="Phone number conflict, please update it."
        onOpenChange={() => undefined}
        onFormChange={() => undefined}
        onSubmit={() => undefined}
      />
    );

    const phoneInput = screen.getByPlaceholderText(/^PHONE\*$/);
    expect(phoneInput).toHaveAttribute('title', 'Phone number conflict, please update it.');
    expect(screen.getByText('Phone number conflict, please update it.')).toBeInTheDocument();
  });
});
