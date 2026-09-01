import {
  EMAIL_TEMPLATE_DEFINITIONS,
  getDefaultEmailTemplate,
  getEmailTemplateVariableCatalog,
} from '@/lib/email/email-template-catalog';
import { renderEmailTemplate, validateEmailTemplate } from '@/lib/email/email-template-renderer';

describe('email template catalog and renderer', () => {
  it('defines one English and French default for every supported event', () => {
    expect(EMAIL_TEMPLATE_DEFINITIONS).toHaveLength(6);
    expect(new Set(EMAIL_TEMPLATE_DEFINITIONS.map((item) => `${item.type}:${item.language}`)).size).toBe(6);
    expect(getDefaultEmailTemplate('PAYMENT_RECEIVED', 'ENGLISH').subjectTemplate).toContain('{{receiptNo}}');
    expect(getDefaultEmailTemplate('RELEASE', 'FRENCH').bodyTemplate).toContain('{{releaseDate}}');
    expect(getEmailTemplateVariableCatalog('SHIPMENT')).toEqual(expect.arrayContaining([
      'customerName',
      'mark',
      'orderNos',
      'invoiceNo',
      'shipmentDate',
    ]));
  });

  it('rejects missing required variables and unknown placeholders', () => {
    const template = getDefaultEmailTemplate('PAYMENT_RECEIVED', 'ENGLISH');

    expect(() => validateEmailTemplate({
      ...template,
      bodyTemplate: template.bodyTemplate.replace('{{amount}}', 'the payment'),
    })).toThrow(/amount/i);
    expect(() => validateEmailTemplate({
      ...template,
      bodyTemplate: `${template.bodyTemplate}\n{{password}}`,
    })).toThrow(/password/i);
  });

  it('escapes customer-controlled values inside a fixed email-safe shell', () => {
    const template = getDefaultEmailTemplate('PAYMENT_RECEIVED', 'ENGLISH');
    const result = renderEmailTemplate({
      ...template,
      id: 'template-1',
      version: 3,
    }, {
      customerName: '<img src=x onerror=alert(1)>',
      mark: 'MAB & CO',
      orderNos: 'MAB-1/MARY-01',
      receiptNo: '0010000',
      amount: '$10,000',
      paymentDate: '01/09/2026',
    }, {
      logoUrl: 'https://muledger.dainty.vip/logo.svg',
    });

    expect(result.subject).toContain('0010000');
    expect(result.html).toContain('https://muledger.dainty.vip/logo.svg');
    expect(result.html).toContain('max-width:600px');
    expect(result.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(result.html).toContain('MAB &amp; CO');
    expect(result.html).not.toContain('<img src=x onerror=alert(1)>');
    expect(result.text).toContain('<img src=x onerror=alert(1)>');
    expect(result.text).toContain('MAB-1/MARY-01');
    expect(result.variables).toEqual(expect.arrayContaining(['customerName', 'receiptNo', 'amount']));
    expect(result.templateVersion).toBe(3);
  });

  it('requires every rendered placeholder value and an approved HTTPS logo', () => {
    const template = getDefaultEmailTemplate('SHIPMENT', 'FRENCH');

    expect(() => renderEmailTemplate({ ...template, version: 1 }, {
      customerName: 'Client',
      mark: 'CL',
      orderNos: 'CL-01',
      invoiceNo: 'L26MH000001',
    }, { logoUrl: 'https://muledger.dainty.vip/logo.svg' })).toThrow(/shipmentDate/i);

    expect(() => renderEmailTemplate({ ...template, version: 1 }, {
      customerName: 'Client',
      mark: 'CL',
      orderNos: 'CL-01',
      invoiceNo: 'L26MH000001',
      shipmentDate: '01/09/2026',
    }, { logoUrl: 'http://example.com/logo.svg' })).toThrow(/HTTPS/i);
  });
});
