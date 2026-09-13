import {
  EMAIL_TEMPLATE_DEFINITIONS,
  getDefaultEmailTemplate,
  getEmailTemplatePreviewContext,
  getEmailTemplateVariableCatalog,
} from '@/lib/email/email-template-catalog';
import { renderEmailTemplate, validateEmailTemplate } from '@/lib/email/email-template-renderer';

describe('email template catalog and renderer', () => {
  it('uses semantic font hierarchy without changing plain-text business content', () => {
    const template = { ...getDefaultEmailTemplate('PAYMENT_RECEIVED', 'ENGLISH'), version: 1 };
    const result = renderEmailTemplate(template, getEmailTemplatePreviewContext('PAYMENT_RECEIVED'), {
      logoUrl: 'https://example.com/logo.png',
    });
    expect(result.html).toContain('font-size:20px;font-weight:700;color:#172033;">$3,674</strong>');
    expect(result.html).toContain('font-size:16px;font-weight:700;color:#172033;">PIKIN-20</strong>');
    expect(result.html).toContain('font-size:13px;line-height:1.5;color:#5d6b82;">ORDER NO:</span>');
    expect(result.text).toContain('ORDER NO: PIKIN-20');
    expect(result.text).toContain('ORDER BALANCE AFTER PAYMENT: $3,674');
  });
  it.each(['ENGLISH', 'FRENCH'] as const)('renders payment order context and missing-value placeholders in %s', (language) => {
    const template = { ...getDefaultEmailTemplate('PAYMENT_RECEIVED', language), version: 1 };
    const context = getEmailTemplatePreviewContext('PAYMENT_RECEIVED');
    const options = { logoUrl: 'https://example.com/logo.png' };
    const result = renderEmailTemplate(template, context, options);
    expect(result.text).toContain('$3,674');
    expect(result.text).toContain('L26MH000001');
    expect(result.text).toContain('15/09/2026');
    const missing = { ...context };
    delete missing.invoiceNo; delete missing.orderBalance; delete missing.shipmentDate; delete missing.releaseDate;
    const absent = renderEmailTemplate(template, missing, options);
    expect(absent.text.match(/—/g)).toHaveLength(4);
    expect(() => validateEmailTemplate({ ...template,
      bodyTemplate: '{{customerName}} {{mark}} {{orderNos}} {{receiptNo}} {{amount}} {{paymentDate}}',
    })).not.toThrow();
  });

  it('uses edited contact values, escapes markup and leaves previous rendered snapshots unchanged', () => {
    const template = { ...getDefaultEmailTemplate('PAYMENT_RECEIVED', 'ENGLISH'), version: 1 };
    const context = getEmailTemplatePreviewContext(template.type);
    const before = renderEmailTemplate(template, context, { logoUrl: 'https://example.com/logo.png' });
    const after = renderEmailTemplate(template, context, {
      logoUrl: 'https://example.com/logo.png', contactName: '<b>New contact</b>',
      companyAddress: '<script>alert(1)</script>\nNew address',
      contactEmail: 'new@example.com', contactPhone: '+224 620 11 22 33',
      whatsappUrl: 'https://wa.me/224620112233',
    });
    expect(after.html).toContain('&lt;b&gt;New contact&lt;/b&gt;');
    expect(after.html).not.toContain('<script>');
    expect(after.html).toContain('href="mailto:new@example.com"');
    expect(after.html).toContain('href="tel:+224620112233"');
    expect(after.text).toContain('New address');
    expect(before.html).toContain('Leo Mao');
    expect(before.html).not.toContain('new@example.com');
  });

  it.each(EMAIL_TEMPLATE_DEFINITIONS)('adds the shared contact block to $type/$language', (template) => {
    const result = renderEmailTemplate({ ...template, version: 1 }, getEmailTemplatePreviewContext(template.type), {
      logoUrl: 'https://muledger.dainty.vip/logo.svg',
    });
    expect(result.html).toContain('Leo Mao');
    expect(result.html).toContain('href="tel:+8613819858718"');
    expect(result.html).toContain('href="https://wa.me/+8613819858718"');
    expect(result.html).toContain('href="mailto:maotiannan@gmail.com"');
    expect(result.html).toContain('font-size:16px');
    expect(result.html).toContain('table-layout:fixed');
    expect(result.text).toContain('MU Group');
    expect(result.text).toContain('No. 2506, Yongjiang Avenue, Yinzhou District,');
    expect(result.text).toContain('Ningbo City, Zhejiang Province');
    expect(result.text).toContain('https://wa.me/+8613819858718');
    expect(result.text).toContain(template.language === 'FRENCH'
      ? 'Cette adresse d’expédition ne reçoit pas de messages.'
      : 'This sending address does not accept incoming emails.');
  });

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
    expect(result.html).toContain('@media only screen and (max-width:480px)');
    expect(result.html).toContain('.email-logo { width: 170px');
    expect(result.html).toContain('.email-body-wrap { padding: 8px 12px 18px');
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
