import { NextRequest } from 'next/server';
import { withMucontCustomerRead } from '@/lib/integrations/mucont-customer-http';
import { listMucontCustomerOptions } from '@/lib/integrations/mucont-customer-service';

export async function GET(request: NextRequest) {
  return withMucontCustomerRead(request, (secret) => listMucontCustomerOptions(new URL(request.url).searchParams, secret));
}
