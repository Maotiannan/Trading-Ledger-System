/** @jest-environment node */
jest.mock('@/lib/request-auth', () => ({ getCurrentUser: jest.fn() }));
jest.mock('@/lib/whatsapp/whatsapp-template-service', () => ({
  listWhatsAppTemplateVersions: jest.fn(async () => []), saveWhatsAppDraft: jest.fn(async () => ({ status: 'DRAFT' })),
  submitWhatsAppTemplate: jest.fn(), refreshWhatsAppTemplate: jest.fn(), activateWhatsAppTemplate: jest.fn(),
}));
import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/request-auth';
import { GET, POST } from './route';
import { listWhatsAppTemplateVersions, saveWhatsAppDraft, submitWhatsAppTemplate } from '@/lib/whatsapp/whatsapp-template-service';
beforeEach(() => { jest.clearAllMocks(); (getCurrentUser as jest.Mock).mockResolvedValue({ role: 'ADMIN', id: 'admin' }); });
it.each(['USER', 'SALES'])('blocks %s reads and writes', async role => {
  (getCurrentUser as jest.Mock).mockResolvedValue({ role });
  expect((await GET(new NextRequest('http://localhost/api/whatsapp-templates'))).status).toBe(403);
  expect((await POST(new NextRequest('http://localhost/api/whatsapp-templates', { method: 'POST' }))).status).toBe(403);
  expect(listWhatsAppTemplateVersions).not.toHaveBeenCalled();
});
it('saving a draft never submits it', async () => {
  const response = await POST(new NextRequest('http://localhost/api/whatsapp-templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'save', draft: {} }) }));
  expect(response.status).toBe(200); expect(saveWhatsAppDraft).toHaveBeenCalledTimes(1); expect(submitWhatsAppTemplate).not.toHaveBeenCalled();
});
it('rejects arbitrary template names and actions', async () => {
  expect((await POST(new NextRequest('http://localhost/api/whatsapp-templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'submit', name: '../other', language: 'en' }) }))).status).toBe(400);
  expect(submitWhatsAppTemplate).not.toHaveBeenCalled();
});
