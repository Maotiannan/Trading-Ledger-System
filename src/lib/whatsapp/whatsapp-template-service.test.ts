/** @jest-environment node */
jest.mock('@/lib/db', () => ({ db: { systemSetting: { findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() } } }));
jest.mock('./whatsapp-transaction', () => ({ runWhatsAppTransaction: jest.fn() }));
import { db } from '@/lib/db';
import { runWhatsAppTransaction } from './whatsapp-transaction';
import { saveWhatsAppDraft, submitWhatsAppTemplate, refreshWhatsAppTemplate, activateWhatsAppTemplate } from './whatsapp-template-service';
import { defaultTemplateVersions, templatePayload } from './whatsapp-template-definition';
import type { CurrentUser } from '@/lib/request-auth';
const actor = { id: 'admin', role: 'ADMIN' } as CurrentUser;
const version = { ...defaultTemplateVersions()[0], name: 'muledger_payment_test', status: 'DRAFT', active: false, createdAt: '2026-09-16' };
const originalFetch = global.fetch;
const originalEnv = { ...process.env };
const create = jest.fn(), updateMany = jest.fn(), audit = jest.fn();
beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = jest.fn();
  process.env.YCLOUD_API_KEY = 'test-only'; process.env.YCLOUD_WABA_ID = 'waba';
  (db.systemSetting.findUnique as jest.Mock).mockResolvedValue({ value: JSON.stringify(version) });
  updateMany.mockResolvedValue({ count: 1 });
  (runWhatsAppTransaction as jest.Mock).mockImplementation(async fn => fn({ systemSetting: { create, updateMany, findUnique: db.systemSetting.findUnique }, auditLog: { create: audit } }));
});
afterAll(() => { global.fetch = originalFetch; process.env = originalEnv; });
it('saves an immutable new draft and audit without provider requests', async () => {
  const draft = await saveWhatsAppDraft(actor, version);
  expect(draft.status).toBe('DRAFT');
  expect(draft.name).not.toBe(version.name);
  expect(create).toHaveBeenCalledTimes(1); expect(audit).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});
it('denies SALES before storage', async () => {
  await expect(saveWhatsAppDraft({ ...actor, role: 'SALES' }, version)).rejects.toMatchObject({ status: 403 });
  expect(create).not.toHaveBeenCalled();
});
it('submits once only after the database claim succeeds', async () => {
  (fetch as jest.Mock).mockResolvedValue(new Response('{}'));
  expect((await submitWhatsAppTemplate(actor, version.name, 'en')).status).toBe('PENDING');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toMatchObject({ category: 'UTILITY', wabaId: 'waba' });
  updateMany.mockResolvedValue({ count: 0 });
  await expect(submitWhatsAppTemplate(actor, version.name, 'en')).rejects.toMatchObject({ status: 409 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('does not repeat POST after a timeout or after submission', async () => {
  (fetch as jest.Mock).mockRejectedValue(new Error('timeout'));
  expect((await submitWhatsAppTemplate(actor, version.name, 'en')).status).toBe('SUBMISSION_UNCERTAIN');
  (db.systemSetting.findUnique as jest.Mock).mockResolvedValue({ value: JSON.stringify({ ...version, status: 'SUBMISSION_UNCERTAIN' }) });
  await expect(submitWhatsAppTemplate(actor, version.name, 'en')).rejects.toMatchObject({ status: 409 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('refreshes status using GET and prevents activation when content differs', async () => {
  (db.systemSetting.findUnique as jest.Mock).mockResolvedValue({ value: JSON.stringify({ ...version, status: 'PENDING' }) });
  (fetch as jest.Mock).mockImplementation(async () => new Response(JSON.stringify({ items: [{ ...templatePayload(version), status: 'APPROVED', components: [{ type: 'BODY', text: 'changed' }] }] })));
  expect((await refreshWhatsAppTemplate(actor, version.name, 'en')).status).toBe('CONTENT_MISMATCH');
  await expect(activateWhatsAppTemplate(actor, version.name, 'en')).rejects.toMatchObject({ status: 409 });
  expect((fetch as jest.Mock).mock.calls.every(call => call[1].method === 'GET')).toBe(true);
});
it('only activates an approved Utility version under a per-slot lock, preserving historical bodies', async () => {
  const pending = { ...version, status: 'PENDING' };
  const old = defaultTemplateVersions()[0];
  (db.systemSetting.findUnique as jest.Mock).mockResolvedValue({ value: JSON.stringify(pending) });
  (fetch as jest.Mock).mockImplementation(async () => new Response(JSON.stringify({ items: [{ ...templatePayload(pending), status: 'APPROVED' }] })));
  const upsert = jest.fn(), update = jest.fn();
  (runWhatsAppTransaction as jest.Mock).mockImplementation(async fn => fn({
    systemSetting: {
      findUnique: db.systemSetting.findUnique, updateMany, upsert, update,
      findMany: jest.fn(async () => [{ id: 'old', value: JSON.stringify(old) }, { id: 'new', value: JSON.stringify({ ...pending, status: 'APPROVED' }) }]),
    },
    auditLog: { create: audit },
  }));
  expect((await activateWhatsAppTemplate(actor, version.name, 'en')).active).toBe(true);
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'whatsapp.template-lock.payment.en' } }));
  const savedOld = JSON.parse(update.mock.calls[0][0].data.value);
  expect(savedOld.body).toBe(old.body);
  expect(savedOld.active).toBe(false);
  expect(JSON.parse(update.mock.calls[1][0].data.value).active).toBe(true);
});
