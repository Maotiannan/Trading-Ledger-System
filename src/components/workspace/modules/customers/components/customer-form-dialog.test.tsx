'use client';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { CustomerFormDialog } from './customer-form-dialog';
import type { CustomerCompanyFileOverwriteProposal, CustomerCompanyFileSummary } from '../types';

function baseProps(overrides: Partial<React.ComponentProps<typeof CustomerFormDialog>> = {}) {
  const tx = (zh: string, _en: string) => zh;
  return {
    open: true,
    editing: { id: 'customer-1' },
    form: {
      mark: 'IB',
      orderName: 'IB',
      orderNames: [],
      name: 'Ibrahima',
      phone: '622443103',
      city: 'Conakry',
      consignee: '',
      companyName: 'OLD CO',
      credit: '',
      companyAddress: 'OLD ADDRESS',
      ownerId: 'sales-1',
    },
    isAdmin: true,
    ownerOptions: [],
    tx,
    phoneConflict: false,
    phoneConflictMessage: '',
    companyFiles: [] as CustomerCompanyFileSummary[],
    companyFileUploading: false,
    companyFileError: '',
    companyFileProposal: null as CustomerCompanyFileOverwriteProposal | null,
    onOpenChange: jest.fn(),
    onFormChange: jest.fn(),
    onSubmit: jest.fn(),
    onCompanyFileUpload: jest.fn(),
    onCompanyFileDelete: jest.fn(),
    onApplyCompanyFileOcrProposal: jest.fn(),
    onDismissCompanyFileOcrProposal: jest.fn(),
    ...overrides,
  };
}

describe('CustomerFormDialog', () => {
  it('highlights phone input when a phone conflict exists', () => {
    render(
      <CustomerFormDialog
        {...baseProps({
          isAdmin: false,
          phoneConflict: true,
          phoneConflictMessage: '手机号冲突，请修改',
        })}
      />
    );

    const phoneInput = screen.getByPlaceholderText(/^PHONE\*$/);
    expect(phoneInput).toHaveClass('border-red-500');
    expect(phoneInput).toHaveAttribute('title', '手机号冲突，请修改');
    expect(screen.getByText('手机号冲突，请修改')).toBeInTheDocument();
  });

  it('renders english phone conflict copy when locale text is english', () => {
    const txEn = (_zh: string, en: string) => en;
    render(
      <CustomerFormDialog
        {...baseProps({
          tx: txEn,
          isAdmin: false,
          phoneConflict: true,
          phoneConflictMessage: 'Phone number conflict, please update it.',
        })}
      />
    );

    const phoneInput = screen.getByPlaceholderText(/^PHONE\*$/);
    expect(phoneInput).toHaveAttribute('title', 'Phone number conflict, please update it.');
    expect(screen.getByText('Phone number conflict, please update it.')).toBeInTheDocument();
  });

  it('shows appended customer company files and upload/delete controls while editing', () => {
    const onCompanyFileDelete = jest.fn();
    render(
      <CustomerFormDialog
        {...baseProps({
          companyFiles: [{
            id: 'asset-1',
            path: '/upload/images/customers/files/company.pdf',
            name: 'company.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2048,
            createdAt: '2026-06-30T00:00:00.000Z',
          }],
          onCompanyFileDelete,
        })}
      />
    );

    expect(screen.getByText('公司文件')).toBeInTheDocument();
    expect(screen.getByText('company.pdf')).toBeInTheDocument();
    expect(screen.getByLabelText('上传公司文件')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除文件' }));
    expect(onCompanyFileDelete).toHaveBeenCalledWith('asset-1');
  });

  it('lets users choose field-by-field OCR overwrites before applying to the edit form', () => {
    const onApplyCompanyFileOcrProposal = jest.fn();
    const proposal: CustomerCompanyFileOverwriteProposal = {
      fields: [
        { key: 'companyName', label: 'COMPANY_NAME', currentValue: 'OLD CO', nextValue: 'NEW CO', selected: true },
        { key: 'companyAddress', label: 'COMPANY_ADDRESS', currentValue: 'OLD ADDRESS', nextValue: 'NEW ADDRESS', selected: true },
        { key: 'city', label: 'CITY', currentValue: 'Conakry', nextValue: 'Kindia', selected: false },
      ],
    };

    render(
      <CustomerFormDialog
        {...baseProps({
          companyFileProposal: proposal,
          onApplyCompanyFileOcrProposal,
        })}
      />
    );

    const dialog = screen.getByRole('dialog', { name: '确认是否覆盖客户信息' });
    expect(within(dialog).getByText('OLD CO')).toBeInTheDocument();
    expect(within(dialog).getByText('NEW CO')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '应用所选覆盖' }));
    expect(onApplyCompanyFileOcrProposal).toHaveBeenCalledWith(['companyName', 'companyAddress']);
  });
});
