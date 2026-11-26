import { prepaymentEndpoint } from '@/lib/prepayments/http';
import { readPrepaymentPlan, reservePrepayments } from '@/lib/prepayments/service';
export async function POST(request: Request) { return prepaymentEndpoint(request, async () => reservePrepayments(await request.json())); }
export async function GET(request: Request) { return prepaymentEndpoint(request, async () => readPrepaymentPlan({ requestId: new URL(request.url).searchParams.get('requestId') || '' })); }
