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
        onOpenConsignees={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'MAB-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'MARY' }));

    expect(onOpenOrderNameHistory).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'customer-1' }), 'MAB-1');
    expect(onOpenOrderNameHistory).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'customer-1' }), 'MARY');
  });

  it('opens the CONSIGNEE management dialog from the consignee cell', () => {
    const onOpenConsignees = jest.fn();

    render(
      <CustomerList
        customers={[{
          id: 'customer-1',
          mark: 'MAB',
          orderName: 'MAB-1',
          name: 'Mamadou Aliou Barry',
          phone: '+224 620 07 11 76',
          city: 'Conakry',
          consignee: 'Primary Consignee',
          consignees: [
            { id: 'consignee-1', consignee: 'Primary Consignee', isPrimary: true },
            { id: 'consignee-2', consignee: 'Second Consignee', isPrimary: false },
          ],
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
        onOpenOrderNameHistory={() => undefined}
        onOpenConsignees={onOpenConsignees}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Primary Consignee +1' }));

    expect(onOpenConsignees).toHaveBeenCalledWith(expect.objectContaining({ id: 'customer-1' }));
  });
});
