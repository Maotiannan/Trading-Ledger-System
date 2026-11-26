import { NextRequest } from 'next/server';
import { withCreditV2 } from '@/lib/integrations/collaboration-credit-v2-http';
import { readCreditRecordV2 } from '@/lib/integrations/collaboration-credit-v2';

export async function GET(request: NextRequest, context: { params: Promise<{ creditRecordId: string }> }) {
  return withCreditV2(request, 'read', async () => readCreditRecordV2((await context.params).creditRecordId));
}
