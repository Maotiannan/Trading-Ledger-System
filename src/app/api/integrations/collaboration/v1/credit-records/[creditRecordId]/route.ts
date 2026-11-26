import { NextRequest } from 'next/server';
import { withCollaborationCreditRead } from '@/lib/integrations/collaboration-credit-http';
import { readCollaborationCreditRecord } from '@/lib/integrations/collaboration-credit-service';

export async function GET(request: NextRequest, context: { params: Promise<{ creditRecordId: string }> }) {
  return withCollaborationCreditRead(request, async () => readCollaborationCreditRecord((await context.params).creditRecordId));
}
