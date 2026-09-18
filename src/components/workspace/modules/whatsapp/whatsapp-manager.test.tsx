import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WhatsAppManager } from './whatsapp-manager';
import { apiCall } from '@/components/workspace/shared';
jest.mock('./whatsapp-template-editor', () => ({ WhatsAppTemplateEditor: () => <div>Template editor</div> }));
let role = 'ADMIN';
jest.mock('@/lib/store', () => ({ useStore: (selector: (state: unknown) => unknown) => selector({ user: { role } }) }));
const tx = (_zh: string, en: string) => en;
jest.mock('@/components/workspace/shared', () => ({ useUiText: () => tx, apiCall: jest.fn() }));
beforeEach(() => { role = 'ADMIN'; jest.clearAllMocks(); (apiCall as jest.Mock).mockImplementation(async endpoint => endpoint.startsWith('whatsapp-notifications') ? { data: { items: [], total: 0 } } : { data: { settings: { outboundEnabled: false, testMode: true, testDestination: '+8613619767412' }, templates: [] } }); });
it('shows sending disabled and consent unchecked by default', async () => {
  render(<WhatsAppManager />);
  await waitFor(() => expect(screen.getByLabelText('Enable sending')).not.toBeChecked());
  expect(screen.getByLabelText('Customer explicitly agreed to WhatsApp notifications')).not.toBeChecked();
  expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
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
