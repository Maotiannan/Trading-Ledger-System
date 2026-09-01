'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { apiCall } from '@/components/workspace/shared';
import { EmailNotificationSettingsCard } from './email-notification-settings-card';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  getApiErrorMessage: jest.fn((error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)),
}));

const mockApiCall = apiCall as jest.Mock;

const settings = {
  outboundEnabled: false,
  recipientMode: 'PRIMARY_CC',
  senderName: 'MU LEDGER',
  senderAddress: '',
  replyToAddress: '',
  retryLimit: 3,
  retryIntervalsSeconds: [60, 300, 1800],
  testModeEnabled: true,
  testDestination: 'admin@example.com',
  logoUrl: 'https://muledger.dainty.vip/logo.svg',
};

const templates = [
  {
    id: 'payment-en-1',
    type: 'PAYMENT_RECEIVED',
    language: 'ENGLISH',
    version: 1,
    subjectTemplate: 'Payment received - {{receiptNo}}',
    bodyTemplate: 'Dear {{customerName}}\n{{mark}} {{orderNos}} {{receiptNo}} {{amount}} {{paymentDate}}',
    requiredVariables: ['customerName', 'mark', 'orderNos', 'receiptNo', 'amount', 'paymentDate'],
    isActive: true,
  },
  {
    id: 'payment-fr-1',
    type: 'PAYMENT_RECEIVED',
    language: 'FRENCH',
    version: 1,
    subjectTemplate: 'Paiement reçu - {{receiptNo}}',
    bodyTemplate: 'Bonjour {{customerName}}\n{{mark}} {{orderNos}} {{receiptNo}} {{amount}} {{paymentDate}}',
    requiredVariables: ['customerName', 'mark', 'orderNos', 'receiptNo', 'amount', 'paymentDate'],
    isActive: true,
  },
  {
    id: 'shipment-en-1',
    type: 'SHIPMENT',
    language: 'ENGLISH',
    version: 1,
    subjectTemplate: 'Shipment - {{invoiceNo}}',
    bodyTemplate: '{{customerName}} {{mark}} {{orderNos}} {{invoiceNo}} {{shipmentDate}}',
    requiredVariables: ['customerName', 'mark', 'orderNos', 'invoiceNo', 'shipmentDate'],
    isActive: true,
  },
  {
    id: 'shipment-fr-1',
    type: 'SHIPMENT',
    language: 'FRENCH',
    version: 1,
    subjectTemplate: 'Expédition - {{invoiceNo}}',
    bodyTemplate: '{{customerName}} {{mark}} {{orderNos}} {{invoiceNo}} {{shipmentDate}}',
    requiredVariables: ['customerName', 'mark', 'orderNos', 'invoiceNo', 'shipmentDate'],
    isActive: true,
  },
  {
    id: 'release-en-1',
    type: 'RELEASE',
    language: 'ENGLISH',
    version: 1,
    subjectTemplate: 'Release - {{invoiceNo}}',
    bodyTemplate: '{{customerName}} {{mark}} {{orderNos}} {{invoiceNo}} {{releaseDate}}',
    requiredVariables: ['customerName', 'mark', 'orderNos', 'invoiceNo', 'releaseDate'],
    isActive: true,
  },
  {
    id: 'release-fr-1',
    type: 'RELEASE',
    language: 'FRENCH',
    version: 1,
    subjectTemplate: 'Mainlevée - {{invoiceNo}}',
    bodyTemplate: '{{customerName}} {{mark}} {{orderNos}} {{invoiceNo}} {{releaseDate}}',
    requiredVariables: ['customerName', 'mark', 'orderNos', 'invoiceNo', 'releaseDate'],
    isActive: true,
  },
];

const loadResult = {
  success: true,
  settings,
  templates,
  variableCatalog: {
    PAYMENT_RECEIVED: ['customerName', 'mark', 'orderNos', 'receiptNo', 'amount', 'paymentDate'],
    SHIPMENT: ['customerName', 'mark', 'orderNos', 'invoiceNo', 'shipmentDate'],
    RELEASE: ['customerName', 'mark', 'orderNos', 'invoiceNo', 'releaseDate'],
  },
  apiKeyConfigured: true,
  webhookSecretConfigured: false,
};

