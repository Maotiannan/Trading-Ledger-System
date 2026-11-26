import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, validateUser } from '@/lib/auth';
import { deleteManagedUser, changeCurrentUserPassword, resetManagedUserPassword } from '@/lib/auth-service';
import { createSessionToken } from '@/lib/session';
import { getCurrentUser } from '@/lib/request-auth';
import { previewAccountHandover, confirmAccountHandover, reactivateManagedUser } from '@/lib/account-handover-service';
import { getDashboardSummary } from '@/lib/dashboard-summary-service';
import { generateExcelApiToken, verifyExcelApiTokenFromHeader } from '@/lib/excel-token-service';
import { POST } from '@/app/api/auth/route';
import { GET as readMucontCustomers } from '@/app/api/integrations/mucont/v1/customers/options/route';
import { GET as readMucontCustomer } from '@/app/api/integrations/mucont/v1/customers/[customerId]/route';
import { GET as readInvoices, PUT as writeInvoice } from '@/app/api/invoice/route';
import { GET as readReceipts } from '@/app/api/receipt/route';
import { GET as readDetails } from '@/app/api/detail/route';
import { GET as readSwifts } from '@/app/api/swift/route';
import { GET as readOrders, POST as writeOrder } from '@/app/api/orders/route';
import { GET as readAgents, POST as writeAgent } from '@/app/api/agent/route';
import { createHash } from 'crypto';
import { migratePassword } from '@/lib/auth';

let actor: Awaited<ReturnType<typeof db.user.create>>;
let password: string;
let serial = 0;
const label = () => `account-${Date.now()}-${++serial}`;
async function child(role: 'USER' | 'SALES' = 'USER') {
  return db.user.create({ data: { email: `${label()}@example.invalid`, password, role, level: role === 'USER' ? 4 : 3,
    parentId: actor.id, createdById: actor.id } });
}
const request = (id: string, version = 0) => new NextRequest('http://isolated.local/api/auth', { headers: { cookie: `tls_session=${createSessionToken(id, version)}` } });
const invoiceRequest = (id: string, body: object) => new NextRequest('http://isolated.local/api/invoice', {
  method: 'PUT', headers: { cookie: `tls_session=${createSessionToken(id)}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL || '');
  if (process.env.MULEDGER_RELIABILITY_ISOLATED !== 'true' || url.hostname !== '127.0.0.1' || url.pathname !== '/muledger_reliability_test') throw Error('Not an isolated test database');
  process.env.MUCONT_CUSTOMERS_READ_TOKEN = 'isolated-mucont-customers-token-1234567890';
  password = await hashPassword('OriginalPassword@2026');
  actor = await db.user.create({ data: { email: `${label()}@example.invalid`, password, role: 'ADMIN', level: 1 } });
});
afterAll(async () => { await db.$disconnect(); });

test('disabling a user revokes login, cookies and personal Excel access without rewriting hierarchy or history', async () => {
  const source = await child();
  const customer = await db.customer.create({ data: { mark: label(), normalizedMark: label(), orderName: label(), name: 'Test', phone: '', city: '', createdBy: source.id, ownerId: source.id } });
  const invoice = await db.invoice.create({ data: { invNo: label(), createdBy: source.id } });
  const order = await db.order.create({ data: { invoiceId: invoice.id, orderNo: label(), amount: 100, createdBy: source.id, customerId: customer.id } });
  const token = await generateExcelApiToken(source);
  expect(await getCurrentUser(request(source.id))).not.toBeNull();
  const old = await db.user.findUniqueOrThrow({ where: { id: source.id } });
  await deleteManagedUser(actor, source.id);
  const current = await db.user.findUniqueOrThrow({ where: { id: source.id } });
  expect({ ...current, disabledAt: null, sessionVersion: 0, updatedAt: old.updatedAt }).toEqual(old);
  expect(current.disabledAt).not.toBeNull();
  expect(await getCurrentUser(request(source.id))).toBeNull();
  expect(await validateUser(source.email, 'OriginalPassword@2026')).toBeNull();
  await expect(verifyExcelApiTokenFromHeader(`Bearer ${token.token}`, null)).rejects.toMatchObject({ status: 401 });
  expect(await db.excelApiToken.count({ where: { id: token.tokenInfo.id } })).toBe(1);
  expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).createdBy).toBe(source.id);
  expect((await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).ownerId).toBe(source.id);
  expect(await getCurrentUser(request(actor.id))).not.toBeNull();
  await reactivateManagedUser(actor, source.id);
  expect(await getCurrentUser(request(source.id))).toBeNull();
  expect(await getCurrentUser(request(source.id, 2))).not.toBeNull();
});

test('a password change rejects all old sessions and prevents concurrent old-password changes', async () => {
  const user = await child();
  const results = await Promise.allSettled([
    changeCurrentUserPassword(user, { oldPassword: 'OriginalPassword@2026', newPassword: 'NewPassword@2026-A' }),
    changeCurrentUserPassword(user, { oldPassword: 'OriginalPassword@2026', newPassword: 'NewPassword@2026-B' }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await getCurrentUser(request(user.id))).toBeNull();
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion).toBe(1);
  expect(await db.auditLog.count({ where: { targetId: user.id, action: 'USER_PASSWORD_CHANGE' } })).toBe(1);
});

test('administrator password reset revokes old cookies and auth API refuses the previous cookie', async () => {
  const user = await child();
  const cookie = createSessionToken(user.id);
  await resetManagedUserPassword(actor, { userId: user.id, password: 'ResetPassword@2026' });
  const response = await POST(new NextRequest('http://isolated.local/api/auth', { method: 'POST',
    headers: { cookie: `tls_session=${cookie}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'me' }) }));
  expect(response.status).toBe(401);
});

