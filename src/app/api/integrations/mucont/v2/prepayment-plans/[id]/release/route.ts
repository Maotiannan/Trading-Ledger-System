import { prepaymentEndpoint } from '@/lib/prepayments/http';
import { releasePrepaymentPlan } from '@/lib/prepayments/service';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return prepaymentEndpoint(request, async () => releasePrepaymentPlan((await context.params).id, await request.json()));
}
