import { fireEvent, render, screen } from '@testing-library/react';
import { CustomerList } from './customer-list';

describe('CustomerList', () => {
  const tx = (zh: string) => zh;

  it('renders every ORDER_NAME alias as a clickable history action', () => {
    const onOpenOrderNameHistory = jest.fn();

    render(
      <CustomerList
        customers={[{
          id: 'customer-1',
          mark: 'MAB',
          orderName: 'MAB-1',
          orderNames: [
            { orderName: 'MAB-1', isPrimary: true },
            { orderName: 'MARY', isPrimary: false },
          ],
          name: 'Mamadou Aliou Barry',
          phone: '+224 620 07 11 76',
          city: 'Conakry',
          ownerId: 'sales-1',
          owner: { email: 'sales@example.com', role: 'SALES' },
        }]}
        canSeeExtended={false}
        isAdmin
        tx={tx}
        phoneConflictMessage="手机号冲突，请修改"
        formatOwnerLabel={() => 'sales@example.com (SALES)'}
        truncateLongText={(value) => value}
        onPreviewLongText={() => undefined}
        onOpenOrderNameHistory={onOpenOrderNameHistory}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'MAB-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'MARY' }));

    expect(onOpenOrderNameHistory).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'customer-1' }), 'MAB-1');
    expect(onOpenOrderNameHistory).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'customer-1' }), 'MARY');
  });
});
