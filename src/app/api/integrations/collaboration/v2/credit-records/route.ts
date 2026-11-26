import { NextRequest } from 'next/server';
import { withCreditV2 } from '@/lib/integrations/collaboration-credit-v2-http';
import { listCreditRecordsV2 } from '@/lib/integrations/collaboration-credit-v2';

export async function GET(request: NextRequest) {
  return withCreditV2(request, 'read', secret => listCreditRecordsV2(new URL(request.url).searchParams, secret));
}
