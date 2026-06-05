import { Prisma } from '@prisma/client';

export type MoneyInput = Prisma.Decimal | number | string | { toString(): string } | null | undefined;

export function toDecimal(value: MoneyInput): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) {
    return value;
  }
  if (value == null || value === '') {
    return new Prisma.Decimal(0);
  }
  return new Prisma.Decimal(value.toString());
}

export function moneyToNumber(value: MoneyInput): number {
  return Number(toDecimal(value).toFixed(2));
}

export function addMoney(values: MoneyInput[]): Prisma.Decimal {
  let sum = new Prisma.Decimal(0);
  for (const value of values) {
    sum = sum.plus(toDecimal(value));
  }
  return sum;
}

export function subtractMoney(left: MoneyInput, right: MoneyInput): Prisma.Decimal {
  return toDecimal(left).minus(toDecimal(right));
}
