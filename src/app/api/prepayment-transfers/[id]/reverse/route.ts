import { NextRequest } from 'next/server';
import { withRole } from '@/lib/route-auth';
import { parseJsonRequest } from '@/lib/http-body';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { reversePrepaymentTransfer } from '@/lib/prepayments/transfers';
import { prepaymentUiErrorResponse } from '@/lib/prepayments/http';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return withRole('ADMIN', async (req, user) => {
    try { return createApiSuccessResponse({ data: await reversePrepaymentTransfer(user, id, await parseJsonRequest(req)) }, req); }
    catch (error) { return prepaymentUiErrorResponse(error); }
  })(request);
}
