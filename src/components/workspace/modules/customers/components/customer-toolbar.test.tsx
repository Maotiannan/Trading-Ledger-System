import { fireEvent, render, screen } from '@testing-library/react';
import { CustomerToolbar } from './customer-toolbar';

describe('CustomerToolbar', () => {
  const tx = (zh: string) => zh;

  it('forces a customer search with the current input value when Enter is pressed', () => {
    const onSearchChange = jest.fn();
    const onSearchSubmit = jest.fn();

    render(
      <CustomerToolbar
        isAdmin={false}
        search="PIKIN"
        importOwnerId=""
        ownerOptions={[]}
        customerImporting={false}
        tx={tx}
        inputRef={{ current: null }}
        onFileChange={() => undefined}
        onSearchChange={onSearchChange}
        onSearchSubmit={onSearchSubmit}
        onImportOwnerChange={() => undefined}
        onDownloadTemplate={() => undefined}
        onOpenImport={() => undefined}
        onOpenCreate={() => undefined}
      />,
    );

    fireEvent.keyDown(screen.getByPlaceholderText('搜索 mark/order_name/name/phone/city'), {
      key: 'Enter',
      target: { value: 'PIKIN' },
    });

    expect(onSearchSubmit).toHaveBeenCalledWith('PIKIN');
  });
});
