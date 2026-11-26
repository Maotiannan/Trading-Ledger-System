import { NextRequest } from 'next/server';
import { withMucontCustomerRead, MucontCustomerError } from '@/lib/integrations/mucont-customer-http';
import { readMucontCustomerMarks } from '@/lib/integrations/mucont-customer-service';
import { parseJsonRequest } from '@/lib/http-body';

export async function POST(request: NextRequest) {
  return withMucontCustomerRead(request, async () => {
    let body: unknown;
    try { body = await parseJsonRequest(request); }
    catch { throw new MucontCustomerError(400, 'INVALID_QUERY', 'Invalid JSON request.'); }
    return readMucontCustomerMarks(body);
  });
}
