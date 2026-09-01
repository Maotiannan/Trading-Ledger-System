import { Resend } from 'resend';
import {
  EmailProviderFailure,
  EmailProviderFailureKind,
  type EmailProvider,
} from '@/lib/email/email-provider';
import type { EmailProviderSendInput } from '@/lib/email/email-types';

type ResendSendResponse = {
  data: { id: string } | null;
  error: { name: string; message: string; statusCode: number | null } | null;
  headers: Record<string, string> | null;
};

type ResendClient = {
  emails: {
    send(payload: {
      from: string;
      to: string[];
      cc: string[];
      replyTo?: string;
      subject: string;
      html: string;
      text: string;
      headers: Record<string, string>;
    }, options: { idempotencyKey: string }): Promise<ResendSendResponse>;
  };
};

class ResendEmailProvider implements EmailProvider {
  constructor(private readonly client: ResendClient) {}

  async send(input: EmailProviderSendInput) {
    let response: ResendSendResponse;
    try {
      response = await this.client.emails.send({
        from: `${input.senderName} <${input.senderAddress}>`,
        to: input.to,
        cc: input.cc,
        ...(input.replyToAddress ? { replyTo: input.replyToAddress } : {}),
        subject: input.subject,
        html: input.html,
        text: input.text,
        headers: { 'X-MULEDGER-Notification-ID': input.notificationId },
      }, { idempotencyKey: input.idempotencyKey });
    } catch {
      throw new EmailProviderFailure({
        kind: EmailProviderFailureKind.UNCERTAIN,
        code: 'TRANSPORT_UNCERTAIN',
        message: 'Email provider response was not confirmed.',
      });
    }

    if (response.error || !response.data?.id) {
      throw new EmailProviderFailure({
        kind: EmailProviderFailureKind.REJECTED,
        code: response.error?.name || 'PROVIDER_REJECTED',
        message: 'Email provider rejected the request.',
      });
    }
    return { providerMessageId: response.data.id };
  }
}

export function createResendEmailProvider(
  apiKey: string,
  client?: ResendClient,
): EmailProvider {
  const resolved = client || (new Resend(apiKey) as unknown as ResendClient);
  return new ResendEmailProvider(resolved);
}
