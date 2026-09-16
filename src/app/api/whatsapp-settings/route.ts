import { NextResponse } from 'next/server';
import { withRole } from '@/lib/route-auth';
import { getWhatsAppSettings, parseWhatsAppSettings, WHATSAPP_SETTINGS_KEY } from '@/lib/whatsapp/whatsapp-settings';
import { whatsAppTemplates } from '@/lib/whatsapp/whatsapp-template';
import { runWhatsAppTransaction as runInTransaction } from '@/lib/whatsapp/whatsapp-transaction';
import { parseJsonRequest } from '@/lib/http-body';
import { createApiErrorResponse } from '@/lib/api-error-response';
import { apiErrorCodes } from '@/lib/api-error';
export const GET = withRole('ADMIN', async request => {
  try { return NextResponse.json({ success: true, data: {
    settings: await getWhatsAppSettings(), templates: whatsAppTemplates,
    deploymentEnabled: process.env.WHATSAPP_OUTBOUND_ENABLED === 'true' && Boolean(process.env.YCLOUD_API_KEY),
  } }); }
  catch { return createApiErrorResponse({ code: apiErrorCodes.INTERNAL_ERROR, status: 500, message: '' }, request); }
});
export const POST = withRole('ADMIN', async (request, user) => {
  try {
    const input = parseWhatsAppSettings(await parseJsonRequest(request));
    const settings = await runInTransaction(async tx => {
      const old = await tx.systemSetting.findUnique({ where: { key: WHATSAPP_SETTINGS_KEY } });
      const previous = parseWhatsAppSettings(old ? JSON.parse(old.value) : {});
      // Switching mode starts a new event window; unprojected test-period events
      // must not become production deliveries.
      const activatedAt = previous.testMode !== input.testMode
        ? (input.outboundEnabled ? new Date().toISOString() : null)
        : previous.activatedAt || (input.outboundEnabled ? new Date().toISOString() : null);
      const next = { ...input, activatedAt };
      await tx.systemSetting.upsert({ where: { key: WHATSAPP_SETTINGS_KEY }, create: { key: WHATSAPP_SETTINGS_KEY, value: JSON.stringify(next), updatedBy: user.id }, update: { value: JSON.stringify(next), updatedBy: user.id } });
      await tx.auditLog.create({ data: { action: 'WHATSAPP_SETTINGS_CHANGED', actorId: user.id, targetType: 'SYSTEM', targetId: WHATSAPP_SETTINGS_KEY, metadata: { before: previous, after: next } } });
      return next;
    });
    return NextResponse.json({ success: true, data: settings });
  } catch { return createApiErrorResponse({ code: apiErrorCodes.BAD_REQUEST, status: 400, message: '' }, request); }
});
