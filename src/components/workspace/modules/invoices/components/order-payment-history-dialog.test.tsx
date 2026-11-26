import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { apiCall } from '@/components/workspace/api/client';
import { OrderPaymentHistoryDialog } from './order-payment-history-dialog';

jest.mock('@/components/workspace/api/client', () => ({
  ...jest.requireActual('@/components/workspace/api/client'), apiCall: jest.fn(),
}));
const request = jest.mocked(apiCall);
const props = { orderId: 'mock-order', title: 'TEST-01', tx: (_zh: string, en: string) => en, onClose: jest.fn() };

it('does not report a failed or loading request as no payments; retries the requested page', async () => {
  request.mockReset().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
    success: true, data: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 },
  });
  render(<OrderPaymentHistoryDialog {...props} />);
  expect(screen.queryByText('No payment records')).not.toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  expect(screen.queryByText('No payment records')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No payment records')).toBeInTheDocument();
  expect(request.mock.calls[0][0]).toEqual(request.mock.calls[1][0]);
});

it('can reach payment 31 and resets the requested page when page size changes', async () => {
  request.mockReset().mockImplementation(async path => {
    const params = new URLSearchParams(path.split('?')[1]);
    const page = Number(params.get('page')), pageSize = Number(params.get('pageSize'));
    const start = (page - 1) * pageSize;
    return { success: true, data: Array.from({ length: Math.min(pageSize, 31 - start) }, (_, i) => ({
      id: String(start + i), receiptNo: 'R-' + (start + i + 1), usd: 5, status: 'RECEIVED',
    })), pagination: { page, pageSize, totalItems: 31, totalPages: Math.ceil(31 / pageSize) } };
  });
  render(<OrderPaymentHistoryDialog {...props} />);
  for (const n of [1, 11, 21]) {
    await screen.findByText('R-' + n);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  }
  expect(await screen.findByText('R-31')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '20' } });
  await waitFor(() => expect(screen.getByText('1 / 2 (31)')).toBeInTheDocument());
  expect(screen.getByText('R-1')).toBeInTheDocument();
});
