import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withRole } from '@/lib/route-auth';
import { parseJsonRequest } from '@/lib/http-body';
import { toApiErrorResponse, createApiErrorResponse } from '@/lib/api-error-response';
import { activateWhatsAppTemplate, listWhatsAppTemplateVersions, refreshWhatsAppTemplate, saveWhatsAppDraft, submitWhatsAppTemplate } from '@/lib/whatsapp/whatsapp-template-service';
import { templateVariables } from '@/lib/whatsapp/whatsapp-template-definition';
const actionSchema = z.object({ action: z.enum(['submit', 'refresh', 'activate']), name: z.string().regex(/^muledger_[a-z0-9_]+$/).max(100), language: z.enum(['en', 'fr']) });
export const GET = withRole('ADMIN', async request => {
  try { return NextResponse.json({ success: true, data: { templates: await listWhatsAppTemplateVersions(), variables: templateVariables } }); }
  catch (error) { return toApiErrorResponse(error, { status: 500, message: '' }, request); }
});
export const POST = withRole('ADMIN', async (request, actor) => {
  try {
    const body = await parseJsonRequest<Record<string, unknown>>(request);
    if (body.action === 'save') return NextResponse.json({ success: true, data: await saveWhatsAppDraft(actor, body.draft) });
    const input = actionSchema.safeParse(body);
    if (!input.success) return createApiErrorResponse({ code: 'BAD_REQUEST', status: 400, message: '' }, request);
    const methods = { submit: submitWhatsAppTemplate, refresh: refreshWhatsAppTemplate, activate: activateWhatsAppTemplate };
    return NextResponse.json({ success: true, data: await methods[input.data.action](actor, input.data.name, input.data.language) });
  } catch (error) { return toApiErrorResponse(error, { status: 500, message: '' }, request); }
});
