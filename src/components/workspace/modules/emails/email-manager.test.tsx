'use client';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EmailManager } from './email-manager';
import { apiCall } from '@/components/workspace/shared';

const mockTranslate = (key: string) => key;
jest.mock('next-intl', () => ({
  useTranslations: () => mockTranslate,
}));

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  getApiErrorMessage: jest.fn((error: unknown, fallback: string) => (
    error instanceof Error ? error.message : fallback
  )),
}));

const rows = [
  notification('pending', 'PENDING'),
  notification('missing', 'MISSING_RECIPIENT', { primaryEmail: null }),
  notification('queued', 'QUEUED', { deliveries: [delivery('QUEUED')] }),
  notification('failed', 'FAILED', { deliveries: [delivery('FAILED')] }),
  notification('uncertain', 'DELIVERY_UNCERTAIN', { deliveries: [delivery('DELIVERY_UNCERTAIN')] }),
  notification('correction', 'NEEDS_CORRECTION', { deliveries: [delivery('DELIVERED')] }),
];

function delivery(status: string) {
  return {
    id: `delivery-${status}`,
    status,
    intendedTo: ['primary@example.com'],
    intendedCc: ['copy@example.com'],
    actualTo: ['test@example.com'],
    actualCc: [],
    subject: 'Payment received',
    lastErrorCode: status === 'FAILED' ? 'validation_error' : null,
    lastErrorMessage: status === 'FAILED' ? 'Email provider rejected the request.' : null,
    createdAt: '2026-09-01T01:00:00.000Z',
    updatedAt: '2026-09-01T01:00:00.000Z',
  };
}

function notification(id: string, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    eventKey: `PAYMENT:${id}`,
    type: 'PAYMENT_RECEIVED',
    status,
    customerId: `customer-${id}`,
    customerName: `Customer ${id}`,
    mark: id.toUpperCase(),
    language: 'ENGLISH',
    primaryEmail: 'primary@example.com',
    additionalEmailCount: 1,
    receiptId: `receipt-${id}`,
    receiptNo: `R-${id}`,
    invoiceId: null,
    invoiceNo: 'INV-1',
    currentSnapshot: { orderNos: [`ORDER-${id}`], amount: 100 },
    correctionReason: null,
    parentNotificationId: null,
    createdAt: '2026-09-01T01:00:00.000Z',
    updatedAt: '2026-09-01T01:00:00.000Z',
    deliveries: [],
    ...overrides,
  };
}

const mockApiCall = apiCall as jest.Mock;

function installApiMock() {
  mockApiCall.mockImplementation(async (endpoint: string, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(String(options.body)) : null;
    if (endpoint.startsWith('email-notifications?') && !options?.method) {
      return { success: true, data: rows, total: rows.length, page: 1, pageSize: 20 };
    }
    if (body?.action === 'preview') {
      return {
        success: true,
        notification: rows.find((row) => row.id === body.notificationId),
        preview: { subject: 'Payment received', html: '<p>Safe preview</p>', text: 'Safe preview', templateVersion: 1 },
        language: 'ENGLISH',
        intendedRecipients: [{ to: ['primary@example.com'], cc: ['copy@example.com'] }],
        actualRecipients: [{ to: ['test@example.com'], cc: [] }],
        testModeRedirected: true,
        missingRecipient: false,
      };
    }
    if (body?.action === 'approve') return { success: true, queuedCount: body.notificationIds.length };
    if (body?.action) return { success: true };
    if (endpoint.includes('action=attempts')) return { success: true, data: [] };
    throw new Error(`Unexpected API call: ${endpoint}`);
  });
}

describe('EmailManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installApiMock();
  });

  it('applies draft filters only when Search is clicked', async () => {
    render(<EmailManager />);
    await screen.findByTestId('email-row-pending');
    mockApiCall.mockClear();
    installApiMock();

    fireEvent.change(screen.getByLabelText('searchLabel'), { target: { value: 'PIKIN' } });
    expect(mockApiCall).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'search' }));
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith(
      expect.stringContaining('search=PIKIN'),
    ));
  });

  it('allows batch selection only for pending rows with recipients', async () => {
    render(<EmailManager />);
    await screen.findByTestId('email-row-pending');

    expect(screen.getByTestId('email-select-pending')).toBeEnabled();
    expect(screen.getByTestId('email-select-missing')).toBeDisabled();
    expect(screen.getByTestId('email-select-queued')).toBeDisabled();
  });

  it('shows only state-appropriate row actions', async () => {
    render(<EmailManager />);
    await screen.findByTestId('email-row-pending');

    expect(within(screen.getByTestId('email-row-pending')).getByTestId('email-preview-pending')).toBeInTheDocument();
    expect(within(screen.getByTestId('email-row-pending')).getByTestId('email-send-pending')).toBeInTheDocument();
    expect(within(screen.getByTestId('email-row-missing')).queryByTestId('email-send-missing')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('email-row-queued')).getByTestId('email-cancel-queued')).toBeInTheDocument();
    expect(within(screen.getByTestId('email-row-failed')).getByTestId('email-retry-failed')).toBeInTheDocument();
    expect(within(screen.getByTestId('email-row-uncertain')).getByTestId('email-retry-uncertain')).toBeInTheDocument();
    expect(within(screen.getByTestId('email-row-correction')).getByTestId('email-correction-correction')).toBeInTheDocument();
  });

  it('shows exact intended and test recipients before explicit approval', async () => {
    render(<EmailManager />);
    await screen.findByTestId('email-row-pending');

    fireEvent.click(screen.getByTestId('email-preview-pending'));
    const previewDialog = await screen.findByTestId('email-preview-dialog');
    expect(await within(previewDialog).findByText('primary@example.com')).toBeInTheDocument();
    expect(within(previewDialog).getByText('copy@example.com')).toBeInTheDocument();
    expect(within(previewDialog).getByText('test@example.com')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('email-preview-send'));
    const confirmation = await screen.findByTestId('email-send-confirmation');
    expect(within(confirmation).getByText(/primary@example\.com/)).toBeInTheDocument();
    expect(within(confirmation).getByText(/test@example\.com/)).toBeInTheDocument();
    expect(mockApiCall).not.toHaveBeenCalledWith('email-notifications', expect.objectContaining({
      body: expect.stringContaining('"action":"approve"'),
    }));

    fireEvent.click(within(confirmation).getByTestId('email-confirm-send'));
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith('email-notifications', expect.objectContaining({
      body: expect.stringContaining('"action":"approve"'),
    })));
  });
});
