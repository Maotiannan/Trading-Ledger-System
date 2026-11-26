import { Prisma } from '@prisma/client';

export function customerCreditCodeError(credit: Prisma.Decimal | number | string | null | undefined,
  customerCode: string | null | undefined, creditCode: string | null | undefined): string | null {
  if ((customerCode?.length || 0) > 191 || (creditCode?.length || 0) > 191) return 'CUSTOMER_CODE and CREDIT_CODE must not exceed 191 characters';
  if (credit !== null && credit !== undefined && !new Prisma.Decimal(credit).isZero()
    && (!customerCode?.trim() || !creditCode?.trim())) return 'CUSTOMER_CODE and CREDIT_CODE are required when CREDIT is not zero';
  return null;
}
