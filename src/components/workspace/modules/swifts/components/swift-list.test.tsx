import { fireEvent, render, screen } from '@testing-library/react';
import { SwiftList } from './swift-list';
import type { Swift } from '@/lib/store';

describe('SwiftList', () => {
  const tx = (zh: string) => zh;
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
  const swift: Swift = {
    id: 'swift-1',
    detailId: 'detail-1',
    amount: 100,
    date: '2026-05-07T00:00:00.000Z',
    senderName: 'Sender',
    senderAddress: null,
    receiverName: 'Receiver',
    receiverAccount: '123',
    imageUrl: null,
    status: 'Bank_Transfer',
    hasError: false,
    errorMessage: null,
    createdAt: '2026-05-07T00:00:00.000Z',
  };

  it('shows an admin received confirmation action for bank-transfer swifts', () => {
    const onMarkReceived = jest.fn();
    render(
      <SwiftList
        swifts={[swift]}
        isAdmin
        canEdit
        tx={tx}
        getSwiftStatus={() => 'Bank_Transfer'}
        onViewImage={() => undefined}
        onEditSwift={() => undefined}
        onMarkReceived={onMarkReceived}
        onDeleteSwift={() => undefined}
        {...paginationProps}
      />
    );

    fireEvent.click(screen.getByTitle('签收SWIFT'));

    expect(onMarkReceived).toHaveBeenCalledWith('swift-1');
  });

  it('does not show received confirmation action for non-admin accounts', () => {
    render(
      <SwiftList
        swifts={[swift]}
        isAdmin={false}
        canEdit
        tx={tx}
        getSwiftStatus={() => 'Bank_Transfer'}
        onViewImage={() => undefined}
        onEditSwift={() => undefined}
        onMarkReceived={() => undefined}
        onDeleteSwift={() => undefined}
        {...paginationProps}
      />
    );

    expect(screen.queryByTitle('签收SWIFT')).not.toBeInTheDocument();
  });

  it('renders rows per page controls and emits page size changes', () => {
    const onPageSizeChange = jest.fn();
    render(
      <SwiftList
        swifts={[swift]}
        isAdmin
        canEdit
        tx={tx}
        getSwiftStatus={() => 'Bank_Transfer'}
        onViewImage={() => undefined}
        onEditSwift={() => undefined}
        onMarkReceived={() => undefined}
        onDeleteSwift={() => undefined}
        {...paginationProps}
        onPageSizeChange={onPageSizeChange}
      />
    );

    fireEvent.change(screen.getByLabelText('每页条数'), { target: { value: '20' } });

    expect(onPageSizeChange).toHaveBeenCalledWith(20);
  });
});