describe('EmailNotificationSettingsCard', () => {
  const tx = (_zh: string, en: string) => en;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApiCall.mockResolvedValue(loadResult);
  });

  it('loads safe settings, six templates, and secret-presence flags', async () => {
    render(<EmailNotificationSettingsCard tx={tx} />);

    await waitFor(() => expect(screen.getByLabelText('Sender name')).toHaveValue('MU LEDGER'));
    expect(screen.getByLabelText('Outbound email enabled')).not.toBeChecked();
    expect(screen.getByLabelText('Test-delivery mode')).toBeChecked();
    expect(screen.getByLabelText('Recipient mode')).toHaveValue('PRIMARY_CC');
    expect(screen.getByText('Resend API key: Configured')).toBeInTheDocument();
    expect(screen.getByText('Webhook secret: Missing')).toBeInTheDocument();
    expect(screen.getByText('Version 1')).toBeInTheDocument();
    expect(mockApiCall).toHaveBeenCalledWith('email-settings');
  });

  it('saves parsed retry settings without ever sending provider secrets', async () => {
    mockApiCall.mockImplementation(async (endpoint: string, options?: RequestInit) => {
      if (!options) return loadResult;
      return { success: true, settings: { ...settings, senderAddress: 'notify@example.com' } };
    });
    render(<EmailNotificationSettingsCard tx={tx} />);
    await waitFor(() => expect(screen.getByLabelText('Sender name')).toHaveValue('MU LEDGER'));

    fireEvent.change(screen.getByLabelText('Sender address'), { target: { value: 'notify@example.com' } });
    fireEvent.change(screen.getByLabelText('Retry intervals (seconds)'), { target: { value: '60, 600, 3600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Email Settings' }));

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith('email-settings', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"action":"save-settings"'),
    })));
    const saveCall = mockApiCall.mock.calls.find((call) => call[1]?.method === 'POST');
    const payload = JSON.parse(String(saveCall[1].body));
    expect(payload.settings.retryIntervalsSeconds).toEqual([60, 600, 3600]);
    expect(JSON.stringify(payload)).not.toMatch(/RESEND_API_KEY|RESEND_WEBHOOK_SECRET/);
  });

  it('switches event and language templates, saves a new version, and previews backend HTML', async () => {
    mockApiCall.mockImplementation(async (_endpoint: string, options?: RequestInit) => {
      if (!options) return loadResult;
      const payload = JSON.parse(String(options.body || '{}')) as { action?: string; template?: Record<string, unknown> };
      if (payload.action === 'save-template') {
        return { success: true, template: { ...payload.template, id: 'shipment-fr-2', version: 2, isActive: true } };
      }
      return { success: true, preview: { subject: 'Preview subject', html: '<html><body>Safe preview</body></html>', text: 'Safe preview' } };
    });
    render(<EmailNotificationSettingsCard tx={tx} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Shipment' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Shipment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Francais' }));
    expect(screen.getByLabelText('Email subject template')).toHaveValue('Expédition - {{invoiceNo}}');
    fireEvent.change(screen.getByLabelText('Email subject template'), { target: { value: 'Départ - {{invoiceNo}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));

    await waitFor(() => expect(screen.getByText('Version 2')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Preview Template' }));
    await waitFor(() => expect(screen.getByTitle('Email preview')).toHaveAttribute('srcdoc', expect.stringContaining('Safe preview')));
    fireEvent.click(screen.getByRole('button', { name: 'Mobile preview' }));
    expect(screen.getByTestId('email-preview-frame-wrap')).toHaveClass('max-w-[390px]');
  });

  it('keeps backend validation errors visible', async () => {
    mockApiCall.mockImplementation(async (_endpoint: string, options?: RequestInit) => (
      options ? { success: false, error: 'Missing required email template variable: amount' } : loadResult
    ));
    render(<EmailNotificationSettingsCard tx={tx} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Template' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Missing required email template variable: amount'));
  });
});
