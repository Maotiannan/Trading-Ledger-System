import { fireEvent, render, screen } from '@testing-library/react';
import { PaymentAgentManagerDialog } from './payment-agent-manager-dialog';
import type { PaymentAgentSummary } from '../types';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  apiUploadCall: jest.fn(),
  getApiErrorMessage: jest.fn((value: unknown, fallback: string) => {
    if (value && typeof value === 'object' && 'message' in value) return String(value.message);
    return fallback;
  }),
}));

describe('PaymentAgentManagerDialog', () => {
  const tx = (zh: string) => zh;
  const agents: PaymentAgentSummary[] = [
    {
      id: 'agent-1',
      companyName: 'Mitty Group',
      companyAddress: 'Madina',
      contactName: 'Diallo',
      contactPhone: '2240001',
      createdBy: 'admin-1',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
      files: [{
        id: 'file-1',
        name: 'license.pdf',
        path: 'agents/files/license.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        createdAt: '2026-05-01T00:00:00.000Z',
      }],
    },
    {
      id: 'agent-2',
      companyName: 'Second Agent',
      companyAddress: null,
      contactName: null,
      contactPhone: null,
      createdBy: 'admin-1',
      createdAt: '2026-05-02T00:00:00.000Z',
      updatedAt: '2026-05-02T00:00:00.000Z',
      files: [],
    },
  ];

  function renderDialog(overrides: Partial<React.ComponentProps<typeof PaymentAgentManagerDialog>> = {}) {
    return render(
      <PaymentAgentManagerDialog
        open
        agents={agents}
        loading={false}
        tx={tx}
        onOpenChange={jest.fn()}
        onAgentsReload={jest.fn(async () => {})}
        {...overrides}
      />
    );
  }

  it('keeps the dialog in create mode after clicking New when agents already exist', () => {
    renderDialog();

    expect(screen.getByDisplayValue('Mitty Group')).toBeInTheDocument();
    expect(screen.getByText('公司文件')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '新增' }));

    expect(screen.queryByDisplayValue('Mitty Group')).not.toBeInTheDocument();
    expect(screen.queryByText('公司文件')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除代理' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('uses a constrained desktop two-column layout with a scrollable information panel', () => {
    renderDialog();

    expect(screen.getByTestId('payment-agent-dialog-content')).toHaveClass('lg:max-w-[1180px]');
    expect(screen.getByTestId('payment-agent-dialog-body')).toHaveClass('lg:grid-cols-[300px_minmax(0,1fr)]');
    expect(screen.getByTestId('payment-agent-detail-panel')).toHaveClass('overflow-y-auto');
  });
});
