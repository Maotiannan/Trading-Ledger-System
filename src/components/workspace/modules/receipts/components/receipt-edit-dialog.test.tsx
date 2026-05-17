import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceiptEditDialog } from './receipt-edit-dialog';

describe('ReceiptEditDialog', () => {
  const tx = (zh: string) => zh;

  it('shows an adopt suggestion button only when order lookup suggestions exist', async () => {
    const user = userEvent.setup();
    const onAdoptSuggestion = jest.fn();

    render(
      <ReceiptEditDialog
        open
        locale="zh"
        form={{
          receiptNo: '0001001',
          date: '2026-05-01',
          orderNo: 'PIKIN-20',
          invNo: null,
          customerMark: null,
          payer: null,
          tel: null,
        }}
        suggestion={{
          orderNo: 'PIKIN-20',
          invNo: 'L25MH090002',
          customerMark: 'PIKIN',
          payer: 'Mamadou Dian Diallo "PIKIN"',
          tel: '622491286',
        }}
        suggestionLoading={false}
        submitting={false}
        isAdmin
        tx={tx}
        onOpenChange={() => undefined}
        onFormChange={() => undefined}
        onAdoptSuggestion={onAdoptSuggestion}
        onSubmit={() => undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: '采纳匹配建议' }));

    expect(onAdoptSuggestion).toHaveBeenCalledTimes(1);
  });

  it('hides the adopt suggestion button when there is no suggestion', () => {
    render(
      <ReceiptEditDialog
        open
        locale="zh"
        form={{
          receiptNo: '0001001',
          date: '2026-05-01',
          orderNo: 'PIKIN-20',
          invNo: null,
          customerMark: null,
          payer: null,
          tel: null,
        }}
        suggestion={null}
        suggestionLoading={false}
        submitting={false}
        isAdmin
        tx={tx}
        onOpenChange={() => undefined}
        onFormChange={() => undefined}
        onAdoptSuggestion={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    expect(screen.queryByRole('button', { name: '采纳匹配建议' })).not.toBeInTheDocument();
  });
});
