import type {
  CustomerEmailLanguageValue,
  EmailNotificationTypeValue,
  EmailRenderContext,
  EmailTemplateVariable,
} from '@/lib/email/email-types';

export type EmailTemplateDefinition = {
  type: EmailNotificationTypeValue;
  language: CustomerEmailLanguageValue;
  subjectTemplate: string;
  bodyTemplate: string;
  requiredVariables: EmailTemplateVariable[];
};

const REQUIRED_VARIABLES: Record<EmailNotificationTypeValue, readonly EmailTemplateVariable[]> = {
  PAYMENT_RECEIVED: ['customerName', 'mark', 'orderNos', 'receiptNo', 'amount', 'paymentDate'],
  SHIPMENT: ['customerName', 'mark', 'orderNos', 'invoiceNo', 'shipmentDate'],
  RELEASE: ['customerName', 'mark', 'orderNos', 'invoiceNo', 'releaseDate'],
};

const TEMPLATE_COPY: Record<CustomerEmailLanguageValue, Record<EmailNotificationTypeValue, {
  subjectTemplate: string;
  bodyTemplate: string;
}>> = {
  ENGLISH: {
    PAYMENT_RECEIVED: {
      subjectTemplate: 'Payment received - {{receiptNo}}',
      bodyTemplate: `Dear {{customerName}},

We confirm receipt of your payment of {{amount}} on {{paymentDate}}.

MARK: {{mark}}
ORDER NO: {{orderNos}}
RECEIPT NO: {{receiptNo}}

Thank you for your payment.`,
    },
    SHIPMENT: {
      subjectTemplate: 'Shipment update - {{invoiceNo}}',
      bodyTemplate: `Dear {{customerName}},

Your goods have been shipped on {{shipmentDate}}.

MARK: {{mark}}
ORDER NO: {{orderNos}}
INV NO: {{invoiceNo}}

We will keep you informed of the next milestone.`,
    },
    RELEASE: {
      subjectTemplate: 'Release completed - {{invoiceNo}}',
      bodyTemplate: `Dear {{customerName}},

The release for your goods was completed on {{releaseDate}}.

MARK: {{mark}}
ORDER NO: {{orderNos}}
INV NO: {{invoiceNo}}

Please contact us if you need further assistance.`,
    },
  },
  FRENCH: {
    PAYMENT_RECEIVED: {
      subjectTemplate: 'Paiement reçu - {{receiptNo}}',
      bodyTemplate: `Bonjour {{customerName}},

Nous confirmons la réception de votre paiement de {{amount}} le {{paymentDate}}.

MARK : {{mark}}
ORDER NO : {{orderNos}}
REÇU NO : {{receiptNo}}

Merci pour votre paiement.`,
    },
    SHIPMENT: {
      subjectTemplate: 'Mise à jour de l’expédition - {{invoiceNo}}',
      bodyTemplate: `Bonjour {{customerName}},

Vos marchandises ont été expédiées le {{shipmentDate}}.

MARK : {{mark}}
ORDER NO : {{orderNos}}
INV NO : {{invoiceNo}}

Nous vous informerons de la prochaine étape.`,
    },
    RELEASE: {
      subjectTemplate: 'Mainlevée effectuée - {{invoiceNo}}',
      bodyTemplate: `Bonjour {{customerName}},

La mainlevée de vos marchandises a été effectuée le {{releaseDate}}.

MARK : {{mark}}
ORDER NO : {{orderNos}}
INV NO : {{invoiceNo}}

Veuillez nous contacter si vous avez besoin d’aide.`,
    },
  },
};

const TYPES = ['PAYMENT_RECEIVED', 'SHIPMENT', 'RELEASE'] as const;
const LANGUAGES = ['ENGLISH', 'FRENCH'] as const;

export const EMAIL_TEMPLATE_DEFINITIONS: readonly EmailTemplateDefinition[] = LANGUAGES.flatMap((language) => (
  TYPES.map((type) => ({
    type,
    language,
    ...TEMPLATE_COPY[language][type],
    requiredVariables: [...REQUIRED_VARIABLES[type]],
  }))
));

export function getEmailTemplateVariableCatalog(type: EmailNotificationTypeValue): EmailTemplateVariable[] {
  const variables = REQUIRED_VARIABLES[type];
  if (!variables) throw new Error(`Unsupported email notification type: ${type}`);
  return [...variables];
}

export function getDefaultEmailTemplate(
  type: EmailNotificationTypeValue,
  language: CustomerEmailLanguageValue,
): EmailTemplateDefinition {
  const template = EMAIL_TEMPLATE_DEFINITIONS.find((item) => item.type === type && item.language === language);
  if (!template) throw new Error(`Unsupported email template: ${type}/${language}`);
  return {
    ...template,
    requiredVariables: [...template.requiredVariables],
  };
}

export function getEmailTemplatePreviewContext(type: EmailNotificationTypeValue): EmailRenderContext {
  const shared = {
    customerName: 'Mamadou Dian Diallo',
    mark: 'PIKIN',
    orderNos: 'PIKIN-20',
    invoiceNo: 'L26MH000001',
    receiptNo: '0010000',
    amount: '$10,000',
    paymentDate: '01/09/2026',
    shipmentDate: '01/09/2026',
    releaseDate: '15/09/2026',
  } satisfies EmailRenderContext;
  return Object.fromEntries(
    getEmailTemplateVariableCatalog(type).map((variable) => [variable, shared[variable]]),
  ) as EmailRenderContext;
}
