import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WhatsAppTemplateEditor } from './whatsapp-template-editor';
import { apiCall } from '@/components/workspace/shared';
import { defaultTemplateVersions } from '@/lib/whatsapp/whatsapp-template-definition';
const tx = (_: string, en: string) => en;
jest.mock('@/components/workspace/shared', () => ({ apiCall: jest.fn(), useUiText: () => tx }));
beforeEach(() => {
  jest.clearAllMocks();
  (apiCall as jest.Mock).mockImplementation(async (_path, options) => options ? { data: { status: 'DRAFT' } } : { data: { templates: defaultTemplateVersions() } });
});
it('previews synthetic data and saves without submitting', async () => {
  render(<WhatsAppTemplateEditor />);
  await screen.findByText('muledger_payment_v1 · en');
  expect(screen.getByText(/Preview uses fictional/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save as new draft' }));
  await waitFor(() => expect(apiCall).toHaveBeenCalledWith('whatsapp-templates', expect.objectContaining({ method: 'POST' })));
  const writes = (apiCall as jest.Mock).mock.calls.filter(call => call[1]?.method === 'POST');
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0][1].body).action).toBe('save');
});
it('blocks a body missing required financial variables', async () => {
  render(<WhatsAppTemplateEditor />);
  await screen.findByText('muledger_payment_v1 · en');
  fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'No amount or balance' } });
  expect(screen.getByRole('button', { name: 'Save as new draft' })).toBeDisabled();
});
