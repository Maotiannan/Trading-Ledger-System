import { MucontInvoiceError } from './mucont-invoice-contract';

export async function invoiceSourceFetch(path: string, init?: RequestInit) {
  const base = process.env.MUCONT_INVOICE_BASE_URL?.replace(/\/$/, '');
  const token = process.env.MUCONT_INVOICE_READ_TOKEN;
  if (!base || !token) throw new MucontInvoiceError(503, 'SOURCE_NOT_CONFIGURED', 'Invoice source is not configured.');
  const url = new URL(base + path);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new MucontInvoiceError(503, 'SOURCE_CONFIG_INVALID', 'Invalid source configuration.');
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers, Authorization: `Bearer ${token}` },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
  } catch {
    throw new MucontInvoiceError(503, 'SOURCE_UNAVAILABLE', 'Invoice source is temporarily unavailable.');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new MucontInvoiceError(response.status === 404 ? 404 : 503,
      response.status === 404 ? 'SOURCE_NOT_FOUND' : 'SOURCE_UNAVAILABLE', 'Requested source data is unavailable.');
  }
  return response;
}

