import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { createApiError } from '@/lib/api-error';
import type { CurrentUser } from '@/lib/request-auth';
import { runWhatsAppTransaction } from './whatsapp-transaction';
import { draftSchema, defaultTemplateVersions, selectTemplateVersions, templateKey, templatePrefix, templatePayload, type TemplateVersion } from './whatsapp-template-definition';

function assertAdmin(actor: CurrentUser) {
  if (actor.role !== 'ADMIN') throw createApiError({ code: 'FORBIDDEN', status: 403, message: '' });
}
function conflict() { return createApiError({ code: 'CONFLICT', status: 409, message: '' }); }
async function providerRequest(query: string, payload?: unknown) {
  const apiKey = process.env.YCLOUD_API_KEY?.trim();
  const wabaId = process.env.YCLOUD_WABA_ID?.trim();
  if (!apiKey || !wabaId) throw createApiError({ code: 'BAD_REQUEST', status: 400, message: 'YCloud is not configured.' });
  const response = await fetch('https://api.ycloud.com/v2/whatsapp/templates' + query, {
    method: payload ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), cache: 'no-store',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    ...(payload ? { body: JSON.stringify({ ...payload as object, wabaId }) } : {}),
  });
  if (!response.ok) throw new Error('YCloud template request was not confirmed.');
  return response.json();
}
export async function listWhatsAppTemplateVersions(): Promise<TemplateVersion[]> {
  const rows = await db.systemSetting.findMany({ where: { key: { startsWith: templatePrefix } } });
  return selectTemplateVersions(rows.map(row => JSON.parse(row.value) as TemplateVersion));
}
async function getVersion(name: string, language: string) {
  const stored = await db.systemSetting.findUnique({ where: { key: templateKey(name, language) } });
  const version = stored ? JSON.parse(stored.value) as TemplateVersion
    : defaultTemplateVersions().find(item => item.name === name && item.language === language);
  if (!version) throw createApiError({ code: 'RESOURCE_NOT_FOUND', status: 404, message: '' });
  return version;
}
async function audit(tx: Parameters<Parameters<typeof runWhatsAppTransaction>[0]>[0], actor: CurrentUser, action: string, version: TemplateVersion) {
  await tx.auditLog.create({ data: { actorId: actor.id, action, targetType: 'WHATSAPP_TEMPLATE',
    targetId: templateKey(version.name, version.language), metadata: { name: version.name, language: version.language, status: version.status } } });
}
export async function saveWhatsAppDraft(actor: CurrentUser, input: unknown) {
  assertAdmin(actor);
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) throw createApiError({ code: 'BAD_REQUEST', status: 400, message: '' });
  const version: TemplateVersion = { ...parsed.data, name: 'muledger_' + parsed.data.kind + '_' + randomBytes(8).toString('hex'),
    status: 'DRAFT', category: 'UTILITY', active: false, createdAt: new Date().toISOString() };
  await runWhatsAppTransaction(async tx => {
    await tx.systemSetting.create({ data: { key: templateKey(version.name, version.language), value: JSON.stringify(version), updatedBy: actor.id } });
    await audit(tx, actor, 'WHATSAPP_TEMPLATE_DRAFT_CREATED', version);
  });
  return version;
}
export async function submitWhatsAppTemplate(actor: CurrentUser, name: string, language: string) {
  assertAdmin(actor);
  const version = await getVersion(name, language);
  if (version.status !== 'DRAFT') throw conflict();
  if (!process.env.YCLOUD_API_KEY || !process.env.YCLOUD_WABA_ID) throw createApiError({ code: 'BAD_REQUEST', status: 400, message: 'YCloud is not configured.' });
  const submitting = { ...version, status: 'SUBMITTING' };
  await runWhatsAppTransaction(async tx => {
    const changed = await tx.systemSetting.updateMany({
      where: { key: templateKey(name, language), value: JSON.stringify(version) },
      data: { value: JSON.stringify(submitting), updatedBy: actor.id },
    });
    if (changed.count !== 1) throw conflict();
    await audit(tx, actor, 'WHATSAPP_TEMPLATE_SUBMITTED', submitting);
  });
  // A timeout may mean creation succeeded. Never automatically POST a second time.
  try { await providerRequest('', templatePayload(version)); }
  catch {
    const uncertain = { ...submitting, status: 'SUBMISSION_UNCERTAIN' };
    await db.systemSetting.updateMany({ where: { key: templateKey(name, language), value: JSON.stringify(submitting) }, data: { value: JSON.stringify(uncertain) } });
    return uncertain;
  }
  const pending = { ...submitting, status: 'PENDING' };
  await db.systemSetting.updateMany({ where: { key: templateKey(name, language), value: JSON.stringify(submitting) }, data: { value: JSON.stringify(pending) } });
  return pending;
}
export async function refreshWhatsAppTemplate(actor: CurrentUser, name: string, language: string) {
  assertAdmin(actor);
  const version = await getVersion(name, language);
  if (version.status === 'DRAFT') return version;
  const query = new URLSearchParams({ 'filter.wabaId': process.env.YCLOUD_WABA_ID || '', 'filter.name': name, 'filter.language': language, limit: '100' });
  const result = await providerRequest('?' + query);
  const remote = Array.isArray(result.items) ? result.items.find((item: { name: string; language: string }) => item.name === name && item.language === language) : null;
  const body = remote?.components?.find((item: { type: string }) => item.type === 'BODY')?.text;
  const header = remote?.components?.find((item: { type: string }) => item.type === 'HEADER')?.text;
  const footer = remote?.components?.find((item: { type: string }) => item.type === 'FOOTER')?.text || '';
  const status = remote ? (body === version.body && header === version.title && footer === version.footer ? String(remote.status) : 'CONTENT_MISMATCH') : 'NOT_FOUND';
  const refreshed = { ...version, status, category: remote ? String(remote.category) : version.category };
  await runWhatsAppTransaction(async tx => {
    const key = templateKey(name, language);
    const existing = await tx.systemSetting.findUnique({ where: { key } });
    if (existing) {
      const current = JSON.parse(existing.value) as TemplateVersion;
      if (current.body !== version.body) throw conflict();
      await tx.systemSetting.updateMany({ where: { key, value: existing.value }, data: { value: JSON.stringify({ ...refreshed, active: current.active }), updatedBy: actor.id } });
    } else {
      await tx.systemSetting.create({ data: { key, value: JSON.stringify(refreshed), updatedBy: actor.id } });
    }
  });
  return refreshed;
}
export async function activateWhatsAppTemplate(actor: CurrentUser, name: string, language: string) {
  assertAdmin(actor);
  const verified = await refreshWhatsAppTemplate(actor, name, language);
  if (verified.status !== 'APPROVED' || verified.category !== 'UTILITY') throw conflict();
  await runWhatsAppTransaction(async tx => {
    // Lock one existing row per slot to serialize concurrent version activations.
    const lockKey = 'whatsapp.template-lock.' + verified.kind + '.' + language;
    await tx.systemSetting.upsert({ where: { key: lockKey }, create: { key: lockKey, value: name }, update: { value: name } });
    const rows = await tx.systemSetting.findMany({ where: { key: { startsWith: templatePrefix } } });
    for (const row of rows) {
      const item = JSON.parse(row.value) as TemplateVersion;
      if (item.kind === verified.kind && item.language === language) {
        await tx.systemSetting.update({ where: { id: row.id }, data: { value: JSON.stringify({ ...item, active: item.name === name }), updatedBy: actor.id } });
      }
    }
    await audit(tx, actor, 'WHATSAPP_TEMPLATE_ACTIVATED', verified);
  });
  return { ...verified, active: true };
}
