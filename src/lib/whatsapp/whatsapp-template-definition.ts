import { reminderKinds, reminderBodies } from './outstanding-reminder-copy';
import { z } from 'zod';
import defaults from './templates.json';
export const templateKinds = ['payment', 'shipment', 'release', 'correction', ...reminderKinds] as const;
export const templateVariables = {
  outstanding30: ['customerName', 'overdueBalance', 'oldestOrder', 'days'],
  outstanding60: ['customerName', 'overdueBalance', 'oldestOrder', 'days'],
  outstanding120: ['customerName', 'overdueBalance', 'oldestOrder', 'days'],
  outstanding180: ['customerName', 'overdueBalance', 'oldestOrder', 'days'],
  payment: ['customerName', 'receiptNo', 'orderNos', 'invoiceNo', 'amount', 'orderBalance', 'shipmentDate', 'releaseDate'],
  shipment: ['customerName', 'invoiceNo', 'orderNos', 'shipmentDate'],
  release: ['customerName', 'invoiceNo', 'orderNos', 'releaseDate'],
  correction: ['customerName', 'receiptNos', 'orderNos', 'invoiceNo', 'reason', 'currentBalance'],
} as const;
export const draftSchema = z.object({
  kind: z.enum(templateKinds), language: z.enum(['en', 'fr']),
  sampleImageUrl: z.string().url().regex(/^https:\/\//).optional(),
  title: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1).max(1024),
  footer: z.string().trim().max(60),
}).superRefine((draft, context) => {
  if (draft.kind.startsWith('outstanding') && draft.language !== 'fr') {
    context.addIssue({ code: 'custom', message: 'Outstanding reminders must use French.' });
  }
  const tokens = Array.from(draft.body.matchAll(/{{(\d+)}}/g), match => Number(match[1]));
  const expected = templateVariables[draft.kind].map((_, index) => index + 1);
  if (JSON.stringify([...new Set(tokens)].sort((a,b) => a-b)) !== JSON.stringify(expected)
    || /[{}]/.test(draft.body.replace(/{{[1-9]\d*}}/g, ''))
    || /[{}\r\n]/.test(draft.title + draft.footer)) {
    context.addIssue({ code: 'custom', message: 'Keep the documented numbered variables. Title/footer cannot contain variables or line breaks.' });
  }
});
export type TemplateDraft = z.infer<typeof draftSchema>;
export type TemplateVersion = TemplateDraft & {
  name: string; status: string; category: string; active: boolean; createdAt: string;
};
export const templatePrefix = 'whatsapp.template.';
export function templateKey(name: string, language: string) { return templatePrefix + name + '.' + language; }
export function defaultTemplateVersions(): TemplateVersion[] {
  return [...defaults.map(template => ({
    name: template.name, kind: template.name.split('_')[1] as TemplateDraft['kind'],
    language: template.language as TemplateDraft['language'],
    title: template.components.find(part => part.type === 'HEADER')!.text,
    body: template.components.find(part => part.type === 'BODY')!.text,
    footer: template.components.find(part => part.type === 'FOOTER')!.text,
    status: 'UNKNOWN', category: 'UTILITY', active: true, createdAt: '',
  })), ...reminderKinds.map(kind => ({
    name: 'muledger_' + kind + '_v1', kind, language: 'fr' as const, title: 'Relevé de compte', body: reminderBodies[kind],
    footer: 'MU Group', status: 'DRAFT', category: 'UTILITY', active: false, createdAt: '',
  }))];
}
export function templatePayload(template: TemplateVersion) {
  const example = templateExampleValues(template.kind);
  return {
    name: template.name, language: template.language, category: 'UTILITY',
    messageSendTtlSeconds: 43200,
    components: [
      template.kind.startsWith('outstanding')
        ? { type: 'HEADER', format: 'IMAGE', example: { header_url: [template.sampleImageUrl || ''] } }
        : { type: 'HEADER', format: 'TEXT', text: template.title },
      { type: 'BODY', text: template.body, example: { body_text: [example] } },
      ...(template.footer ? [{ type: 'FOOTER', text: template.footer }] : []),
    ],
  };
}
export function templateExampleValues(kind: TemplateDraft['kind']) {
  if (kind.startsWith('outstanding')) return ['Example Customer', '1,250', 'TEST-01', '60'];
  return kind === 'correction' ? ['Example Customer', 'TEST-001', 'TEST-01', 'TEST-INV', 'Receipt record cancelled; this is not a new payment.', '700'] : kind === 'payment'
    ? ['Example Customer', 'TEST-001', 'TEST-01', 'TEST-INV', '100', '900', '15/09/2026', '15/09/2026']
    : ['Example Customer', 'TEST-INV', 'TEST-01', '15/09/2026'];
}
export function selectTemplateVersions(stored: TemplateVersion[]) {
  const combined = new Map(defaultTemplateVersions().map(item => [templateKey(item.name, item.language), item]));
  for (const item of stored) combined.set(templateKey(item.name, item.language), item);
  const all = [...combined.values()];
  // A custom active version replaces the built-in for its slot, not its history.
  return all.map(item => ({ ...item, active: item.active && !(item.createdAt === '' && all.some(other =>
    other.createdAt !== '' && other.active && other.kind === item.kind && other.language === item.language)) }));
}
