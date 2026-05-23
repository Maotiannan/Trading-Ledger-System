import { render, screen } from '@testing-library/react';
import { DetailList } from './detail-list';
import type { Detail } from '@/lib/store';

const tx = (zh: string, _en: string) => zh;

function makeDetail(overrides: Partial<Detail> = {}): Detail {
  return {
    id: 'detail-1',
    agentId: 'agent-1',
    agent: {
      id: 'agent-1',
      companyName: 'Mitty Group',
      companyAddress: null,
      contactName: null,
      contactPhone: null,
    },
    date: '2026-05-23T00:00:00.000Z',
    status: 'Waiting_SWIFT',
    sourceMode: 'DIRECT',
    imageUrl: null,
    imageName: null,
    totalAmount: 250,
    createdAt: '2026-05-23T00:00:00.000Z',
    creator: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
    items: [],
    ...overrides,
  };
}

describe('DetailList', () => {
  it('shows the payment agent company in the payment detail header', () => {
    render(
      <DetailList
        details={[makeDetail()]}
        expandedDetails={new Set()}
        canEdit
        tx={tx}
        onToggleDetail={jest.fn()}
        onViewImage={jest.fn()}
        onEditDetail={jest.fn()}
        onExportDetailPic={jest.fn()}
        onDeleteDetail={jest.fn()}
      />
    );

    expect(screen.getByText('Mitty Group')).toBeInTheDocument();
  });
});
