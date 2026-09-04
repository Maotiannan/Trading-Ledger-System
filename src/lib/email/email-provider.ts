import type {
  EmailProviderSendInput,
  EmailProviderSendResult,
} from '@/lib/email/email-types';

export interface EmailProvider {
  send(input: EmailProviderSendInput): Promise<EmailProviderSendResult>;
}

export enum EmailProviderFailureKind {
  REJECTED = 'REJECTED',
  UNCERTAIN = 'UNCERTAIN',
}

export class EmailProviderFailure extends Error {
  readonly kind: EmailProviderFailureKind;
  readonly code: string;

  constructor(input: { kind: EmailProviderFailureKind; code: string; message: string }) {
    super(input.message);
    this.name = 'EmailProviderFailure';
    this.kind = input.kind;
    this.code = input.code;
  }
}

export function asEmailProviderFailure(error: unknown): EmailProviderFailure {
  if (error instanceof EmailProviderFailure) return error;
  return new EmailProviderFailure({
    kind: EmailProviderFailureKind.UNCERTAIN,
    code: 'TRANSPORT_UNCERTAIN',
    message: 'Email provider response was not confirmed.',
  });
}
