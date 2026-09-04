import {
  EMAIL_TEMPLATE_VARIABLES,
  type CustomerEmailLanguageValue,
  type EmailNotificationTypeValue,
  type EmailRenderContext,
  type EmailTemplateVariable,
} from '@/lib/email/email-types';
import { getEmailTemplateVariableCatalog } from '@/lib/email/email-template-catalog';

const PLACEHOLDER = /{{\s*([^{}]+?)\s*}}/g;
const SUBJECT_MAX_LENGTH = 500;
const BODY_MAX_LENGTH = 50_000;
const KNOWN_VARIABLES = new Set<string>(EMAIL_TEMPLATE_VARIABLES);

export type RenderableEmailTemplate = {
  id?: string | null;
  type: EmailNotificationTypeValue;
  language: CustomerEmailLanguageValue;
  version: number;
  subjectTemplate: string;
  bodyTemplate: string;
  requiredVariables?: EmailTemplateVariable[];
};

export type EmailTemplateValidationInput = Omit<RenderableEmailTemplate, 'version'> & {
  version?: number;
};

function extractVariables(value: string): EmailTemplateVariable[] {
  const variables: EmailTemplateVariable[] = [];
  const seen = new Set<string>();
  for (const match of value.matchAll(PLACEHOLDER)) {
    const variable = match[1].trim();
    if (!KNOWN_VARIABLES.has(variable)) {
      throw new Error(`Unknown email template variable: ${variable}`);
    }
    if (!seen.has(variable)) {
      seen.add(variable);
      variables.push(variable as EmailTemplateVariable);
    }
  }
  if (value.includes('{{') || value.includes('}}')) {
    const stripped = value.replace(PLACEHOLDER, '');
    if (stripped.includes('{{') || stripped.includes('}}')) {
      throw new Error('Malformed email template placeholder.');
    }
  }
  return variables;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function requireContextValue(context: EmailRenderContext, variable: EmailTemplateVariable): string {
  const value = context[variable];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing email render value: ${variable}`);
  }
  return value.trim();
}

function renderText(template: string, context: EmailRenderContext): string {
  return template.replace(PLACEHOLDER, (_match, rawVariable: string) => (
    requireContextValue(context, rawVariable.trim() as EmailTemplateVariable)
  ));
}

function renderHtmlText(template: string, context: EmailRenderContext): string {
  let cursor = 0;
  let html = '';
  for (const match of template.matchAll(PLACEHOLDER)) {
    const index = match.index ?? 0;
    html += escapeHtml(template.slice(cursor, index));
    html += escapeHtml(requireContextValue(context, match[1].trim() as EmailTemplateVariable));
    cursor = index + match[0].length;
  }
  html += escapeHtml(template.slice(cursor));
  return html.replace(/\r\n|\r|\n/g, '<br>');
}

function validateLogoUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Email logo must use a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:') {
    throw new Error('Email logo must use a valid HTTPS URL.');
  }
  return url.toString();
}

function eventHeading(type: EmailNotificationTypeValue, language: CustomerEmailLanguageValue): string {
  const headings = {
    ENGLISH: {
      PAYMENT_RECEIVED: 'Payment Received',
      SHIPMENT: 'Shipment Update',
      RELEASE: 'Release Completed',
    },
    FRENCH: {
      PAYMENT_RECEIVED: 'Paiement reçu',
      SHIPMENT: 'Mise à jour de l’expédition',
      RELEASE: 'Mainlevée effectuée',
    },
  } as const;
  return headings[language][type];
}

export function validateEmailTemplate(input: EmailTemplateValidationInput): {
  variables: EmailTemplateVariable[];
  requiredVariables: EmailTemplateVariable[];
} {
  const subject = String(input.subjectTemplate || '').trim();
  const body = String(input.bodyTemplate || '').trim();
  if (!subject || subject.length > SUBJECT_MAX_LENGTH) {
    throw new Error(`Email subject must contain 1-${SUBJECT_MAX_LENGTH} characters.`);
  }
  if (!body || body.length > BODY_MAX_LENGTH) {
    throw new Error(`Email body must contain 1-${BODY_MAX_LENGTH} characters.`);
  }
  const variables = Array.from(new Set([
    ...extractVariables(subject),
    ...extractVariables(body),
  ]));
  const requiredVariables = getEmailTemplateVariableCatalog(input.type);
  for (const variable of requiredVariables) {
    if (!variables.includes(variable)) {
      throw new Error(`Missing required email template variable: ${variable}`);
    }
  }
  return { variables, requiredVariables };
}

export function renderEmailTemplate(
  template: RenderableEmailTemplate,
  context: EmailRenderContext,
  options: { logoUrl: string },
) {
  const validation = validateEmailTemplate(template);
  for (const variable of validation.variables) requireContextValue(context, variable);
  const logoUrl = validateLogoUrl(options.logoUrl);
  const subject = renderText(template.subjectTemplate, context)
    .replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ')
    .trim();
  const renderedBodyText = renderText(template.bodyTemplate, context).trim();
  const renderedBodyHtml = renderHtmlText(template.bodyTemplate, context);
  const heading = eventHeading(template.type, template.language);
  const html = `<!doctype html>
<html lang="${template.language === 'FRENCH' ? 'fr' : 'en'}">
<body style="margin:0;padding:0;background:#f2f6fb;font-family:Arial,sans-serif;color:#172033;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f2f6fb;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dce5f0;border-radius:12px;overflow:hidden;">
<tr><td style="padding:24px 28px;background:#0b4ea2;"><img src="${escapeHtml(logoUrl)}" width="120" alt="MU LEDGER" style="display:block;width:120px;max-width:100%;height:auto;border:0;"></td></tr>
<tr><td style="padding:28px 28px 12px;font-size:24px;line-height:1.25;font-weight:700;color:#0b4ea2;">${escapeHtml(heading)}</td></tr>
<tr><td style="padding:12px 28px 28px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f7faff;border:1px solid #dce8f6;border-radius:8px;">
<tr><td style="padding:20px;font-size:15px;line-height:1.65;color:#172033;">${renderedBodyHtml}</td></tr>
</table>
</td></tr>
<tr><td style="padding:18px 28px;background:#eef4fb;font-size:12px;line-height:1.5;color:#5d6b82;">MU LEDGER · Customer Notification</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  return {
    subject,
    html,
    text: `${renderedBodyText}\n\nMU LEDGER · Customer Notification`,
    variables: validation.variables,
    templateVersion: template.version,
  };
}
