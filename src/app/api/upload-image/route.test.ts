/** @jest-environment node */
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { GET, HEAD } from './route';
import { getCurrentUser } from '@/lib/request-auth';
import { db } from '@/lib/db';
jest.mock('@/lib/request-auth', () => ({ getCurrentUser: jest.fn() }));
jest.mock('@/lib/resource-visibility', () => ({
  getOwnerVisibleIds: jest.fn().mockResolvedValue(['owner']),
  buildReceiptVisibilityWhere: () => ({ createdBy: 'owner' }),
  buildDetailVisibilityWhere: () => ({ createdBy: 'owner' }),
  buildSwiftVisibilityWhere: () => ({ createdBy: 'owner' }),
  managedOwnershipWhere: () => ({ createdBy: 'owner' }),
}));
jest.mock('@/lib/db', () => ({ db: {
  receipt: { findFirst: jest.fn() }, detail: { findFirst: jest.fn() }, swift: { findFirst: jest.fn() },
  paymentAgentFile: { findFirst: jest.fn() }, uploadedAsset: { findFirst: jest.fn() },
} }));
const previousDir = process.env.UPLOAD_DIR;
let directory: string;
const req = (headers = {}, method = 'GET') => new NextRequest('http://localhost/api/upload-image?path=%2Fupload%2Fimages%2Fsample.pdf', { headers, method });
beforeEach(async () => {
  jest.clearAllMocks();
  directory = await mkdtemp(path.join(tmpdir(), 'ledger-upload-api-'));
  process.env.UPLOAD_DIR = directory;
  await writeFile(path.join(directory, 'sample.pdf'), '0123456789');
  (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'owner' });
  (db.receipt.findFirst as jest.Mock).mockResolvedValue({ id: 'receipt' });
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); process.env.UPLOAD_DIR = previousDir; });
test('serves a real local synthetic file range, HEAD and conditional 304', async () => {
  const range = await GET(req({ Range: 'bytes=0-3' }));
  expect(range.status).toBe(206);
  expect(await range.text()).toBe('0123');
  expect(range.headers.get('cache-control')).toBe('private, max-age=3600');
  const cached = await GET(req({ 'If-None-Match': range.headers.get('etag')! }));
  expect(cached.status).toBe(304);
  const head = await HEAD(req({}, 'HEAD'));
  expect(head.headers.get('content-length')).toBe('10');
  expect(await head.text()).toBe('');
});
test('never serves cached or partial content without current authorization', async () => {
  (getCurrentUser as jest.Mock).mockResolvedValue(null);
  expect((await GET(req({ 'If-None-Match': '*', Range: 'bytes=0-1' }))).status).toBe(401);
  (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'owner' });
  (db.receipt.findFirst as jest.Mock).mockResolvedValue(null);
  expect((await GET(req({ 'If-None-Match': '*', Range: 'bytes=0-1' }))).status).toBe(403);
});
