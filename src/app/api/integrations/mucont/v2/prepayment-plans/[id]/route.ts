import { prepaymentEndpoint } from '@/lib/prepayments/http';
import { readPrepaymentPlan } from '@/lib/prepayments/service';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return prepaymentEndpoint(request, async () => readPrepaymentPlan({ planId: (await context.params).id }));
}
