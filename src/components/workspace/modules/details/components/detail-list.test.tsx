import { fireEvent, render, screen } from '@testing-library/react';
import { DetailList } from './detail-list';
import type { Detail } from '@/lib/store';

const tx = (zh: string, _en: string) => zh;
const paginationProps = {
  currentPage: 1,
  totalPages: 1,
  totalCount: 1,
  pageSize: 10,
  pageSizeOptions: [5, 10, 20, 50],
  onPreviousPage: jest.fn(),
  onNextPage: jest.fn(),
  onPageSizeChange: jest.fn(),
};

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
        isAdmin
        tx={tx}
        onToggleDetail={jest.fn()}
        onViewImage={jest.fn()}
        onEditDetail={jest.fn()}
        onExportDetailPic={jest.fn()}
        onDeleteDetail={jest.fn()}
        {...paginationProps}
      />
    );

    expect(screen.getByText('Mitty Group')).toBeInTheDocument();
  });

  it('shows view image action even when a direct-created detail has no uploaded image', () => {
    const onViewImage = jest.fn();
    render(
      <DetailList
        details={[makeDetail({ imageUrl: null, sourceMode: 'DIRECT' })]}
        expandedDetails={new Set()}
        canEdit
        isAdmin
        tx={tx}
        onToggleDetail={jest.fn()}
        onViewImage={onViewImage}
        onEditDetail={jest.fn()}
        onExportDetailPic={jest.fn()}
        onDeleteDetail={jest.fn()}
        {...paginationProps}
      />
    );

    fireEvent.click(screen.getByTitle('查看图片'));

    expect(onViewImage).toHaveBeenCalledWith(expect.objectContaining({ id: 'detail-1' }));
  });

  it('hides edit and deletion actions for non-admin users after the payment detail is received', () => {
    render(
      <DetailList
        details={[makeDetail({ status: 'RECEIVED' })]}
        expandedDetails={new Set()}
        canEdit
        isAdmin={false}
        tx={tx}
        onToggleDetail={jest.fn()}
        onViewImage={jest.fn()}
        onEditDetail={jest.fn()}
        onExportDetailPic={jest.fn()}
        onDeleteDetail={jest.fn()}
        {...paginationProps}
      />
    );

    expect(screen.queryByTitle('修改付款明细')).not.toBeInTheDocument();
    expect(screen.queryByTitle('申请删除')).not.toBeInTheDocument();
    expect(screen.getByTitle('查看图片')).toBeInTheDocument();
    expect(screen.getByTitle('导出图片')).toBeInTheDocument();
  });

  it('keeps edit and deletion actions visible for admin users after the payment detail is received', () => {
    render(
      <DetailList
        details={[makeDetail({ status: 'RECEIVED' })]}
        expandedDetails={new Set()}
        canEdit
        isAdmin
        tx={tx}
        onToggleDetail={jest.fn()}
        onViewImage={jest.fn()}
        onEditDetail={jest.fn()}
        onExportDetailPic={jest.fn()}
        onDeleteDetail={jest.fn()}
        {...paginationProps}
      />
    );

    expect(screen.getByTitle('修改付款明细')).toBeInTheDocument();
    expect(screen.getByTitle('申请删除')).toBeInTheDocument();
  });

  it('renders compact pagination controls and emits page size changes', () => {
    const onPageSizeChange = jest.fn();
    render(
      <DetailList
        details={[makeDetail()]}
        expandedDetails={new Set()}
        canEdit
        isAdmin
        tx={tx}
        onToggleDetail={jest.fn()}
        onViewImage={jest.fn()}
        onEditDetail={jest.fn()}
        onExportDetailPic={jest.fn()}
        onDeleteDetail={jest.fn()}
        {...paginationProps}
        onPageSizeChange={onPageSizeChange}
      />
    );

    expect(screen.getByText('1 / 1 (1)')).toBeInTheDocument();
    expect(screen.queryByText('每页条数')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一页' })).toHaveTextContent('←');
    expect(screen.getByRole('button', { name: '下一页' })).toHaveTextContent('→');

    fireEvent.change(screen.getByLabelText('每页条数'), { target: { value: '20' } });

    expect(onPageSizeChange).toHaveBeenCalledWith(20);
  });
});
