import http from 'node:http';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const fixtures = JSON.parse(fs.readFileSync(new URL('../../../../docs/integrations/invoice-generation-v1/fixtures.json', import.meta.url)));
let latest = fixtures[0].request;
let version = 1;
let unavailable = false;
let metadataCalls = 0;
let fileName = '提单.pdf';
const token = 'invoice-r2-read-isolated-12345678901234567890';
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let body = '';
  for await (const chunk of req) body += chunk;
  const json = body ? JSON.parse(body) : {};
  if (req.headers.authorization !== 'Bearer ' + token) { res.writeHead(401).end(); return; }
  const reply = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (url.pathname === '/__control') {
    if (json.latest) latest = json.latest;
    if (json.version) version = json.version;
    if ('unavailable' in json) unavailable = json.unavailable;
    if (json.fileName) fileName = json.fileName;
    reply({ metadataCalls }); return;
  }
  if (unavailable) { reply({ error: 'unavailable' }, 503); return; }
  if (url.pathname.endsWith('/latest-generated')) { reply(latest); return; }
  if (url.pathname.endsWith('/invoice-snapshot')) { reply({ schemaVersion: 1, items: [latest], hasMore: false, nextCursor: null }); return; }
  if (url.pathname.endsWith('/metadata-query')) {
    metadataCalls++;
    reply({ schemaVersion: 1, items: json.invoiceBatchIds.map((invoiceBatchId) => ({
      invoiceBatchId, availability: 'available', metadataVersion: version, sourceUpdatedAt: '2026-11-11T04:00:00Z',
      departureDate: '2026-10-01', estimatedArrivalDate: '2026-11-01', releaseDate: version === 1 ? null : '2026-11-02',
      creditInsurance: { creditRecordId: 'credit-fixture', companyName: 'TEST CREDIT', sourceVersion: String(version) },
      billOfLading: { versionId: String(version), fileName, contentType: fileName.endsWith('.png') ? 'image/png' : 'application/pdf',
        byteSize: Buffer.byteLength('test bill of lading ' + version), sha256: createHash('sha256').update('test bill of lading ' + version).digest('hex') },
    })) }); return;
  }
  if (url.pathname.endsWith('/bill-of-lading/current/content')) {
    const data = 'test bill of lading ' + version;
    res.writeHead(200, { 'Content-Type': fileName.endsWith('.png') ? 'image/png' : 'application/pdf', 'Content-Disposition': `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'X-Mucont-File-Version': String(version), 'X-Content-SHA256': createHash('sha256').update(data).digest('hex') });
    res.end(data); return;
  }
  reply({ error: 'not_found' }, 404);
});
server.listen(3314, '127.0.0.1', () => console.log('Isolated invoice fixture source on 3314'));
