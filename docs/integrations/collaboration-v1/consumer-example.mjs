// Server-side only. Supply trusted configuration, never a browser/user-provided URL.
export function createLedgerCreditSource({ baseUrl, token }) {
  const origin = new URL(baseUrl);
  if (origin.username || origin.password || !['https:', 'http:'].includes(origin.protocol)) throw Error('Invalid source URL');
  if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw Error('Use HTTPS except for loopback testing');
  if (typeof token !== 'string' || token.length < 32) throw Error('Dedicated source credential is not configured');
  const base = '/api/integrations/collaboration/v1/credit-records';

  async function get(path) {
    const response = await fetch(new URL(path, origin), {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error('Ledger source read failed');
      error.status = response.status;
      error.code = data.error?.code || 'INVALID_RESPONSE';
      error.retryAfterMs = data.error?.retryAfterMs || null;
      throw error;
    }
    if (response.headers.get('x-collaboration-contract') !== 'credit-records/1.0.0') throw Error('Unexpected source contract');
    return data;
  }

  const read = id => get(`${base}/${encodeURIComponent(id)}`);

  async function listAll() {
    const records = new Map();
    const cursors = new Set();
    let cursor = null;
    do {
      const params = new URLSearchParams({ limit: '50' });
      if (cursor) params.set('cursor', cursor);
      const page = await get(`${base}?${params}`);
      if (!Array.isArray(page.items) || typeof page.hasMore !== 'boolean'
        || (page.hasMore ? typeof page.nextCursor !== 'string' || !page.nextCursor : page.nextCursor !== null)) throw Error('Invalid page metadata');
      for (const record of page.items) {
        if (record.creditState !== 'AVAILABLE' || typeof record.creditAmount !== 'string') throw Error('Invalid credit record');
        // Keep decimal strings; do not merge same-name records or convert to Number.
        records.set(record.creditRecordId, record);
      }
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw Error('Repeated source cursor');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return records;
  }

  async function reconcileKnown(knownIds) {
    const current = await listAll(); // Any page failure aborts the reconciliation.
    const unavailable = new Map();
    for (const id of knownIds) {
      if (current.has(id)) continue;
      try {
        const record = await read(id);
        if (record.creditState === 'AVAILABLE') current.set(id, record);
        else unavailable.set(id, { reason: record.creditState, record });
      } catch (error) {
        if (error.status === 404 && error.code === 'CREDIT_RECORD_NOT_FOUND') unavailable.set(id, { reason: 'DELETED' });
        else throw error; // 401/429/503 are never deletion evidence.
      }
    }
    // Caller atomically updates current-source status and last-successful-sync time.
    // Do not delete historical discussions or overwrite an invoice's chosen snapshot.
    return { current, unavailable, synchronizedAt: new Date().toISOString() };
  }

  return { listAll, read, reconcileKnown };
}
