import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WhatsAppManager } from './whatsapp-manager';
import { apiCall } from '@/components/workspace/shared';
jest.mock('./whatsapp-template-editor', () => ({ WhatsAppTemplateEditor: () => <div>Template editor</div> }));
let role = 'ADMIN';
jest.mock('@/lib/store', () => ({ useStore: (selector: (state: unknown) => unknown) => selector({ user: { role } }) }));
let chinese = false;
const tx = (zh: string, en: string) => chinese ? zh : en;
jest.mock('@/components/workspace/shared', () => ({ useUiText: () => tx, apiCall: jest.fn() }));
beforeEach(() => { chinese = false; role = 'ADMIN'; jest.clearAllMocks(); (apiCall as jest.Mock).mockImplementation(async endpoint => endpoint.startsWith('whatsapp-notifications') ? { data: { items: [], total: 0 } } : { data: { settings: { outboundEnabled: false, testMode: true, testDestination: '+8613619767412' }, templates: [] } }); });
it('shows sending disabled and consent unchecked by default', async () => {
  render(<WhatsAppManager />);
  await waitFor(() => expect(screen.getByLabelText('Enable sending')).not.toBeChecked());
  expect(screen.getByLabelText('Customer explicitly agreed to WhatsApp notifications')).not.toBeChecked();
  expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
});
it('explains that pending retries require approval', async () => {
  (apiCall as jest.Mock).mockImplementation(async endpoint => endpoint.startsWith('whatsapp-notifications') ? { data: { items: [{
    id: 'failed-retry', type: 'PAYMENT_RECEIVED', status: 'PENDING', actualTo: '+224622491286', testMode: true,
    createdAt: '2026-10-09T01:00:00Z', updatedAt: '2026-10-09T01:00:00Z', nextSendAt: '2026-10-09T01:05:00Z',
    businessSnapshot: {}, parameters: [], templateName: 'payment', languageCode: 'en', failureCode: null,
    canRetry: false, retryId: null, retryOf: null, requiresApproval: true,
  }], total: 1 } } : { data: { settings: { outboundEnabled: false, testMode: true, testDestination: '+8613619767412' }, templates: [] } });
  render(<WhatsAppManager />);
  await waitFor(() => expect(screen.getAllByText('Awaiting approval')).toHaveLength(2));
});
it('never fetches or renders management data for SALES', () => {
  role = 'SALES';
  const { container } = render(<WhatsAppManager />);
  expect(container).toBeEmptyDOMElement();
  expect(apiCall).not.toHaveBeenCalled();
});

async function selectSubscribedCustomer() {
  const original = (apiCall as jest.Mock).getMockImplementation()!;
  (apiCall as jest.Mock).mockImplementation(async (endpoint, options) => {
    if (endpoint.startsWith('whatsapp-contacts?')) return { data: [{ id: 'customer-1', name: 'Customer', mark: 'MARK', orderName: 'ORDER', phone: '+224622491286', whatsappContacts: [{ id: 'contact-1', optedInAt: '2026-09-01', optedOutAt: null }] }] };
    if (endpoint === 'whatsapp-contacts') return { data: { id: 'contact-1', optedInAt: '2026-09-01', optedOutAt: '2026-09-18' } };
    return original(endpoint, options);
  });
  render(<WhatsAppManager />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByRole('option', { name: 'MARK / ORDER / Customer' });
  fireEvent.change(screen.getByLabelText('Select customer'), { target: { value: 'customer-1' } });
}

it('loads current consent and unsubscribes with confirmation, updating the visible status', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  await selectSubscribedCustomer();
  expect(screen.getByLabelText('Customer explicitly agreed to WhatsApp notifications')).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
  await waitFor(() => expect(apiCall).toHaveBeenCalledWith('whatsapp-contacts', {
    method: 'POST', body: JSON.stringify({ customerId: 'customer-1', optIn: false, consentSource: 'Administrator unsubscribed customer in notification management' }),
  }));
  await waitFor(() => expect(screen.getByLabelText('Customer explicitly agreed to WhatsApp notifications')).not.toBeChecked());
  expect(screen.queryByRole('button', { name: 'Unsubscribe' })).not.toBeInTheDocument();
  confirm.mockRestore();
});

