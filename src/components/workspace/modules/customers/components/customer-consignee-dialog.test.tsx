import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { CustomerConsigneeDialog } from './customer-consignee-dialog';

jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

describe('CustomerConsigneeDialog', () => {
  const tx = (zh: string) => zh;

  it('adds and deletes consignee entries from the dialog', () => {
    const onAdd = jest.fn();
    const onDelete = jest.fn();
    const onSetPrimary = jest.fn();
    const onInputChange = jest.fn();

    render(
      <CustomerConsigneeDialog
        open
        customerLabel="MAB / Mamadou"
        consignees={[{ id: 'consignee-1', consignee: 'Primary Consignee', isPrimary: true }]}
        inputValue="Second Consignee"
        loading={false}
        submitting={false}
        error=""
        tx={tx}
        onOpenChange={() => undefined}
        onInputChange={onInputChange}
        onAdd={onAdd}
        onDelete={onDelete}
        onSetPrimary={onSetPrimary}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /新增/ }));
    fireEvent.click(screen.getByRole('button', { name: /删除 CONSIGNEE/ }));

    expect(screen.getByText('Primary Consignee')).toBeInTheDocument();
    expect(screen.getByText('当前默认')).toBeInTheDocument();
    expect(screen.queryByText('删除')).not.toBeInTheDocument();
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('consignee-1');
  });

  it('lets users choose a non-primary consignee as the default', () => {
    const onSetPrimary = jest.fn();

    render(
      <CustomerConsigneeDialog
        open
        customerLabel="MAB / Mamadou"
        consignees={[
          { id: 'consignee-1', consignee: 'Primary Consignee', isPrimary: true },
          { id: 'consignee-2', consignee: 'Second Consignee', isPrimary: false },
        ]}
        inputValue=""
        loading={false}
        submitting={false}
        error=""
        tx={tx}
        onOpenChange={() => undefined}
        onInputChange={() => undefined}
        onAdd={() => undefined}
        onDelete={() => undefined}
        onSetPrimary={onSetPrimary}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /设为默认/ }));

    expect(onSetPrimary).toHaveBeenCalledWith('consignee-2');
  });
});
