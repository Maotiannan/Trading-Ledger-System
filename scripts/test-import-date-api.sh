#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-12345678}"

BASE_URL="$BASE_URL" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" node <<'NODE'
const base = process.env.BASE_URL || 'http://127.0.0.1';
const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
const adminPassword = process.env.ADMIN_PASSWORD || '12345678';
const suffix = `${Date.now()}${Math.floor(Math.random()*1000)}`;
let cookie = '';

async function req(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${path}`, { ...options, headers });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && !cookie) cookie = setCookie.split(';')[0];
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  let r = await req('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login', email: adminEmail, password: adminPassword }),
  });
  assert(r.res.status === 200 && r.data.success, 'admin login failed');

  r = await req('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create', email: `qa-import-${suffix}@example.com`, password: '12345678', role: 'SALES', name: `QA ${suffix}` }),
  });
  assert(r.res.status === 200 && r.data.success, 'create sales failed');
  const ownerId = r.data.data.id;

  r = await req('/api/customer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      ownerId,
      mark: `MK-${suffix}`,
      orderName: `ORD-A-${suffix}`,
      name: `NAME-A-${suffix}`,
      phone: `111-${suffix}/222-${suffix}`,
      city: 'Conakry',
      consignee: '',
      companyName: '',
      credit: 0,
      companyAddress: '',
    }),
  });
  assert(r.res.status === 200 && r.data.success, 'create customer A failed');
  const customerAId = r.data.data.id;

  r = await req('/api/customer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      ownerId,
      mark: `MK-B-${suffix}`,
      orderName: `ORD-B-${suffix}`,
      name: `NAME-B-${suffix}`,
      phone: `333-${suffix}`,
      city: 'Kankan',
      consignee: '',
      companyName: '',
      credit: 0,
      companyAddress: '',
    }),
  });
  assert(r.res.status === 200 && r.data.success, 'create customer B failed');

  r = await req('/api/customer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'import-rows',
      ownerId,
      rows: [{
        rowNo: 2,
        mark: `MK-${suffix}`,
        orderName: `ORD-A-${suffix}`,
        name: `NAME-A-${suffix}`,
        phone: `222-${suffix}`,
        city: 'ShouldNotOverwrite',
        consignee: `Consignee-${suffix}`,
        companyName: '',
        credit: '',
        companyAddress: '',
        ownerEmail: '',
      }],
    }),
  });
  assert(r.res.status === 200 && r.data.success, 'import upsert failed');
  assert(r.data.data.updatedCount === 1, 'updatedCount mismatch');
  assert(Array.isArray(r.data.data.updatedRows) && r.data.data.updatedRows.length === 1, 'updatedRows summary missing');

  r = await req(`/api/customer?search=${encodeURIComponent(`NAME-A-${suffix}`)}`);
  const customerA = (r.data.data || []).find((item) => item.id === customerAId);
  assert(customerA, 'customer A missing after import');
  assert(customerA.city === 'Conakry', 'city should not be overwritten for non-empty field');
  assert(customerA.consignee === `Consignee-${suffix}`, 'consignee should be filled for empty field');

  await req('/api/customer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      ownerId,
      mark: `CFM-${suffix}`,
      orderName: `ORD-C1-${suffix}`,
      name: `CONFLICT-MARK-${suffix}`,
      phone: `999-${suffix}`,
      city: 'Conakry',
      consignee: '',
      companyName: '',
      credit: 0,
      companyAddress: '',
    }),
  });

  await req('/api/customer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      ownerId,
      mark: `CFM-${suffix}`,
      orderName: `ORD-C2-${suffix}`,
      name: `CONFLICT-MARK-${suffix}`,
      phone: `888-${suffix}`,
      city: 'Conakry',
      consignee: '',
      companyName: '',
      credit: 0,
      companyAddress: '',
    }),
  });

  r = await req('/api/customer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'import-rows',
      ownerId,
      rows: [{
        rowNo: 3,
        mark: `CFM-${suffix}`,
        orderName: `ORD-CX-${suffix}`,
        name: `CONFLICT-MARK-${suffix}`,
        phone: `999-${suffix}`,
        city: 'Conakry',
        consignee: '',
        companyName: '',
        credit: '',
        companyAddress: '',
        ownerEmail: '',
      }],
    }),
  });
  assert(Array.isArray(r.data.issueRows) && r.data.issueRows.length === 1, 'conflict row missing');
  assert(String(r.data.issueRows[0].reason || '').includes('命中多条客户'), 'conflict reason missing');

  r = await req('/api/invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invNo: `QA-INV-${suffix}`,
      orders: [{
        orderNo: `QA-ORDER-${suffix}`,
        amount: 100,
        customerMark: `MK-${suffix}`,
        customerName: `NAME-A-${suffix}`,
        customerId: customerAId,
      }],
      shipDate: null,
      releaseDate: null,
    }),
  });
  assert(r.res.status === 200 && r.data.success, 'create invoice failed');
  const invoiceId = r.data.data.id;

  r = await req('/api/invoice', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'updateInvoiceDates', invoiceId, shipDate: '2026-03-05', releaseDate: '' }),
  });
  assert(r.res.status === 200 && r.data.success, 'update invoice dates failed');
  assert(r.data.data.releaseDate === null, 'releaseDate clear failed');

  r = await req('/api/invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'import-rows',
      rows: [{
        rowNo: 2,
        invNo: `IMP-${suffix}`,
        shipDate: '',
        releaseDate: '',
        orderNo: `QA-ORDER-${suffix}`,
        amount: '120',
        customerMark: `MK-${suffix}`,
        customerName: `NAME-A-${suffix}`,
        customerId: customerAId,
      }],
    }),
  });
  assert(Array.isArray(r.data.issueRows) && r.data.issueRows.length === 1, 'duplicate invoice issue missing');
  assert(String(r.data.issueRows[0].reason || '').includes('此条已存在'), 'duplicate reason missing');

  console.log('[PASS] import/date APIs');
})();
NODE
