export const CUSTOMER_EMAIL_LANGUAGES = ['ENGLISH', 'FRENCH'] as const;
export type CustomerEmailLanguageValue = (typeof CUSTOMER_EMAIL_LANGUAGES)[number];

export const EMAIL_RECIPIENT_MODES = ['PRIMARY_CC', 'SEPARATE'] as const;
export type EmailRecipientModeValue = (typeof EMAIL_RECIPIENT_MODES)[number];

export const EMAIL_NOTIFICATION_TYPES = [
  'PAYMENT_RECEIVED',
  'SHIPMENT',
  'RELEASE',
] as const;
export type EmailNotificationTypeValue = (typeof EMAIL_NOTIFICATION_TYPES)[number];

export const EMAIL_NOTIFICATION_STATUSES = [
  'MISSING_RECIPIENT',
  'PENDING',
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'DELIVERY_DELAYED',
  'BOUNCED',
  'COMPLAINED',
  'SUPPRESSED',
  'PARTIALLY_SENT',
  'FAILED',
  'DELIVERY_UNCERTAIN',
  'CANCELLED',
  'NEEDS_CORRECTION',
] as const;
export type EmailNotificationStatusValue = (typeof EMAIL_NOTIFICATION_STATUSES)[number];

export type EmailSettings = {
  outboundEnabled: boolean;
  recipientMode: EmailRecipientModeValue;
  senderName: string;
  senderAddress: string;
  replyToAddress: string;
  retryLimit: number;
  retryIntervalsSeconds: number[];
  testModeEnabled: boolean;
  testDestination: string;
  logoUrl: string;
};

export const EMAIL_TEMPLATE_VARIABLES = [
  'customerName',
  'mark',
  'orderNos',
  'invoiceNo',
  'receiptNo',
  'amount',
  'paymentDate',
  'shipmentDate',
  'releaseDate',
] as const;
export type EmailTemplateVariable = (typeof EMAIL_TEMPLATE_VARIABLES)[number];
export type EmailRenderContext = Partial<Record<EmailTemplateVariable, string>>;

export type EmailProviderSendInput = {
  notificationId: string;
  senderName: string;
  senderAddress: string;
  replyToAddress: string | null;
  to: string[];
  cc: string[];
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

export type EmailProviderSendResult = {
  providerMessageId: string;
};
