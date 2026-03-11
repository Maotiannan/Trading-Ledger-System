import { z } from 'zod';

export const MAX_SEARCH_LENGTH = 100;

export class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputValidationError';
  }
}

const nullableTrimmedString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

const booleanLike = z
  .union([z.boolean(), z.string(), z.undefined(), z.null()])
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return false;
  });

export const receiptPayloadSchema = z.object({
  receiptNo: nullableTrimmedString,
  date: nullableTrimmedString,
  tel: nullableTrimmedString,
  usd: z.coerce.number().positive('付款金额无效'),
  invNo: nullableTrimmedString,
  orderNo: nullableTrimmedString,
  payer: nullableTrimmedString,
  customerMark: nullableTrimmedString.optional(),
  customerName: nullableTrimmedString.optional(),
  customerPhone: nullableTrimmedString.optional(),
  customerCity: nullableTrimmedString.optional(),
  customerId: nullableTrimmedString.optional(),
  isDeposit: booleanLike,
});
export type ReceiptPayload = z.infer<typeof receiptPayloadSchema>;

export const detailPayloadSchema = z.object({
  date: nullableTrimmedString,
  items: z
    .array(
      z.object({
        mark: nullableTrimmedString,
        orderNo: nullableTrimmedString,
        amount: z.coerce.number().positive('明细金额必须大于 0'),
        receiptId: nullableTrimmedString.optional(),
        matchedReceiptId: nullableTrimmedString.optional(),
      })
    )
    .min(1, '未识别到有效明细项'),
});
export type DetailPayload = z.infer<typeof detailPayloadSchema>;

export const swiftPayloadSchema = z.object({
  amount: z.coerce.number().positive('SWIFT金额无效'),
  date: nullableTrimmedString,
  senderName: nullableTrimmedString,
  senderAddress: nullableTrimmedString,
  receiverName: nullableTrimmedString,
  receiverAccount: nullableTrimmedString,
});
export type SwiftPayload = z.infer<typeof swiftPayloadSchema>;

export function parseJsonWithSchema<T>(raw: string, schema: z.ZodType<T>, invalidMessage: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InputValidationError(invalidMessage);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new InputValidationError(issue?.message || invalidMessage);
  }
  return result.data;
}

export function assertSearchLength(search: string): void {
  if (search.length > MAX_SEARCH_LENGTH) {
    throw new InputValidationError('搜索关键词过长');
  }
}
