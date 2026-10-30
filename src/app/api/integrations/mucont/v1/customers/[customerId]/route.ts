import { NextRequest } from 'next/server';
import { withMucontCustomerRead } from '@/lib/integrations/mucont-customer-http';
import { readMucontCustomerProfile } from '@/lib/integrations/mucont-customer-service';

export async function GET(request: NextRequest, context: { params: Promise<{ customerId: string }> }) {
  return withMucontCustomerRead(request, async () => readMucontCustomerProfile((await context.params).customerId));
}
