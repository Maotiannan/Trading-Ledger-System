import { draftSchema, defaultTemplateVersions, selectTemplateVersions, templatePayload } from './whatsapp-template-definition';
import { renderWhatsAppSnapshot } from './whatsapp-template';
const builtin = defaultTemplateVersions()[0];
it('validates all six defaults and keeps the payload Utility-only', () => {
  for (const version of defaultTemplateVersions()) {
    expect(draftSchema.safeParse(version).success).toBe(true);
    expect(templatePayload(version).category).toBe('UTILITY');
  }
});
it.each(['No variables', '{{1}} {{9}}', '{{customer}}', '{{01}} {{2}} {{3}} {{4}} {{5}} {{6}} {{7}} {{8}}'])('rejects invalid variable mapping: %s', body => {
  expect(draftSchema.safeParse({ ...builtin, body }).success).toBe(false);
});
it('does not replace the active default with a draft; activation changes new messages only', () => {
  const draft = { ...builtin, name: 'muledger_payment_new', body: builtin.body + '\nThank you.', status: 'DRAFT', active: false, createdAt: '2026-09-16' };
  expect(selectTemplateVersions([draft]).find(item => item.name === builtin.name && item.language === builtin.language)?.active).toBe(true);
  const selected = selectTemplateVersions([{ ...draft, active: true, status: 'APPROVED' }]);
  expect(selected.find(item => item.name === builtin.name && item.language === builtin.language)?.active).toBe(false);
  expect(selected.find(item => item.name === builtin.name && item.language === builtin.language)?.body).toBe(builtin.body);
  const result = renderWhatsAppSnapshot('PAYMENT_RECEIVED', { customerName: 'Client', language: 'ENGLISH', orderNos: ['AB-1'], invoiceNo: 'INV', amount: 100 }, selected);
  expect(result.templateName).toBe(draft.name);
  expect(result.preview).toContain('Thank you.');
});
