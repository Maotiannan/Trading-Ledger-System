import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WhatsAppTemplateEditor } from './whatsapp-template-editor';
import { apiCall } from '@/components/workspace/shared';
import { defaultTemplateVersions } from '@/lib/whatsapp/whatsapp-template-definition';
let chinese = false;
const tx = (zh: string, en: string) => chinese ? zh : en;
jest.mock('@/components/workspace/shared', () => ({ apiCall: jest.fn(), useUiText: () => tx }));
beforeEach(() => {
  chinese = false;
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
it('uses readable Chinese variables and filters versions without translating message text', async () => {
  chinese = true;
  render(<WhatsAppTemplateEditor />);
  await screen.findByText('muledger_payment_v1 · en');
  expect(screen.getByRole('button', { name: /关联订单扣款后余额/ })).toBeInTheDocument();
  expect(screen.queryByText('muledger_shipment_v1 · en')).not.toBeInTheDocument();
  const englishBody = (screen.getByLabelText('正文') as HTMLTextAreaElement).value;
  expect(englishBody).not.toContain('客户');
  fireEvent.change(screen.getByLabelText('通知类型'), { target: { value: 'outstanding60' } });
  expect(screen.getByLabelText('语言')).toBeDisabled();
  expect(screen.getByLabelText('语言')).toHaveValue('fr');
  expect(screen.getByText('客户欠款对账图片')).toBeInTheDocument();
  expect(screen.queryByText('muledger_payment_v1 · en')).not.toBeInTheDocument();
});
it('loads the active saved template rather than an old built-in default', async () => {
  const custom = { ...defaultTemplateVersions()[0], name: 'custom-active', title: 'Active customer notice', active: true };
  (apiCall as jest.Mock).mockResolvedValue({ data: { templates: [custom] } });
  render(<WhatsAppTemplateEditor />);
  await screen.findByText('custom-active · en');
  expect(screen.getByLabelText('Title')).toHaveValue(custom.title);
});
it('inserts a named variable at the text cursor and explains missing fields', async () => {
  render(<WhatsAppTemplateEditor />);
  await screen.findByText('muledger_payment_v1 · en');
  const body = screen.getByLabelText('Body') as HTMLTextAreaElement;
  fireEvent.change(body, { target: { value: 'Hello !' } });
  body.setSelectionRange(6, 6);
  fireEvent.click(screen.getByRole('button', { name: /Customer name.*Example:/ }));
  expect(body.value).toBe('Hello {{1}}!');
  expect(screen.getByRole('alert')).toHaveTextContent('Order balance after payment');
  expect(screen.getByRole('button', { name: 'Save as new draft' })).toBeDisabled();
});