test('handover previews and moves current custody only, is idempotent, and covers unbound business records', async () => {
  const [source, recipient] = await Promise.all([child(), child()]);
  const invoice = await db.invoice.create({ data: { invNo: label(), createdBy: source.id } });
  const order = await db.order.create({ data: { invoiceId: invoice.id, orderNo: label(), amount: 100, orderBalance: 100, createdBy: source.id } });
  const receipt = await db.receipt.create({ data: { usd: 5, orderId: order.id, createdBy: source.id } });
  const agent = await db.paymentAgent.create({ data: { companyName: label(), createdBy: source.id } });
  const detail = await db.detail.create({ data: { totalAmount: 5, agentId: agent.id, createdBy: source.id } });
  const swift = await db.swift.create({ data: { detailId: detail.id, amount: 5, createdBy: source.id } });
  const tracker = await db.orderTracker.create({ data: { orderNo: label(), normalizedOrderNo: label(), createdBy: source.id, updatedBy: source.id } });
  const asset = await db.uploadedAsset.create({ data: { path: `/upload/images/test/${label()}.png`, name: 'test.png',
    category: 'RECEIPT_DIRECT', mimeType: 'image/png', sizeBytes: 1, createdBy: source.id } });
  const customer = await db.customer.create({ data: { mark: label(), normalizedMark: label(), orderName: label(),
    name: 'Isolated handover', phone: '', city: '', createdBy: source.id, ownerId: source.id } });
  const preview = await previewAccountHandover(actor, source.id, recipient.id);
  expect(preview.counts).toEqual({ invoice: 1, order: 1, receipt: 1, detail: 1, swift: 1, orderTracker: 1, paymentAgent: 1, uploadedAsset: 1, customer: 1 });
  const input = { sourceId: source.id, recipientId: recipient.id, fingerprint: preview.fingerprint, requestId: label() };
  await confirmAccountHandover(actor, input);
  await confirmAccountHandover(actor, input);
  for (const row of await Promise.all([
    db.invoice.findUniqueOrThrow({ where: { id: invoice.id } }),
    db.order.findUniqueOrThrow({ where: { id: order.id } }),
    db.receipt.findUniqueOrThrow({ where: { id: receipt.id } }),
    db.detail.findUniqueOrThrow({ where: { id: detail.id } }),
    db.swift.findUniqueOrThrow({ where: { id: swift.id } }),
    db.orderTracker.findUniqueOrThrow({ where: { id: tracker.id } }),
    db.paymentAgent.findUniqueOrThrow({ where: { id: agent.id } }),
    db.uploadedAsset.findUniqueOrThrow({ where: { id: asset.id } }),
  ])) {
    expect(row.createdBy).toBe(source.id);
    expect(row.managedById).toBe(recipient.id);
  }
  const handedCustomer = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
  expect(handedCustomer.createdBy).toBe(source.id);
  expect(handedCustomer.ownerId).toBe(recipient.id);
  expect((await db.orderTracker.findUniqueOrThrow({ where: { id: tracker.id } })).updatedBy).toBe(source.id);
  expect((await db.user.findUniqueOrThrow({ where: { id: source.id } })).parentId).toBe(actor.id);
  expect((await db.user.findUniqueOrThrow({ where: { id: source.id } })).disabledAt).toBeNull();
  expect((await getDashboardSummary(recipient)).invoiceCount).toBe(1);
  expect((await getDashboardSummary(source)).invoiceCount).toBe(0);
  expect(await db.auditLog.count({ where: { targetId: source.id, action: 'user.business_handover' } })).toBe(1);
});

