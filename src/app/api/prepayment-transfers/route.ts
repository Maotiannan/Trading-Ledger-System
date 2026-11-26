import { NextRequest } from 'next/server';
import { withAuth, withRole } from '@/lib/route-auth';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { parseJsonRequest } from '@/lib/http-body';
import { listPrepaymentCredits, searchTransferTargets, transferPrepayment } from '@/lib/prepayments/transfers';
import { prepaymentUiErrorResponse } from '@/lib/prepayments/http';

export const GET = withAuth(async (request: NextRequest, user) => {
  try {
    const params = request.nextUrl.searchParams;
    const data = params.get('action') === 'targets'
      ? await searchTransferTargets(user, (params.get('search') || '').slice(0, 191)) : await listPrepaymentCredits(user);
    const response = createApiSuccessResponse({ data }, request);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) { return prepaymentUiErrorResponse(error); }
});

export const POST = withRole('ADMIN', async (request: NextRequest, user) => {
  try { return createApiSuccessResponse({ data: await transferPrepayment(user, await parseJsonRequest(request)) }, request); }
  catch (error) { return prepaymentUiErrorResponse(error); }
});
