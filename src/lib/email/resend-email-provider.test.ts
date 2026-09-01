import {
  EmailProviderFailure,
  EmailProviderFailureKind,
} from '@/lib/email/email-provider';
import { createResendEmailProvider } from '@/lib/email/resend-email-provider';

jest.mock('resend', () => ({ Resend: jest.fn() }));

const input = {
  notificationId: 'notification-1',
  senderName: 'MU LEDGER',
  senderAddress: 'ledger@example.com',
  replyToAddress: 'reply@example.com',
  to: ['primary@example.com'],
  cc: ['copy@example.com'],
  subject: 'Payment received',
  html: '<p>Payment</p>',
  text: 'Payment',
  idempotencyKey: 'email-delivery:notification-1:1',
};

describe('resend-email-provider', () => {
  it('maps the frozen delivery exactly and preserves the idempotency key', async () => {
    const send = jest.fn().mockResolvedValue({
      data: { id: 'resend-message-1' },
      error: null,
      headers: null,
    });
    const provider = createResendEmailProvider('re_test', { emails: { send } } as never);

    await expect(provider.send(input)).resolves.toEqual({ providerMessageId: 'resend-message-1' });
    expect(send).toHaveBeenCalledWith({
      from: 'MU LEDGER <ledger@example.com>',
      to: ['primary@example.com'],
      cc: ['copy@example.com'],
      replyTo: 'reply@example.com',
      subject: 'Payment received',
      html: '<p>Payment</p>',
      text: 'Payment',
      headers: { 'X-MULEDGER-Notification-ID': 'notification-1' },
    }, { idempotencyKey: 'email-delivery:notification-1:1' });
  });

  it('classifies a Resend response error as a definite rejection without leaking raw details', async () => {
    const send = jest.fn().mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'raw recipient details', statusCode: 422 },
      headers: null,
    });
    const provider = createResendEmailProvider('re_test', { emails: { send } } as never);

    await expect(provider.send(input)).rejects.toMatchObject({
      name: 'EmailProviderFailure',
      kind: EmailProviderFailureKind.REJECTED,
      code: 'validation_error',
      message: 'Email provider rejected the request.',
    });
  });

  it('classifies a thrown transport error as uncertain', async () => {
    const send = jest.fn().mockRejectedValue(new Error('socket timeout with secret response'));
    const provider = createResendEmailProvider('re_test', { emails: { send } } as never);

    await expect(provider.send(input)).rejects.toEqual(expect.objectContaining<Partial<EmailProviderFailure>>({
      kind: EmailProviderFailureKind.UNCERTAIN,
      code: 'TRANSPORT_UNCERTAIN',
      message: 'Email provider response was not confirmed.',
    }));
  });
});
