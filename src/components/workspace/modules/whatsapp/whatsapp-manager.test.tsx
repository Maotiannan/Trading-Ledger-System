import { render, screen, waitFor } from '@testing-library/react';
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
