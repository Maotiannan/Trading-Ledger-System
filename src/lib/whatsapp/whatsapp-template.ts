import { z } from 'zod';
import templates from './templates.json';
import { formatAppDate } from '@/lib/app-time';
import type { TemplateVersion } from './whatsapp-template-definition';

const snapshotSchema = z.object({
  customerName: z.string(), language: z.string(), orderNos: z.array(z.string()),
  invoiceNo: z.string().nullable(), receiptNo: z.string().optional(),
  amount: z.number().optional(), orderBalance: z.number().nullable().optional(),
  shipmentDate: z.string().optional(), releaseDate: z.string().optional(),
});
const clean = (value: string) => value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
const amount = (value: number | null | undefined) => value == null ? '-' : Math.round(value).toLocaleString('en-US');
export function renderWhatsAppSnapshot(type: string, input: unknown, versions?: TemplateVersion[]) {
  const snapshot = snapshotSchema.parse(input);
  const languageCode = snapshot.language === 'FRENCH' ? 'fr' : 'en';
  const kind = ({ PAYMENT_RECEIVED: 'payment', SHIPMENT: 'shipment', RELEASE: 'release' } as Record<string, string>)[type];
  if (!kind) throw new Error('Unsupported notification type.');
  const template = templates.find(item => item.name === 'muledger_' + kind + '_v1' && item.language === languageCode)!;
  const missing = languageCode === 'fr' ? 'Non renseigné' : 'Not recorded';
  const parameters = (kind === 'payment'
    ? [snapshot.customerName, snapshot.receiptNo || '-', snapshot.orderNos.join(' / '), snapshot.invoiceNo || missing,
      amount(snapshot.amount), amount(snapshot.orderBalance), formatAppDate(snapshot.shipmentDate, missing), formatAppDate(snapshot.releaseDate, missing)]
    : [snapshot.customerName, snapshot.invoiceNo || missing, snapshot.orderNos.join(' / '), formatAppDate(kind === 'shipment' ? snapshot.shipmentDate : snapshot.releaseDate, missing)]
  ).map(clean);
  if (parameters.some(value => !value || value.length > 1024)) throw new Error('Notification fields require correction.');
  const selected = versions?.find(item => item.kind === kind && item.language === languageCode && item.active);
  const body = selected?.body || template.components.find(item => item.type === 'BODY')!.text;
  return { templateName: selected?.name || template.name, languageCode, parameters,
    preview: body.replace(/{{(\d+)}}/g, (_, index) => parameters[Number(index) - 1]) };
}
export { templates as whatsAppTemplates };
