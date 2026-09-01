export type EmailNotificationTypeValue = 'PAYMENT_RECEIVED' | 'SHIPMENT' | 'RELEASE';

export type EmailNotificationStatusValue =
  | 'MISSING_RECIPIENT'
  | 'PENDING'
  | 'QUEUED'
  | 'SENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'DELIVERY_DELAYED'
  | 'BOUNCED'
  | 'COMPLAINED'
  | 'SUPPRESSED'
  | 'PARTIALLY_SENT'
  | 'FAILED'
  | 'DELIVERY_UNCERTAIN'
  | 'CANCELLED'
  | 'NEEDS_CORRECTION';

export type EmailDeliverySummary = {
  id: string;
  status: string;
  intendedTo: string[];
  intendedCc: string[];
  actualTo: string[];
  actualCc: string[];
  subject: string;
  providerMessageId?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  acceptedAt?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmailNotificationRow = {
  id: string;
  eventKey: string;
  type: EmailNotificationTypeValue;
  status: EmailNotificationStatusValue;
  customerId: string | null;
  customerName: string | null;
  mark: string | null;
  language: 'ENGLISH' | 'FRENCH' | null;
  primaryEmail: string | null;
  additionalEmailCount: number;
  receiptId: string | null;
  receiptNo: string | null;
  invoiceId: string | null;
  invoiceNo: string | null;
  currentSnapshot: Record<string, unknown>;
  correctionReason: string | null;
  parentNotificationId: string | null;
  approvedAt?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  updatedAt: string;
  deliveries: EmailDeliverySummary[];
};

export type EmailNotificationListResponse = {
  success: boolean;
  data: EmailNotificationRow[];
  total: number;
  page: number;
  pageSize: number;
  message?: string;
};

export type EmailPreviewResponse = {
  success: boolean;
  notification: EmailNotificationRow;
  preview: {
    subject: string;
    html: string;
    text: string;
    templateVersion: number;
  };
  language: 'ENGLISH' | 'FRENCH';
  intendedRecipients: Array<{ to: string[]; cc: string[] }>;
  actualRecipients: Array<{ to: string[]; cc: string[] }>;
  testModeRedirected: boolean;
  missingRecipient: boolean;
};

export type EmailDeliveryAttempt = {
  id: string;
  deliveryId: string;
  attemptNo: number;
  status: string;
  idempotencyKey: string;
  providerMessageId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type EmailTranslator = (key: string, values?: Record<string, string | number>) => string;

export function notificationOrderNos(row: EmailNotificationRow): string[] {
  const value = row.currentSnapshot?.orderNos;
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const single = String(value || '').trim();
  return single ? [single] : [];
}

export function isEmailApprovable(row: EmailNotificationRow): boolean {
  return row.status === 'PENDING' && Boolean(row.primaryEmail);
}
