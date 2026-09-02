import http from 'node:http';

const host = '127.0.0.1';
const port = Number(process.env.RESEND_FAKE_PORT || 3799);
const controlToken = process.env.RESEND_FAKE_CONTROL_TOKEN || 'test-resend-control-token';

function initialState() {
  return {
    rejectedRecipients: new Set(),
    disconnectedRecipients: new Set(),
    rejectedIdempotencyKeys: new Set(),
    disconnectedIdempotencyKeys: new Set(),
    requests: [],
    acceptedByIdempotencyKey: new Map(),
    nextMessageNumber: 1,
  };
}

let state = initialState();

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

function isControlAuthorized(request) {
  return request.headers['x-control-token'] === controlToken;
}

function recipients(body) {
  return [...(Array.isArray(body.to) ? body.to : []), ...(Array.isArray(body.cc) ? body.cc : [])]
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);
}

function requestSnapshot(request, body) {
  return {
    method: request.method,
    pathname: '/emails',
    authorizationPresent: Boolean(request.headers.authorization),
    idempotencyKey: String(request.headers['idempotency-key'] || ''),
    body,
    at: new Date().toISOString(),
  };
}

function configuredRecipientMatches(configured, body) {
  return recipients(body).some((recipient) => configured.has(recipient));
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${host}:${port}`);
  try {
    if (url.pathname === '/__control/ready' && request.method === 'GET') {
      return json(response, 200, { ready: true });
    }
    if (url.pathname === '/__control/reset' && request.method === 'POST') {
      if (!isControlAuthorized(request)) return json(response, 401, { error: 'UNAUTHORIZED' });
      state = initialState();
      return json(response, 200, { reset: true });
    }
    if (url.pathname === '/__control/configure' && request.method === 'POST') {
      if (!isControlAuthorized(request)) return json(response, 401, { error: 'UNAUTHORIZED' });
      const body = await readJson(request);
      state.rejectedRecipients = new Set(
        (Array.isArray(body.rejectedRecipients) ? body.rejectedRecipients : [])
          .map((value) => String(value).trim().toLowerCase())
          .filter(Boolean),
      );
      state.disconnectedRecipients = new Set(
        (Array.isArray(body.disconnectedRecipients) ? body.disconnectedRecipients : [])
          .map((value) => String(value).trim().toLowerCase())
          .filter(Boolean),
      );
      state.rejectedIdempotencyKeys = new Set(
        (Array.isArray(body.rejectedIdempotencyKeys) ? body.rejectedIdempotencyKeys : [])
          .map((value) => String(value).trim())
          .filter(Boolean),
      );
      state.disconnectedIdempotencyKeys = new Set(
        (Array.isArray(body.disconnectedIdempotencyKeys) ? body.disconnectedIdempotencyKeys : [])
          .map((value) => String(value).trim())
          .filter(Boolean),
      );
      return json(response, 200, {
        rejectedRecipients: [...state.rejectedRecipients],
        disconnectedRecipients: [...state.disconnectedRecipients],
        rejectedIdempotencyKeys: [...state.rejectedIdempotencyKeys],
        disconnectedIdempotencyKeys: [...state.disconnectedIdempotencyKeys],
      });
    }
    if (url.pathname === '/__control/requests' && request.method === 'GET') {
      if (!isControlAuthorized(request)) return json(response, 401, { error: 'UNAUTHORIZED' });
      return json(response, 200, { requests: state.requests });
    }

    if (url.pathname !== '/emails' || request.method !== 'POST') {
      return json(response, 404, { name: 'not_found', message: 'Not found', statusCode: 404 });
    }
    if (!String(request.headers.authorization || '').startsWith('Bearer ')) {
      return json(response, 401, { name: 'unauthorized', message: 'Unauthorized', statusCode: 401 });
    }

    const body = await readJson(request);
    const snapshot = requestSnapshot(request, body);
    state.requests.push(snapshot);

    if (
      state.disconnectedIdempotencyKeys.has(snapshot.idempotencyKey)
      || configuredRecipientMatches(state.disconnectedRecipients, body)
    ) {
      snapshot.outcome = 'DISCONNECTED';
      request.socket.destroy();
      return;
    }
    if (
      state.rejectedIdempotencyKeys.has(snapshot.idempotencyKey)
      || configuredRecipientMatches(state.rejectedRecipients, body)
    ) {
      snapshot.outcome = 'REJECTED';
      return json(response, 422, {
        name: 'validation_error',
        message: 'Recipient rejected by isolated fake Resend.',
        statusCode: 422,
      });
    }

    const idempotencyKey = snapshot.idempotencyKey;
    const existingId = idempotencyKey ? state.acceptedByIdempotencyKey.get(idempotencyKey) : null;
    const messageId = existingId || `fake-resend-${state.nextMessageNumber++}`;
    if (idempotencyKey && !existingId) state.acceptedByIdempotencyKey.set(idempotencyKey, messageId);
    snapshot.outcome = 'ACCEPTED';
    snapshot.providerMessageId = messageId;
    return json(response, 200, { id: messageId });
  } catch {
    return json(response, 400, {
      name: 'invalid_request',
      message: 'Invalid fake Resend request.',
      statusCode: 400,
    });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Fake Resend listening on http://${host}:${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
