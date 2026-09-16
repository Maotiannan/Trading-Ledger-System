import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withRole } from '@/lib/route-auth';
import { db } from '@/lib/db';
import { customerAccessWhere } from '@/lib/customer-scope';
import { parseJsonRequest } from '@/lib/http-body';
import { createApiErrorResponse } from '@/lib/api-error-response';
import { apiErrorCodes } from '@/lib/api-error';
import { runWhatsAppTransaction as runInTransaction } from '@/lib/whatsapp/whatsapp-transaction';
const inputSchema = z.object({ customerId: z.string().min(1), phone: z.string().regex(/^\+[1-9]\d{1,14}$/), optIn: z.boolean(), consentSource: z.string().trim().min(1).max(255) });
export const GET = withRole(['ADMIN', 'SALES'], async (request, user) => {
  try {
    const search = request.nextUrl.searchParams.get('search')?.trim() || '';
    const customers = await db.customer.findMany({
      where: { ...customerAccessWhere(user), OR: [{ mark: { contains: search } }, { orderName: { contains: search } }, { name: { contains: search } }] },
      take: 50, orderBy: { mark: 'asc' }, select: { id: true, mark: true, name: true, orderName: true, whatsappContacts: true },
    });
    return NextResponse.json({ success: true, data: customers });
  } catch {
    return createApiErrorResponse({ code: apiErrorCodes.INTERNAL_ERROR, status: 500, message: '' }, request);
  }
});
export const POST = withRole(['ADMIN', 'SALES'], async (request, user) => {
  try {
    const input = inputSchema.safeParse(await parseJsonRequest(request));
    if (!input.success) return createApiErrorResponse({ code: apiErrorCodes.BAD_REQUEST, status: 400, message: '' }, request);
    const customer = await db.customer.findFirst({ where: { ...customerAccessWhere(user), id: input.data.customerId }, select: { id: true } });
    if (!customer) return createApiErrorResponse({ code: apiErrorCodes.RESOURCE_NOT_FOUND, status: 404, message: '' }, request);
    const data = await runInTransaction(async tx => {
      const { phone, consentSource, optIn } = input.data;
      const existing = await tx.customerWhatsAppContact.findUnique({ where: { customerId_phone: { customerId: customer.id, phone } } });
      const values = { consentSource, updatedBy: user.id, ...(optIn ? { optedInAt: existing?.optedInAt && !existing.optedOutAt ? existing.optedInAt : new Date(), optedOutAt: null } : { optedOutAt: new Date() }) };
      const row = await tx.customerWhatsAppContact.upsert({ where: { customerId_phone: { customerId: customer.id, phone } }, create: { customerId: customer.id, phone, ...values }, update: values });
      if (!optIn) await tx.whatsAppDelivery.updateMany({ where: { contactId: row.id, status: { in: ['PENDING', 'QUEUED'] } }, data: { status: 'CANCELLED', failureCode: 'CONSENT_REVOKED' } });
      await tx.auditLog.create({ data: { action: 'WHATSAPP_CONSENT_CHANGED', actorId: user.id, targetType: 'CUSTOMER', targetId: customer.id, metadata: { contactId: row.id, before: Boolean(existing?.optedInAt && !existing.optedOutAt), after: optIn, consentSource } } });
      return row;
    });
    return NextResponse.json({ success: true, data });
  } catch {
    return createApiErrorResponse({ code: apiErrorCodes.BAD_REQUEST, status: 400, message: '' }, request);
  }
});
