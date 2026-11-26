import { NextRequest } from 'next/server';
import { withCollaborationCreditRead } from '@/lib/integrations/collaboration-credit-http';
import { listCollaborationCreditRecords } from '@/lib/integrations/collaboration-credit-service';

export async function GET(request: NextRequest) {
  return withCollaborationCreditRead(request, secret => listCollaborationCreditRecords(new URL(request.url).searchParams, secret));
}
