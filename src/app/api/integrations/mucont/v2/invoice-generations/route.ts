import { prepaymentEndpoint } from '@/lib/prepayments/http';
import { acceptPrepaymentGeneration } from '@/lib/prepayments/generation';
export async function POST(request: Request) { return prepaymentEndpoint(request, async () => acceptPrepaymentGeneration(await request.json())); }
