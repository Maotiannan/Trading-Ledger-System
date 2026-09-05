import http from 'node:http';

const host = '127.0.0.1';
const maxPortCount = 8;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host, port: 0, exclusive: true }, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}

async function allocateFetchSafePort() {
  const server = http.createServer((_request, response) => {
    response.writeHead(204, { connection: 'close' });
    response.end();
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === 'string') {
    await close(server);
    throw new Error('Unable to read the allocated test port');
  }

  try {
    const response = await fetch(`http://${host}:${address.port}/`);
    if (response.status !== 204) {
      throw new Error(`Allocated test port returned HTTP ${response.status}`);
    }
  } catch (error) {
    await close(server);
    throw error;
  }
  return { port: address.port, server };
}

async function selectIsolatedTestPorts(count) {
  if (!Number.isInteger(count) || count < 1 || count > maxPortCount) {
    throw new Error(`Port count must be an integer between 1 and ${maxPortCount}`);
  }

  const allocations = [];
  try {
    for (let index = 0; index < count; index += 1) {
      allocations.push(await allocateFetchSafePort());
    }
    return allocations.map(({ port }) => port);
  } finally {
    await Promise.all(allocations.map(({ server }) => close(server)));
  }
}

const requestedCount = Number(process.argv[2] || 1);
selectIsolatedTestPorts(requestedCount)
  .then((ports) => process.stdout.write(`${ports.join(' ')}\n`))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
