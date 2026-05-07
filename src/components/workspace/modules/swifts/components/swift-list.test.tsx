import { fireEvent, render, screen } from '@testing-library/react';
import { SwiftList } from './swift-list';
import type { Swift } from '@/lib/store';

describe('SwiftList', () => {
  const tx = (zh: string) => zh;
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
      />
    );

    expect(screen.queryByTitle('签收SWIFT')).not.toBeInTheDocument();
  });
});
