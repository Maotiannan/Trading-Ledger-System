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
        canManageNotifications
        tx={tx}
        phoneConflictMessage="手机号冲突，请修改"
        formatOwnerLabel={() => 'sales@example.com (SALES)'}
        truncateLongText={(value) => value}
        onPreviewLongText={() => undefined}
        onOpenOrderNameHistory={onOpenOrderNameHistory}
        onOpenConsignees={() => undefined}
        onOpenNotificationEmails={() => undefined}
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
        canManageNotifications
        tx={tx}
        phoneConflictMessage="手机号冲突，请修改"
        formatOwnerLabel={() => 'sales@example.com (SALES)'}
        truncateLongText={(value) => value}
        onPreviewLongText={() => undefined}
        onOpenOrderNameHistory={() => undefined}
        onOpenConsignees={onOpenConsignees}
        onOpenNotificationEmails={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Primary Consignee +1' }));

    expect(onOpenConsignees).toHaveBeenCalledWith(expect.objectContaining({ id: 'customer-1' }));
  });

  it('shows the primary notification email count and language as one shared dialog action', () => {
    const onOpenNotificationEmails = jest.fn();
    const customer = {
      id: 'customer-1',
      mark: 'MAB',
      orderName: 'MAB-1',
      name: 'Mamadou Aliou Barry',
      phone: '+224 620 07 11 76',
      city: 'Conakry',
      ownerId: 'sales-1',
      owner: { email: 'sales@example.com', role: 'SALES' },
      primaryNotificationEmail: 'primary@example.com',
      notificationEmailCount: 3,
      notificationLanguage: 'FRENCH',
    };

    render(
      <CustomerList
        customers={[customer]}
        canSeeExtended={false}
        isAdmin
        canManageNotifications
        tx={tx}
        phoneConflictMessage="手机号冲突，请修改"
        formatOwnerLabel={() => 'sales@example.com (SALES)'}
        truncateLongText={(value) => value}
        onPreviewLongText={() => undefined}
        onOpenOrderNameHistory={() => undefined}
        onOpenConsignees={() => undefined}
        onOpenNotificationEmails={onOpenNotificationEmails}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'EMAIL' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '语言偏好' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'primary@example.com +2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Francais' }));

    expect(onOpenNotificationEmails).toHaveBeenNthCalledWith(1, customer);
    expect(onOpenNotificationEmails).toHaveBeenNthCalledWith(2, customer);
  });

  it('shows an empty email placeholder and the default English preference', () => {
    render(
      <CustomerList
        customers={[{
          id: 'customer-1',
          mark: 'MAB',
          orderName: 'MAB-1',
          name: 'Mamadou Aliou Barry',
          ownerId: 'sales-1',
          notificationEmailCount: 0,
          notificationLanguage: 'ENGLISH',
        }]}
        canSeeExtended={false}
        isAdmin
        canManageNotifications
        tx={tx}
        phoneConflictMessage="手机号冲突，请修改"
        formatOwnerLabel={() => 'sales@example.com (SALES)'}
        truncateLongText={(value) => value}
        onPreviewLongText={() => undefined}
        onOpenOrderNameHistory={() => undefined}
        onOpenConsignees={() => undefined}
        onOpenNotificationEmails={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: '未设置邮箱' })).toHaveTextContent('-');
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument();
  });

  it('keeps notification details read-only for users without maintenance permission', () => {
    render(
      <CustomerList
        customers={[{
          id: 'customer-1',
          mark: 'MAB',
          orderName: 'MAB-1',
          name: 'Mamadou Aliou Barry',
          primaryNotificationEmail: 'primary@example.com',
          notificationEmailCount: 1,
          notificationLanguage: 'ENGLISH',
        }]}
        canSeeExtended={false}
        isAdmin={false}
        canManageNotifications={false}
        tx={tx}
        phoneConflictMessage="手机号冲突，请修改"
        formatOwnerLabel={() => '-'}
        truncateLongText={(value) => value}
        onPreviewLongText={() => undefined}
        onOpenOrderNameHistory={() => undefined}
        onOpenConsignees={() => undefined}
        onOpenNotificationEmails={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(screen.getByText('primary@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'primary@example.com' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'English' })).not.toBeInTheDocument();
  });
});
