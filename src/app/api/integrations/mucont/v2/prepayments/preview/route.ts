import { prepaymentEndpoint } from '@/lib/prepayments/http';
import { previewPrepayments } from '@/lib/prepayments/service';
export async function POST(request: Request) { return prepaymentEndpoint(request, async () => previewPrepayments(await request.json())); }
