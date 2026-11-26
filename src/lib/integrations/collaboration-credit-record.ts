import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

type CreditSource = {
  id: string;
  companyName: string | null;
  credit: Prisma.Decimal | null;
  companyAddress: string | null;
  companyContact: string | null;
  updatedAt: Date;
};

const nullableText = (value: string | null) => value?.trim() || null;

// API reads and explicitly authorized offline exports share the same projection.
export function toCollaborationCreditRecord(source: CreditSource) {
  const credit = source.credit;
  const record = {
    creditRecordId: source.id,
    companyName: nullableText(source.companyName),
    creditAmount: credit === null ? null : credit.toFixed(2),
    currency: 'USD' as const,
    creditState: credit === null ? 'UNSET' as const : credit.isZero() ? 'ZERO' as const
      : credit.isPositive() ? 'AVAILABLE' as const : 'INVALID' as const,
    address: nullableText(source.companyAddress),
    contacts: { details: nullableText(source.companyContact) },
    missingFields: [] as string[],
    sourceUpdatedAt: source.updatedAt.toISOString(),
  };
  if (record.companyName === null) record.missingFields.push('companyName');
  if (record.creditAmount === null) record.missingFields.push('creditAmount');
  if (record.address === null) record.missingFields.push('address');
  if (record.contacts.details === null) record.missingFields.push('contacts.details');
  return { ...record, sourceVersion: `sha256:${createHash('sha256').update(JSON.stringify(record)).digest('hex')}` };
}
