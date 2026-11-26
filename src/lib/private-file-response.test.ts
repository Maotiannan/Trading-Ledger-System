/** @jest-environment node */
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { privateFileResponse } from './private-file-response';

let directory: string;
let file: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'ledger-media-test-'));
  file = path.join(directory, 'sample.pdf');
  await writeFile(file, '0123456789');
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const request = (headers = {}, method = 'GET') => new Request('http://localhost/test', { headers, method });

test('streams the full private file with validators and a known length', async () => {
  const response = await privateFileResponse(request(), file, { contentType: 'application/pdf' });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-length')).toBe('10');
  expect(response.headers.get('cache-control')).toBe('private, no-cache');
  expect(response.headers.get('accept-ranges')).toBe('bytes');
  expect(await response.text()).toBe('0123456789');
});
test.each([
  ['bytes=2-4', '234', 'bytes 2-4/10'],
  ['bytes=7-', '789', 'bytes 7-9/10'],
  ['bytes=-3', '789', 'bytes 7-9/10'],
  ['bytes=8-99', '89', 'bytes 8-9/10'],
])('serves only the requested range %s', async (range, body, contentRange) => {
  const response = await privateFileResponse(request({ Range: range }), file, { contentType: 'application/pdf' });
  expect(response.status).toBe(206);
  expect(response.headers.get('content-range')).toBe(contentRange);
  expect(response.headers.get('content-length')).toBe(String(body.length));
  expect(await response.text()).toBe(body);
});
test('revalidates without retransmitting and returns new content after replacement', async () => {
  const first = await privateFileResponse(request(), file, { contentType: 'application/pdf' });
  await first.text();
  const etag = first.headers.get('etag')!;
  const cached = await privateFileResponse(request({ 'If-None-Match': etag }), file, { contentType: 'application/pdf' });
  expect(cached.status).toBe(304);
  expect(await cached.text()).toBe('');
  await writeFile(file, 'updated file');
  const changed = await privateFileResponse(request({ 'If-None-Match': etag }), file, { contentType: 'application/pdf' });
  expect(changed.status).toBe(200);
  expect(await changed.text()).toBe('updated file');
});
test('rejects unsatisfiable ranges and ignores unsupported multi-range requests', async () => {
  const invalid = await privateFileResponse(request({ Range: 'bytes=20-' }), file, { contentType: 'application/pdf' });
  expect(invalid.status).toBe(416);
  expect(invalid.headers.get('content-range')).toBe('bytes */10');
  const multi = await privateFileResponse(request({ Range: 'bytes=0-1,4-5' }), file, { contentType: 'application/pdf' });
  expect(multi.status).toBe(200);
  expect(await multi.text()).toBe('0123456789');
});
test('does not apply a stale If-Range and does not read a HEAD body', async () => {
  const stale = await privateFileResponse(request({ Range: 'bytes=0-1', 'If-Range': '"old"' }), file, { contentType: 'application/pdf' });
  expect(stale.status).toBe(200);
  expect(await stale.text()).toBe('0123456789');
  const head = await privateFileResponse(request({}, 'HEAD'), file, { contentType: 'application/pdf' });
  expect(head.headers.get('content-length')).toBe('10');
  expect(await head.text()).toBe('');
});
