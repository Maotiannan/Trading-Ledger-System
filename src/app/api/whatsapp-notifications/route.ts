import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withRole } from '@/lib/route-auth';
import { parseJsonRequest } from '@/lib/http-body';
import { runWhatsAppTransaction as runInTransaction } from '@/lib/whatsapp/whatsapp-transaction';
import { approveWhatsAppTestInTransaction, cancelWhatsAppInTransaction } from '@/lib/whatsapp/whatsapp-queue';
import { refreshWhatsAppInTransaction } from '@/lib/whatsapp/whatsapp-refresh';
import { listWhatsAppTemplateVersions } from '@/lib/whatsapp/whatsapp-template-service';
import { createApiErrorResponse, toApiErrorResponse } from '@/lib/api-error-response';
import { apiErrorCodes } from '@/lib/api-error';
const pagination = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(5).max(50).default(20),
});
const approval = z.object({ action: z.enum(['approve', 'cancel']), ids: z.array(z.string().min(1).max(191)).min(1).max(50), expectedUpdatedAt: z.string().datetime().optional() });
function invalid(request: NextRequest) {
  return createApiErrorResponse({ code: apiErrorCodes.BAD_REQUEST, status: 400, message: '' }, request);
}
export const GET = withRole(UserRole.ADMIN, async (request: NextRequest) => {
  const parsed = pagination.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return invalid(request);
  const { page, pageSize } = parsed.data;
  try {
    const templates = await listWhatsAppTemplateVersions();
    const pending = await db.whatsAppDelivery.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: pageSize, skip: (page - 1) * pageSize, select: { id: true } });
    for (const row of pending) await runInTransaction(tx => refreshWhatsAppInTransaction(tx, row.id, templates));
    const [items, total] = await db.$transaction([
      db.whatsAppDelivery.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, select: {
        id: true, type: true, status: true, testMode: true, intendedTo: true, actualTo: true,
        templateName: true, languageCode: true, parameters: true, businessSnapshot: true, createdAt: true,
        approvedAt: true, providerMessageId: true, failureCode: true, nextSendAt: true, requiresApproval: true, correctionOf: true, updatedAt: true,
      } }),
      db.whatsAppDelivery.count(),
    ]);
    return NextResponse.json({ success: true, data: { items, page, pageSize, total } });
  } catch {
    return createApiErrorResponse({ code: apiErrorCodes.INTERNAL_ERROR, status: 500, message: '' }, request);
  }
});

export const POST = withRole(UserRole.ADMIN, async (request: NextRequest, currentUser) => {
  try {
    const parsed = approval.safeParse(await parseJsonRequest(request));
    if (!parsed.success) return invalid(request);
    if (parsed.data.action === 'approve' && (!parsed.data.expectedUpdatedAt || parsed.data.ids.length !== 1)) return invalid(request);
    const templates = parsed.data.action === 'approve' ? await listWhatsAppTemplateVersions() : [];
    const approved = await runInTransaction(async (tx) => {
      let count = 0;
      for (const id of new Set(parsed.data.ids)) {
        if (parsed.data.action === 'cancel') {
          count += (await cancelWhatsAppInTransaction(tx, id, currentUser)).count;
        } else {
          const current = await refreshWhatsAppInTransaction(tx, id, templates);
          if (!current || current.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt) continue;
          count += (await approveWhatsAppTestInTransaction(tx, id, currentUser)).count;
        }
      }
      return count;
    });
    if (!approved) return createApiErrorResponse({ code: apiErrorCodes.CONFLICT, status: 409, message: '' }, request);
    return NextResponse.json({ success: true, data: parsed.data.action === 'cancel' ? { cancelled: approved } : { approved } });
  } catch (error) {
    return toApiErrorResponse(error, { code: apiErrorCodes.INTERNAL_ERROR, status: 500, message: '' }, request);
  }
});