it('does not unsubscribe if confirmation is cancelled', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  await selectSubscribedCustomer();
  fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
  expect((apiCall as jest.Mock).mock.calls.some(([endpoint]) => endpoint === 'whatsapp-contacts')).toBe(false);
  expect(screen.getByLabelText('Customer explicitly agreed to WhatsApp notifications')).toBeChecked();
  confirm.mockRestore();
});

it('keeps the subscription visible when saving fails', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  await selectSubscribedCustomer();
  (apiCall as jest.Mock).mockRejectedValueOnce(new Error('Network unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save subscription status. Please retry.');
  expect(screen.getByLabelText('Customer explicitly agreed to WhatsApp notifications')).toBeChecked();
  expect(screen.getByRole('button', { name: 'Unsubscribe' })).toBeEnabled();
  confirm.mockRestore();
});

it.each(['success', 'blocked'])('reports the actual result of a single retry: %s', async outcome => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  const original = (apiCall as jest.Mock).getMockImplementation()!;
  const failed = { id: 'failed-1', type: 'PAYMENT_RECEIVED', status: 'FAILED', actualTo: '+224620123456',
    testMode: false, createdAt: '2026-10-09T01:00:00Z', updatedAt: '2026-10-09T01:00:00.000Z',
    businessSnapshot: {}, parameters: [], templateName: 'payment', languageCode: 'en', failureCode: 'PROVIDER_REJECTED', canRetry: true };
  (apiCall as jest.Mock).mockImplementation(async (endpoint, options) => {
    if (options?.method === 'POST') {
      if (outcome === 'blocked') throw { detail: { reason: 'OUTBOUND_DISABLED' } };
      return { data: { retryId: 'child', status: 'QUEUED', nextSendAt: '2026-10-09T01:05:00Z' } };
    }
    if (endpoint.startsWith('whatsapp-notifications')) return { data: { items: [failed], total: 1 } };
    return original(endpoint, options);
  });
  render(<WhatsAppManager />);
  fireEvent.click(await screen.findByRole('button', { name: 'Safe retry' }));
  await waitFor(() => expect(apiCall).toHaveBeenCalledWith('whatsapp-notifications', { method: 'POST', body: JSON.stringify({
    action: 'retry', ids: ['failed-1'], expectedUpdatedAt: failed.updatedAt,
  }) }));
  if (outcome === 'success') expect(await screen.findByText('Retry created. Scheduled: 09/10/2026, 01:05')).toBeInTheDocument();
  else expect(await screen.findByRole('alert')).toHaveTextContent('Sending is disabled. Enable sending first.');
  confirm.mockRestore();
});

it('localizes notification rows and failure explanations in Chinese', async () => {
  chinese = true;
  const original = (apiCall as jest.Mock).getMockImplementation()!;
  (apiCall as jest.Mock).mockImplementation(async (endpoint, options) => endpoint.startsWith('whatsapp-notifications') ? { data: { total: 1, items: [{
    id: 'failed', type: 'OUTSTANDING_REMINDER', status: 'FAILED', actualTo: '+10000000001', testMode: true,
    createdAt: '2026-10-09T01:00:00Z', parameters: [], businessSnapshot: {}, failureCode: '131026',
  }] } } : original(endpoint, options));
  render(<WhatsAppManager />);
  expect(await screen.findByText('发送失败')).toBeInTheDocument();
  expect(screen.getByText('欠款提醒')).toBeInTheDocument();
  expect(screen.getByText('测试')).toBeInTheDocument();
  expect(screen.getByText(/平台未能送达/)).toBeInTheDocument();
  expect(screen.queryByText('OUTSTANDING_REMINDER')).not.toBeInTheDocument();
});
