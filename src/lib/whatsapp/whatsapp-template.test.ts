import { renderWhatsAppSnapshot, whatsAppTemplates } from './whatsapp-template';
const source = { customerName: 'Customer', language: 'ENGLISH', orderNos: ['AB-1'], invoiceNo: 'INV', receiptNo: 'R1', amount: 10000, orderBalance: 3674, shipmentDate: '2026-09-15T00:00:00Z' };
it('renders the shared snapshot balance without recalculating financial values', () => {
  const result = renderWhatsAppSnapshot('PAYMENT_RECEIVED', source);
  expect(result.parameters).toEqual(['Customer', 'R1', 'AB-1', 'INV', '10,000', '3,674', '15/09/2026', 'Not recorded']);
  expect(result.preview).toContain('3,674');
});
it('has eight Utility templates with exact variable counts', () => {
  expect(whatsAppTemplates).toHaveLength(8);
  for (const template of whatsAppTemplates) {
    expect(template.category).toBe('UTILITY');
    const type = template.name.includes('correction') ? 'CORRECTION' : template.name.includes('payment') ? 'PAYMENT_RECEIVED' : template.name.includes('shipment') ? 'SHIPMENT' : 'RELEASE';
    const result = renderWhatsAppSnapshot(type, { ...source, language: template.language === 'fr' ? 'FRENCH' : 'ENGLISH' });
    expect(result.preview).not.toMatch(/{{\d+}}/);
  }
});
it('rejects oversized values rather than sending incorrect/truncated orders', () => {
  expect(() => renderWhatsAppSnapshot('SHIPMENT', { ...source, orderNos: ['X'.repeat(1025)] })).toThrow();
});
