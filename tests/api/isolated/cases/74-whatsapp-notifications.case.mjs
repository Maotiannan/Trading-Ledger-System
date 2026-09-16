import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
export const name = 'whatsapp-notifications';
export default async function run(t) {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/trading_ledger_test');
  const db = new PrismaClient();
  try {
    await t.initAdmin(); await t.loginAdmin();
    const templates = await t.request('GET', '/api/whatsapp-templates', { expectedStatus: 200 });
    assert.equal(templates.data.data.templates.length, 6);
    const original = templates.data.data.templates.find(row => row.kind === 'payment' && row.language === 'en');
    const saved = await t.request('POST', '/api/whatsapp-templates', { json: { action: 'save', draft: { ...original, body: original.body + '\nThank you.' } }, expectedStatus: 200 });
    assert.equal(saved.data.data.status, 'DRAFT');
    const afterSave = await t.request('GET', '/api/whatsapp-templates', { expectedStatus: 200 });
    assert.equal(afterSave.data.data.templates.find(row => row.name === original.name && row.language === 'en').body, original.body);
    assert.equal(afterSave.data.data.templates.find(row => row.name === saved.data.data.name).active, false);
    await t.request('POST', '/api/whatsapp-templates', { json: { action: 'save', draft: { ...original, body: 'Missing variables' } }, expectedStatus: 400 });
    const suffix = t.unique('wa');
    const salesEmail = suffix + '@example.com';
    const sales = await t.createUser({ email: salesEmail, password: 'SalesA@2026!', role: 'SALES', name: 'WA Sales' });
    const salesId = sales.data.data.id;
    const customer = await t.request('POST', '/api/customer', { json: { action: 'create', mark: suffix, orderName: suffix.toUpperCase(), name: 'WhatsApp fixture', city: 'Conakry', phone: '+224620123456', ownerId: salesId }, expectedStatus: 200 });
    const customerId = customer.data.data.id;
    await t.request('POST', '/api/whatsapp-contacts', { json: { customerId, phone: '+224620123456', optIn: true, consentSource: 'Isolated test consent' }, expectedStatus: 200 });
    const contact = await db.customerWhatsAppContact.findUniqueOrThrow({ where: { customerId_phone: { customerId, phone: '+224620123456' } } });
    const create = () => db.whatsAppDelivery.upsert({ where: { eventKey: suffix }, update: {}, create: {
      eventKey: suffix, type: 'PAYMENT_RECEIVED', sourceId: 'isolated-source', contactId: contact.id, testMode: true,
      intendedTo: contact.phone, actualTo: '+8613619767412', senderPhone: '+8613819858718', templateName: 'muledger_payment_v1',
      languageCode: 'en', parameters: ['fixture'], businessSnapshot: { amount: 100 }, status: 'PENDING',
    } });
    const seed = () => create().catch(error => { if(error.code !== 'P2002') throw error; return db.whatsAppDelivery.findUniqueOrThrow({where:{eventKey:suffix}}); });
    const results = await Promise.all([seed(), seed()]);
    assert.equal(results[0].id, results[1].id);
    const id = results[0].id;
    const approvals = await Promise.all([1, 2].map(() => t.request('POST', '/api/whatsapp-notifications', { json: { action: 'approve', ids: [id] }, expectedStatus: 200 })));
    assert.equal(approvals.reduce((sum, r) => sum + r.data.data.approved, 0), 1);
    const delivery = await db.whatsAppDelivery.findUniqueOrThrow({ where: { id } });
    assert.equal(delivery.status, 'QUEUED'); assert.ok(delivery.approvedAt);
    await t.request('POST', '/api/whatsapp-settings', { json: { outboundEnabled: false, testMode: false, testDestination: '+8613619767412' }, expectedStatus: 200 });
    assert.equal((await db.whatsAppDelivery.findUniqueOrThrow({ where: { id } })).testMode, true);
    await t.request('POST', '/api/whatsapp-contacts', { json: { customerId, phone: contact.phone, optIn: false, consentSource: 'Isolated opt out' }, expectedStatus: 200 });
    assert.equal((await db.whatsAppDelivery.findUniqueOrThrow({ where: { id } })).status, 'CANCELLED');
    await t.login(salesEmail, 'SalesA@2026!');
    await t.request('GET', '/api/whatsapp-notifications', { expectedStatus: 403 });
    await t.request('GET', '/api/whatsapp-settings', { expectedStatus: 403 });
    await t.request('GET', '/api/whatsapp-templates', { expectedStatus: 403 });
    await t.request('POST', '/api/whatsapp-templates', { json: { action: 'save', draft: original }, expectedStatus: 403 });
    await t.request('GET', '/api/whatsapp-contacts', { expectedStatus: 200 });
    await t.loginAdmin();
    await t.request('POST', '/api/whatsapp-settings', { json: { outboundEnabled: false, testMode: true, testDestination: '+8613619767412' }, expectedStatus: 200 });
    t.step('WhatsApp uniqueness, concurrent approval, immutable test mode, opt-out and ADMIN permissions verified in isolated database');
  } finally { await db.$disconnect(); }
}
