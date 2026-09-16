import { z } from 'zod';
import { db } from '@/lib/db';
const schema = z.object({
  outboundEnabled: z.boolean().default(false),
  testMode: z.boolean().default(true),
  testDestination: z.string().regex(/^\+[1-9]\d{1,14}$/).default('+8613619767412'),
  activatedAt: z.string().datetime().nullable().default(null),
  enabledTypes: z.array(z.enum(['PAYMENT_RECEIVED', 'SHIPMENT', 'RELEASE'])).default(['PAYMENT_RECEIVED', 'SHIPMENT', 'RELEASE']),
});
export const WHATSAPP_SETTINGS_KEY = 'whatsapp.notifications';
export async function getWhatsAppSettings() {
  const row = await db.systemSetting.findUnique({ where: { key: WHATSAPP_SETTINGS_KEY } });
  return schema.parse(row ? JSON.parse(row.value) : {});
}
export function parseWhatsAppSettings(value: unknown) { return schema.parse(value); }