test('handover changes actual business API visibility and mutable permissions without rewriting authors', async () => {
  const [source, recipient] = await Promise.all([child('SALES'), child('SALES')]);
  const receipt = await db.receipt.create({ data: { usd: 8, createdBy: source.id } });
  const agent = await db.paymentAgent.create({ data: { companyName: label(), createdBy: source.id } });
  const detail = await db.detail.create({ data: { totalAmount: 8, agentId: agent.id, createdBy: source.id } });
  const swift = await db.swift.create({ data: { detailId: detail.id, amount: 8, createdBy: source.id } });
  const tracker = await db.orderTracker.create({ data: {
    orderNo: label(), normalizedOrderNo: label(), createdBy: source.id, updatedBy: source.id,
  } });
  const preview = await previewAccountHandover(actor, source.id, recipient.id);
  await confirmAccountHandover(actor, {
    sourceId: source.id, recipientId: recipient.id, fingerprint: preview.fingerprint, requestId: label(),
  });
  const endpoints = [
    [readReceipts, '/api/receipt', receipt.id],
    [readDetails, '/api/detail', detail.id],
    [readSwifts, '/api/swift', swift.id],
    [readOrders, '/api/orders', tracker.id],
    [readAgents, '/api/agent', agent.id],
  ] as const;
  for (const [user, canRead] of [[source, false], [recipient, true]] as const) {
    for (const [read, path, id] of endpoints) {
      const response = await read(new NextRequest(`http://isolated.local${path}`, {
        headers: { cookie: `tls_session=${createSessionToken(user.id)}` },
      }));
      expect(response.status).toBe(200);
      expect((await response.json()).data.some((row: { id: string }) => row.id === id)).toBe(canRead);
    }
    for (const [write, path, body] of [
      [writeOrder, '/api/orders', { action: 'update', orderId: tracker.id, status: 'Confirmed', remark: 'Recipient-managed' }],
      [writeAgent, '/api/agent', { action: 'update', agentId: agent.id, companyName: 'Recipient-managed agent' }],
    ] as const) {
      const response = await write(new NextRequest(`http://isolated.local${path}`, {
        method: 'POST', headers: { cookie: `tls_session=${createSessionToken(user.id)}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }));
      expect(response.status).toBe(canRead ? 200 : 403);
    }
  }
  expect(await db.orderTracker.findUniqueOrThrow({ where: { id: tracker.id } })).toMatchObject({
    status: 'Confirmed', remark: 'Recipient-managed', createdBy: source.id, managedById: recipient.id, updatedBy: recipient.id,
  });
  expect(await db.paymentAgent.findUniqueOrThrow({ where: { id: agent.id } })).toMatchObject({
    companyName: 'Recipient-managed agent', createdBy: source.id, managedById: recipient.id,
  });
});

test('legacy password migration cannot overwrite a password changed after verification', async () => {
  const user = await child();
  const legacyHash = createHash('sha256').update('OldPassword@2026salt_key_for_security').digest('hex');
  await db.user.update({ where: { id: user.id }, data: { password: legacyHash } });
  await resetManagedUserPassword(actor, { userId: user.id, password: 'ResetPassword@2026' });
  expect(await migratePassword(user.id, 'OldPassword@2026', legacyHash)).toBe(false);
  expect(await validateUser(user.email, 'ResetPassword@2026')).not.toBeNull();
  expect(await validateUser(user.email, 'OldPassword@2026')).toBeNull();
});

test('handover rejects lower privilege and unrelated recipients without changing custody', async () => {
  const source = await child('SALES');
  const lower = await child();
  const outsider = await db.user.create({ data: { email: `${label()}@example.invalid`, password, role: 'SALES', level: 3 } });
  const invoice = await db.invoice.create({ data: { invNo: label(), createdBy: source.id } });
  await expect(previewAccountHandover(actor, source.id, lower.id)).rejects.toMatchObject({ status: 403 });
  await expect(previewAccountHandover(actor, source.id, outsider.id)).rejects.toMatchObject({ status: 403 });
  await expect(previewAccountHandover(lower, source.id, actor.id)).rejects.toMatchObject({ status: 403 });
  expect((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).managedById).toBeNull();
});

test('changed preview or inactive recipient rejects handover with no partial ownership changes', async () => {
  const [source, recipient] = await Promise.all([child(), child()]);
  const invoice = await db.invoice.create({ data: { invNo: label(), createdBy: source.id } });
  const preview = await previewAccountHandover(actor, source.id, recipient.id);
  await db.invoice.update({ where: { id: invoice.id }, data: { invNo: label() } });
  await expect(confirmAccountHandover(actor, { sourceId: source.id, recipientId: recipient.id, fingerprint: preview.fingerprint, requestId: label() })).rejects.toMatchObject({ status: 409 });
  expect((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).managedById).toBeNull();
  await deleteManagedUser(actor, recipient.id);
  await expect(previewAccountHandover(actor, source.id, recipient.id)).rejects.toMatchObject({ status: 403 });
});

test('MuCont service credentials retain all-customer read access across staff disable and ownership changes', async () => {
  const user = await child();
  const mark = label();
  await db.customer.create({ data: { mark, normalizedMark: mark, orderName: mark, name: 'Test MuCont', phone: '', city: '', createdBy: user.id, ownerId: user.id } });
  await deleteManagedUser(actor, user.id);
  const response = await readMucontCustomers(new NextRequest(`http://isolated.local/api/integrations/mucont/v1/customers/options?q=${encodeURIComponent(mark)}`, {
    headers: { authorization: `Bearer ${process.env.MUCONT_CUSTOMERS_READ_TOKEN}` },
  }));
  expect(response.status).toBe(200);
  expect(JSON.stringify(await response.json())).toContain(mark);
});

test('MuCont unique-ID profile survives password reset, staff disable and independent customer handover', async () => {
  const [source, recipient] = await Promise.all([child(), child()]);
  const mark = label();
  const customer = await db.customer.create({ data: {
    mark, normalizedMark: mark, orderName: mark, name: 'Isolated stable-ID customer',
    companyName: 'Snapshot A company', companyAddress: 'Isolated address A',
    phone: '+12025550123', city: 'Conakry', consignee: 'Isolated consignee A',
    createdBy: source.id, ownerId: source.id,
  } });
  const profileUrl = `http://isolated.local/api/integrations/mucont/v1/customers/${customer.id}`;
  const readProfile = () => readMucontCustomer(new NextRequest(profileUrl, {
    headers: { authorization: `Bearer ${process.env.MUCONT_CUSTOMERS_READ_TOKEN}` },
  }), { params: Promise.resolve({ customerId: customer.id }) });
  const before = await readProfile();
  expect(before.status).toBe(200);
  const original = await before.json();
  expect(original).toMatchObject({ customerId: customer.id, completeness: 'MASTER_FULL', profile: {
    companyName: 'Snapshot A company', companyAddress: 'Isolated address A',
    phone: '+12025550123', city: 'Conakry', consignee: 'Isolated consignee A',
  } });

  await resetManagedUserPassword(actor, { userId: source.id, password: 'ResetPassword@2026' });
  await deleteManagedUser(actor, source.id);
  const preview = await previewAccountHandover(actor, source.id, recipient.id);
  await confirmAccountHandover(actor, {
    sourceId: source.id, recipientId: recipient.id, fingerprint: preview.fingerprint, requestId: label(),
  });

  const after = await readProfile();
  expect(after.status).toBe(200);
  expect(after.headers.get('cache-control')).toBe('no-store');
  const result = await after.json();
  expect(result.customerId).toBe(original.customerId);
  expect(result.profile).toEqual(original.profile);
  expect(result.completeness).toBe('MASTER_FULL');
  expect((await db.customer.findUniqueOrThrow({ where: { id: customer.id } })))
    .toMatchObject({ ownerId: recipient.id, createdBy: source.id });
  const options = await readMucontCustomers(new NextRequest(
    `http://isolated.local/api/integrations/mucont/v1/customers/options?q=${encodeURIComponent(mark)}`,
    { headers: { authorization: `Bearer ${process.env.MUCONT_CUSTOMERS_READ_TOKEN}` } },
  ));
  expect(options.status).toBe(200);
  expect((await options.json()).items).toContainEqual(expect.objectContaining({ customerId: customer.id }));
  const denied = await readMucontCustomer(new NextRequest(profileUrl, {
    headers: { cookie: `tls_session=${createSessionToken(source.id)}` },
  }), { params: Promise.resolve({ customerId: customer.id }) });
  expect(denied.status).toBe(401);
});

test('legacy invoice branch assignment after A-to-B handover moves current custody to C without changing authors', async () => {
  const admins = await Promise.all([0, 1, 2].map(() => db.user.create({ data: {
    email: `${label()}@example.invalid`, password, role: 'ADMIN', level: 2, parentId: actor.id, createdById: actor.id,
  } })));
  const [a, b, c] = admins;
  const invoice = await db.invoice.create({ data: { invNo: label(), createdBy: a.id } });
  const order = await db.order.create({ data: { invoiceId: invoice.id, orderNo: label(), amount: 100, orderBalance: 100, createdBy: a.id } });
  const preview = await previewAccountHandover(actor, a.id, b.id);
  await confirmAccountHandover(actor, { sourceId: a.id, recipientId: b.id, fingerprint: preview.fingerprint, requestId: label() });
  const response = await writeInvoice(invoiceRequest(actor.id, { action: 'assignBranchAdmin', invoiceId: invoice.id, targetAdminId: c.id }));
  expect(response.status).toBe(200);
  expect(await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({ managedById: c.id, createdBy: a.id });
  expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ managedById: c.id, createdBy: a.id });
  for (const [user, canRead] of [[b, false], [c, true]] as const) {
    const result = await readInvoices(new NextRequest(`http://isolated.local/api/invoice?search=${invoice.invNo}`, {
      headers: { cookie: `tls_session=${createSessionToken(user.id)}` },
    }));
    expect(result.status).toBe(200);
    expect((await result.json()).data.some((row: { id: string }) => row.id === invoice.id)).toBe(canRead);
    const write = await writeInvoice(invoiceRequest(user.id, { action: 'updateInvoiceDates', invoiceId: invoice.id, shipDate: '2026-11-01' }));
    expect(write.status).toBe(canRead ? 200 : 404);
  }
  const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'INVOICE_ASSIGN_BRANCH_ADMIN', targetId: invoice.id } });
  expect(audit.metadata).toMatchObject({ previousOwnerId: b.id, nextOwnerId: c.id, originalAuthorsUnchanged: true });
});

test('legacy invoice assignment rejects disabled, non-admin and unrelated recipients without partial reassignment', async () => {
  const invoice = await db.invoice.create({ data: { invNo: label(), createdBy: actor.id } });
  const disabled = await db.user.create({ data: { email: `${label()}@example.invalid`, password, role: 'ADMIN', level: 2,
    parentId: actor.id, createdById: actor.id, disabledAt: new Date() } });
  const unrelated = await db.user.create({ data: { email: `${label()}@example.invalid`, password, role: 'ADMIN', level: 2 } });
  const ordinary = await child();
  for (const recipient of [disabled, unrelated, ordinary]) {
    const response = await writeInvoice(invoiceRequest(actor.id, { action: 'assignBranchAdmin', invoiceId: invoice.id, targetAdminId: recipient.id }));
    expect(response.status).toBe(403);
  }
  expect(await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({ createdBy: actor.id, managedById: null });
  expect(await db.auditLog.count({ where: { action: 'INVOICE_ASSIGN_BRANCH_ADMIN', targetId: invoice.id } })).toBe(0);
});
