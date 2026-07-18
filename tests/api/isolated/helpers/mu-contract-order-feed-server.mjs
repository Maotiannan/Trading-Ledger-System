import http from 'node:http';

const host = '127.0.0.1';
const port = Number(process.env.MU_CONTRACT_FAKE_PORT || 3199);
const bearerToken = process.env.MU_CONTRACT_FAKE_TOKEN || 'test-mu-contract-order-sync-token';
const controlToken = process.env.MU_CONTRACT_FAKE_CONTROL_TOKEN || 'test-mu-contract-control-token';

let state = {
  items: [],
  events: [],
  eventHighWatermark: '0',
  requests: [],
};

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function isAuthorized(request) {
  return request.headers.authorization === `Bearer ${bearerToken}`;
}

function isControlAuthorized(request) {
  return request.headers['x-control-token'] === controlToken;
}

function recordRequest(request, url) {
  state.requests.push({
    method: request.method,
    pathname: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    authorizationPresent: Boolean(request.headers.authorization),
    at: new Date().toISOString(),
  });
}

function eventPage(url) {
  const after = url.searchParams.get('after');
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 100)));
  const eligible = [...state.events]
    .sort((left, right) => (BigInt(left.cursor) < BigInt(right.cursor) ? -1 : 1))
    .filter((event) => after === null || BigInt(event.cursor) > BigInt(after));
  const events = eligible.slice(0, limit);
  return {
    schemaVersion: 1,
    events,
    nextCursor: events.at(-1)?.cursor ?? null,
    hasMore: eligible.length > events.length,
  };
}

function encodeSnapshotCursor(lastPiId) {
  const payload = Buffer.from(JSON.stringify({ lastPiId }), 'utf8').toString('base64url');
  return `${payload}.fake-signature`;
}

function decodeSnapshotCursor(value) {
  const [payload] = value.split('.', 1);
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!parsed || typeof parsed.lastPiId !== 'string') throw new Error('invalid snapshot cursor');
  return parsed.lastPiId;
}

function snapshotPage(url) {
  const after = url.searchParams.get('after');
  const lastPiId = after === null ? null : decodeSnapshotCursor(after);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 100)));
  const eligible = [...state.items]
    .sort((left, right) => left.source.piId.localeCompare(right.source.piId))
    .filter((item) => lastPiId === null || item.source.piId > lastPiId);
  const items = eligible.slice(0, limit);
  const hasMore = eligible.length > items.length;
  return {
    schemaVersion: 1,
    items,
    eventHighWatermark: state.eventHighWatermark,
    nextAfter: hasMore ? encodeSnapshotCursor(items.at(-1).source.piId) : null,
    hasMore,
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${host}:${port}`);
  try {
    if (url.pathname === '/__control/ready') {
      return json(response, 200, { ready: true });
    }
    if (url.pathname === '/__control/reset' && request.method === 'POST') {
      if (!isControlAuthorized(request)) return json(response, 401, { error: 'UNAUTHORIZED' });
      state = { items: [], events: [], eventHighWatermark: '0', requests: [] };
      return json(response, 200, { reset: true });
    }
    if (url.pathname === '/__control/configure' && request.method === 'POST') {
      if (!isControlAuthorized(request)) return json(response, 401, { error: 'UNAUTHORIZED' });
      const body = await readJson(request);
      state.items = Array.isArray(body.items) ? body.items : state.items;
      state.events = Array.isArray(body.events) ? body.events : state.events;
      state.eventHighWatermark = typeof body.eventHighWatermark === 'string'
        ? body.eventHighWatermark
        : state.eventHighWatermark;
      return json(response, 200, {
        items: state.items.length,
        events: state.events.length,
        eventHighWatermark: state.eventHighWatermark,
      });
    }
    if (url.pathname === '/__control/requests' && request.method === 'GET') {
      if (!isControlAuthorized(request)) return json(response, 401, { error: 'UNAUTHORIZED' });
      return json(response, 200, { requests: state.requests });
    }

    if (!isAuthorized(request)) return json(response, 401, { error: 'UNAUTHORIZED' });
    recordRequest(request, url);
    if (url.pathname === '/integrations/muledger/order-events' && request.method === 'GET') {
      return json(response, 200, eventPage(url));
    }
    if (url.pathname === '/integrations/muledger/order-snapshot' && request.method === 'GET') {
      return json(response, 200, snapshotPage(url));
    }
    return json(response, 404, { error: 'NOT_FOUND' });
  } catch {
    return json(response, 400, { error: 'INVALID_CONTROL_PAYLOAD' });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`MU Contract fake source listening on http://${host}:${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
