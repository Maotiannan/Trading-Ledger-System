import { NextRequest } from 'next/server';
import { parseJsonRequest } from '@/lib/http-body';
import { withCreditV2 } from '@/lib/integrations/collaboration-credit-v2-http';
import { writeCreditRecordV2 } from '@/lib/integrations/collaboration-credit-v2';

export async function POST(request: NextRequest, context: { params: Promise<{ creditRecordId: string }> }) {
  return withCreditV2(request, 'write', async (_secret, principalId) => writeCreditRecordV2(
    (await context.params).creditRecordId, await parseJsonRequest(request), principalId));
}
