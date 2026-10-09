import { verifyReminderRestore } from '../helpers/verify-reminder-restore.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
    assert.equal(templates.data.data.templates.filter(row => !row.kind.startsWith('outstanding')).length, 8);
    assert.equal(templates.data.data.templates.filter(row => row.kind.startsWith('outstanding')).length, 4);
    const reminderDefaults = await t.request('GET', '/api/whatsapp-settings', { expectedStatus: 200 });
    assert.equal(reminderDefaults.data.data.settings.reminderEnabled, false);
    assert.equal(reminderDefaults.data.data.settings.reminderTestMode, true);
    await t.request('POST', '/api/whatsapp-settings', { json: { reminderEnabled: true, reminderTestMode: false }, expectedStatus: 400 });
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
    await t.request('POST', '/api/whatsapp-contacts', { json: { customerId, phone: '+10000000001', optIn: true, consentSource: 'PHONE remains authoritative' }, expectedStatus: 200 });
    assert.equal(await db.customerWhatsAppContact.count({where:{customerId,phone:'+10000000001'}}),0);
    const contact = await db.customerWhatsAppContact.findUniqueOrThrow({ where: { customerId_phone: { customerId, phone: '+224620123456' } } });
    const admin = await db.user.findUniqueOrThrow({where:{email:t.adminEmail}});
    const invoice = await db.invoice.create({data:{invNo:suffix, createdBy:admin.id}});
    const order = await db.order.create({data:{invoiceId:invoice.id, orderNo:suffix+'-1', amount:10000, customerId}});
    const a = await db.receipt.create({data:{receiptNo:suffix+'-A', usd:2000, status:'SR_Received', createdBy:admin.id, customerId, orderId:order.id, orderNo:order.orderNo, createdAt:new Date(Date.now()-2000)}});
    const b = await db.receipt.create({data:{receiptNo:suffix+'-B', usd:3000, status:'SR_Received', createdBy:admin.id, customerId, orderId:order.id, orderNo:order.orderNo}});
    const source = await db.emailNotification.create({data:{eventKey:suffix, type:'PAYMENT_RECEIVED', customerId, receiptId:b.id, currentSnapshot:{}}});
    const create = () => db.whatsAppDelivery.upsert({ where: { eventKey: suffix }, update: {}, create: {
      eventKey: suffix, type: 'PAYMENT_RECEIVED', sourceId: source.id, contactId: contact.id, testMode: true,
      intendedTo: contact.phone, actualTo: '+8613619767412', senderPhone: '+8613819858718', templateName: 'muledger_payment_v1',
      languageCode: 'en', parameters: ['fixture'], businessSnapshot: { amount: 100 }, status: 'PENDING', requiresApproval:true, nextSendAt:new Date(),
    } });
    const seed = () => create().catch(error => { if(error.code !== 'P2002') throw error; return db.whatsAppDelivery.findUniqueOrThrow({where:{eventKey:suffix}}); });
    const results = await Promise.all([seed(), seed()]);
    assert.equal(results[0].id, results[1].id);
    const id = results[0].id;
    const refresh = () => t.request('GET','/api/whatsapp-notifications',{expectedStatus:200});
    await refresh();
    let current = await db.whatsAppDelivery.findUniqueOrThrow({where:{id}});
    assert.equal(current.businessSnapshot.orderBalance, 5000);
    assert.ok(current.nextSendAt.getTime() > Date.now()+290000);
    const approvals = await Promise.all([1, 2].map(() => t.request('POST', '/api/whatsapp-notifications', { json: { action: 'approve', ids: [id], expectedUpdatedAt:current.updatedAt.toISOString() } })));
    assert.deepEqual(approvals.map(r=>r.status).sort(),[200,409]);
    const delivery = await db.whatsAppDelivery.findUniqueOrThrow({ where: { id } });
    assert.equal(delivery.status, 'QUEUED'); assert.ok(delivery.approvedAt);
    const request = await t.request('POST','/api/deletion',{json:{action:'request',targetType:'RECEIPT',targetId:b.id},expectedStatus:200});
    assert.equal((await db.whatsAppDelivery.findUniqueOrThrow({where:{id}})).status,'PAUSED');
    await t.request('POST','/api/deletion',{json:{action:'reject',requestId:request.data.data.id},expectedStatus:200});
    await refresh();
    current = await db.whatsAppDelivery.findUniqueOrThrow({where:{id}});
    assert.equal(current.status,'PENDING'); assert.equal(current.approvedAt,null);
    const deleteA = await t.request('POST','/api/deletion',{json:{action:'request',targetType:'RECEIPT',targetId:a.id},expectedStatus:200});
    await refresh();
    assert.equal((await db.whatsAppDelivery.findUniqueOrThrow({where:{id}})).status,'PAUSED');
    await t.request('POST','/api/deletion',{json:{action:'approve',requestId:deleteA.data.data.id},expectedStatus:200});
    await refresh();
    current = await db.whatsAppDelivery.findUniqueOrThrow({where:{id}});
    assert.equal(current.businessSnapshot.orderBalance,7000);
    assert.ok(current.nextSendAt.getTime()>Date.now()+290000);
    await t.request('POST','/api/whatsapp-notifications',{json:{action:'cancel',ids:[id]},expectedStatus:200});
    await db.receipt.update({where:{id:b.id},data:{usd:4000}});
    await refresh();
    assert.equal((await db.whatsAppDelivery.findUniqueOrThrow({where:{id}})).failureCode,'ADMIN_CANCELLED');
    await db.customer.update({where:{id:customerId},data:{phone:'+224622491286'}});
    const listed = await t.request('GET','/api/whatsapp-contacts?search='+encodeURIComponent(suffix),{expectedStatus:200});
    assert.equal(listed.data.data.find(row=>row.id===customerId).phone,'+224622491286');
    assert.equal((await db.customerWhatsAppContact.findUniqueOrThrow({where:{id:contact.id}})).optedInAt.getTime(), contact.optedInAt.getTime());
    await t.request('POST', '/api/whatsapp-settings', { json: { outboundEnabled: false, testMode: false, testDestination: '+8613619767412' }, expectedStatus: 200 });
    assert.equal((await db.whatsAppDelivery.findUniqueOrThrow({ where: { id } })).testMode, true);
    // Reminder snapshots are refreshed through the real ADMIN API, on isolated data only.
    await t.request('POST', '/api/whatsapp-settings', { json: { outboundEnabled: true, reminderEnabled: true, reminderTestMode: true }, expectedStatus: 200 });
    await db.invoice.update({ where: { id: invoice.id }, data: { releaseDate: new Date(Date.now() - 80 * 86400000) } });
    const reminderTemplate = { ...templates.data.data.templates.find(row => row.kind === 'outstanding60'), name: 'muledger_outstanding60_isolated', active: true, status: 'APPROVED', createdAt: new Date().toISOString() };
    await db.systemSetting.create({ data: { key: 'whatsapp.template.' + reminderTemplate.name + '.fr', value: JSON.stringify(reminderTemplate) } });
    // Two real scheduler processes share only the disposable test database.
    await Promise.all([1, 2].map(() => promisify(execFile)(process.execPath, ['tests/api/isolated/helpers/project-outstanding-reminders.cjs'], { env: process.env })));
    const reminders = await db.whatsAppDelivery.findMany({ where: { type: 'OUTSTANDING_REMINDER', contact: { customerId } } });
    assert.equal(reminders.length, 1);
    const reminder = reminders[0];
    assert.ok(reminder.nextSendAt.getTime() > Date.now() + 280000);
    await refresh();
    let reminderRow = await db.whatsAppDelivery.findUniqueOrThrow({ where: { id: reminder.id } });
    assert.equal(reminderRow.businessSnapshot.outstanding.totalOutstanding, 6000);
    assert.equal(reminderRow.parameters[1], '6,000');
    assert.equal(reminderRow.languageCode, 'fr');
    assert.equal(reminderRow.actualTo, '+8613619767412');
    assert.equal(reminderRow.status, 'PENDING');
    await t.request('POST', '/api/whatsapp-notifications', { json: { action: 'approve', ids: [reminder.id], expectedUpdatedAt: reminderRow.updatedAt.toISOString() }, expectedStatus: 200 });
    await db.receipt.update({ where: { id: b.id }, data: { usd: 5000 } });
    await refresh();
    reminderRow = await db.whatsAppDelivery.findUniqueOrThrow({ where: { id: reminder.id } });
    assert.equal(reminderRow.status, 'PENDING');
    assert.equal(reminderRow.approvedAt, null);
    assert.equal(reminderRow.parameters[1], '5,000');
    // Explicit FAILED retry: the failed row stays immutable while the child
    // re-reads the current phone, receipt source and five-minute buffer.
    const whatsappSetting = await db.systemSetting.findUniqueOrThrow({ where: { key: 'whatsapp.notifications' } });
    await db.systemSetting.upsert({ where: { key: 'whatsapp.template.' + original.name + '.en' },
      create: { key: 'whatsapp.template.' + original.name + '.en', value: JSON.stringify({ ...original, active: true, status: 'APPROVED' }) },
      update: { value: JSON.stringify({ ...original, active: true, status: 'APPROVED' }) } });
    await db.systemSetting.update({ where: { key: whatsappSetting.key }, data: { value: JSON.stringify({ ...JSON.parse(whatsappSetting.value), testMode: false }) } });
    await db.customer.update({ where: { id: customerId }, data: { phone: '+224622491286' } });
    const retryParent = await db.whatsAppDelivery.create({ data: {
      eventKey: suffix + ':retry-parent', type: 'PAYMENT_RECEIVED', sourceId: source.id,
      contactId: contact.id, testMode: false, intendedTo: '+224620123456', actualTo: '+224620123456',
      senderPhone: '+8613819858718', templateName: original.name, languageCode: 'en',
      parameters: ['stale'], businessSnapshot: { customerId, amount: 1, stale: true },
      status: 'FAILED', failureCode: 'PROVIDER_REJECTED',
      nextSendAt: new Date(Date.now() - 1000),
    } });
    const retryList = await t.request('GET', '/api/whatsapp-notifications', { expectedStatus: 200 });
    const listedParent = retryList.data.data.items.find(row => row.id === retryParent.id);
    assert.equal(listedParent.canRetry, true);
    const parentBefore = await db.whatsAppDelivery.findUniqueOrThrow({ where: { id: retryParent.id } });
    const retryResponse = await t.request('POST', '/api/whatsapp-notifications', {
      json: { action: 'retry', ids: [retryParent.id], expectedUpdatedAt: listedParent.updatedAt }, expectedStatus: 200,
    });
    const retryChild = await db.whatsAppDelivery.findUniqueOrThrow({ where: { id: retryResponse.data.data.retryId } });
    assert.equal(retryChild.retryOf, retryParent.id);
    assert.equal(retryChild.intendedTo, '+224622491286');
    assert.equal(retryChild.actualTo, '+224622491286');
    assert.equal(retryChild.status, 'QUEUED');
    assert.ok(retryChild.nextSendAt.getTime() > Date.now() + 280000);
    assert.equal(retryChild.businessSnapshot.amount, 5000);
    assert.notDeepEqual(retryChild.businessSnapshot, parentBefore.businessSnapshot);
    assert.deepEqual(await db.whatsAppDelivery.findUniqueOrThrow({ where: { id: retryParent.id } }), parentBefore);
    await t.request('POST', '/api/whatsapp-notifications', {
      json: { action: 'retry', ids: [retryParent.id], expectedUpdatedAt: parentBefore.updatedAt.toISOString() }, expectedStatus: 409,
    });
    assert.equal(await db.whatsAppDelivery.count({ where: { retryOf: retryParent.id } }), 1);
    await db.whatsAppDelivery.update({ where: { id: retryChild.id }, data: { status: 'ACCEPTED', providerMessageId: 'provider-success-' + suffix } });
    const successfulList = await t.request('GET', '/api/whatsapp-notifications', { expectedStatus: 200 });
    assert.equal(successfulList.data.data.items.find(row => row.id === retryChild.id)?.canRetry, false);

    // Reuse this isolated fixture's request; the application correctly forbids duplicate requests.
    await db.deletionRequest.update({ where: { id: request.data.data.id }, data: { status: 'PENDING' } });
    await refresh();
    assert.equal((await db.whatsAppDelivery.findUniqueOrThrow({ where: { id: reminder.id } })).status, 'PAUSED');
    await t.request('POST', '/api/deletion', { json: { action: 'reject', requestId: request.data.data.id }, expectedStatus: 200 });
    await db.receipt.update({ where: { id: b.id }, data: { usd: 9980 } });
    await refresh();
    assert.equal((await db.whatsAppDelivery.findUniqueOrThrow({ where: { id: reminder.id } })).status, 'CANCELLED');
    await db.receipt.update({ where: { id: b.id }, data: { usd: 5500 } });
    await db.systemSetting.update({ where: { key: 'whatsapp.notifications' }, data: { value: JSON.stringify({ ...JSON.parse((await db.systemSetting.findUniqueOrThrow({ where: { key: 'whatsapp.notifications' } })).value), reminderEnabled: false }) } });
    const failedReminder = await db.whatsAppDelivery.update({ where: { id: reminder.id }, data: {
      status: 'FAILED', failureCode: 'REMINDER_IMAGE_FAILED', claimToken: 'historical-claim', claimedAt: new Date(),
    } });
    const retryRequests = await Promise.all([1, 2].map(() => t.request('POST', '/api/whatsapp-notifications', {
      json: { action: 'retry', ids: [failedReminder.id], expectedUpdatedAt: failedReminder.updatedAt.toISOString() },
    })));
    assert.deepEqual(retryRequests.map(r => r.status).sort(), [200, 409]);
    const reminderRetry = await db.whatsAppDelivery.findFirstOrThrow({ where: { retryOf: failedReminder.id } });
    assert.equal(reminderRetry.businessSnapshot.outstanding.totalOutstanding, 4500);
    assert.equal(reminderRetry.parameters[1], '4,500');
    assert.equal(reminderRetry.status, 'PENDING');
    assert.equal(reminderRetry.claimToken, null);
    assert.equal(reminderRetry.statementImagePath, null);
    assert.ok(reminderRetry.nextSendAt.getTime() > Date.now() + 280000);
    assert.deepEqual(await db.whatsAppDelivery.findUniqueOrThrow({ where: { id: failedReminder.id } }), failedReminder);
    await db.whatsAppDelivery.update({ where: { id: failedReminder.id }, data: { status: 'DELIVERED' } });
    await refresh();
    assert.equal((await db.whatsAppDelivery.findUniqueOrThrow({ where: { id: reminderRetry.id } })).failureCode, 'RETRY_SOURCE_NO_LONGER_FAILED');
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
    await verifyReminderRestore(db, reminder.id);
    t.step('Customer reminder concurrent scheduling, live refresh, threshold, image reference and isolated database/media restore verified');
    t.step('WhatsApp buffer, deletion pause/rejection/approval, dependent balance correction, permanent cancellation, concurrent approval, opt-out and ADMIN permissions verified in isolated database');
  } finally { await db.$disconnect(); }
}
