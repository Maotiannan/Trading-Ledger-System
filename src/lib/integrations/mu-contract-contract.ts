import { z } from 'zod';

export const MU_CONTRACT_SCHEMA_VERSION = 1 as const;

export type MuContractContractErrorCode =
  | 'MU_CONTRACT_SCHEMA_UNSUPPORTED'
  | 'MU_CONTRACT_PAYLOAD_INVALID';

export class MuContractContractError extends Error {
  readonly code: MuContractContractErrorCode;

  constructor(code: MuContractContractErrorCode, message: string) {
    super(message);
    this.name = 'MuContractContractError';
    this.code = code;
  }
}

const cursorSchema = z.string().regex(/^(0|[1-9]\d*)$/, 'cursor must be an unsigned decimal string');
const utcTimestampSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}, 'timestamp must be an ISO UTC value ending in Z');
const trimmedString = (max: number) => z.string().trim().min(1).max(max);

const sourceSchema = z.object({
  system: z.literal('MU_CONTRACT'),
  piId: trimmedString(64),
  version: z.number().int().min(1),
}).strict();

const orderSchema = z.object({
  orderNo: trimmedString(191),
  previousOrderNo: z.string().trim().min(1).max(191).nullable(),
  piCreatedAt: utcTimestampSchema,
  active: z.boolean(),
  deletedAt: utcTimestampSchema.nullable(),
}).strict().superRefine((order, context) => {
  if (order.active && order.deletedAt !== null) {
    context.addIssue({ code: 'custom', path: ['deletedAt'], message: 'active order cannot be deleted' });
  }
  if (!order.active && order.deletedAt === null) {
    context.addIssue({ code: 'custom', path: ['deletedAt'], message: 'inactive order requires deletedAt' });
  }
});

const officialAmountSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be a three-letter uppercase code'),
  value: z.string().regex(/^\d+\.\d{2}$/, 'amount must be a non-negative two-decimal string'),
  generatedAt: utcTimestampSchema,
  generationRunId: trimmedString(64),
}).strict();

const eventTypeSchema = z.enum([
  'PI_ORDER_LINKED',
  'PI_ORDER_RENAMED',
  'PI_FORMAL_PDF_GENERATED',
  'PI_SOURCE_DEACTIVATED',
]);

const eventReasonSchema = z.enum([
  'ORDER_ASSIGNED',
  'ORDER_CHANGED',
  'FORMAL_PDF_GENERATED',
  'FORMAL_PDF_REGENERATED',
  'PI_DELETED',
  'ORDER_UNLINKED',
]);

const eventSchema = z.object({
  cursor: cursorSchema,
  eventId: z.string().uuid(),
  eventType: eventTypeSchema,
  reason: eventReasonSchema,
  occurredAt: utcTimestampSchema,
  source: sourceSchema,
  order: orderSchema,
  officialAmount: officialAmountSchema.nullable(),
}).strict().superRefine((event, context) => {
  const expectedReasons: Record<z.infer<typeof eventTypeSchema>, ReadonlySet<z.infer<typeof eventReasonSchema>>> = {
    PI_ORDER_LINKED: new Set(['ORDER_ASSIGNED']),
    PI_ORDER_RENAMED: new Set(['ORDER_CHANGED']),
    PI_FORMAL_PDF_GENERATED: new Set(['FORMAL_PDF_GENERATED', 'FORMAL_PDF_REGENERATED']),
    PI_SOURCE_DEACTIVATED: new Set(['PI_DELETED', 'ORDER_UNLINKED']),
  };
  if (!expectedReasons[event.eventType].has(event.reason)) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'reason is incompatible with eventType' });
  }
  if (event.eventType === 'PI_ORDER_RENAMED') {
    if (!event.order.previousOrderNo || event.order.previousOrderNo === event.order.orderNo) {
      context.addIssue({ code: 'custom', path: ['order', 'previousOrderNo'], message: 'rename requires a distinct previous order number' });
    }
  } else if (event.order.previousOrderNo !== null) {
    context.addIssue({ code: 'custom', path: ['order', 'previousOrderNo'], message: 'previous order number is only valid for rename events' });
  }
  if (event.eventType === 'PI_SOURCE_DEACTIVATED' && event.order.active) {
    context.addIssue({ code: 'custom', path: ['order', 'active'], message: 'deactivation event must be inactive' });
  }
  if (event.eventType !== 'PI_SOURCE_DEACTIVATED' && !event.order.active) {
    context.addIssue({ code: 'custom', path: ['order', 'active'], message: 'non-deactivation event must be active' });
  }
  if (event.eventType === 'PI_FORMAL_PDF_GENERATED' && event.officialAmount === null) {
    context.addIssue({ code: 'custom', path: ['officialAmount'], message: 'formal generation requires official amount' });
  }
});

const snapshotItemSchema = z.object({
  source: sourceSchema,
  order: orderSchema.refine((order) => order.previousOrderNo === null, {
    path: ['previousOrderNo'],
    message: 'snapshot rows do not carry previous order numbers',
  }),
  officialAmount: officialAmountSchema.nullable(),
}).strict();

const eventPageSchema = z.object({
  schemaVersion: z.literal(MU_CONTRACT_SCHEMA_VERSION),
  events: z.array(eventSchema).max(500),
  nextCursor: cursorSchema.nullable(),
  hasMore: z.boolean(),
}).strict().superRefine((page, context) => {
  for (let index = 1; index < page.events.length; index += 1) {
    if (BigInt(page.events[index].cursor) <= BigInt(page.events[index - 1].cursor)) {
      context.addIssue({ code: 'custom', path: ['events', index, 'cursor'], message: 'event cursors must be strictly increasing' });
    }
  }
  const lastCursor = page.events.at(-1)?.cursor ?? null;
  if (lastCursor !== null && page.nextCursor !== lastCursor) {
    context.addIssue({ code: 'custom', path: ['nextCursor'], message: 'nextCursor must equal the final event cursor' });
  }
  if (page.hasMore && page.events.length === 0) {
    context.addIssue({ code: 'custom', path: ['hasMore'], message: 'hasMore requires at least one event' });
  }
});

const snapshotPageSchema = z.object({
  schemaVersion: z.literal(MU_CONTRACT_SCHEMA_VERSION),
  items: z.array(snapshotItemSchema).max(500),
  eventHighWatermark: cursorSchema,
  nextAfter: z.string().trim().min(1).max(64).nullable(),
  hasMore: z.boolean(),
}).strict().superRefine((page, context) => {
  const seen = new Set<string>();
  page.items.forEach((item, index) => {
    if (seen.has(item.source.piId)) {
      context.addIssue({ code: 'custom', path: ['items', index, 'source', 'piId'], message: 'snapshot PI IDs must be unique' });
    }
    seen.add(item.source.piId);
  });
  if (page.hasMore && (page.items.length === 0 || page.nextAfter === null)) {
    context.addIssue({ code: 'custom', path: ['nextAfter'], message: 'paged snapshots require nextAfter' });
  }
  if (!page.hasMore && page.nextAfter !== null) {
    context.addIssue({ code: 'custom', path: ['nextAfter'], message: 'final snapshot page must clear nextAfter' });
  }
});

export type MuContractOrderSource = z.infer<typeof sourceSchema>;
export type MuContractOrderState = z.infer<typeof orderSchema>;
export type MuContractOfficialAmount = z.infer<typeof officialAmountSchema>;
export type MuContractOrderEvent = z.infer<typeof eventSchema>;
export type MuContractSnapshotItem = z.infer<typeof snapshotItemSchema>;
export type MuContractEventPage = z.infer<typeof eventPageSchema>;
export type MuContractSnapshotPage = z.infer<typeof snapshotPageSchema>;

function parseVersion(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const schemaVersion = (value as Record<string, unknown>).schemaVersion;
  if (schemaVersion !== undefined && schemaVersion !== MU_CONTRACT_SCHEMA_VERSION) {
    throw new MuContractContractError(
      'MU_CONTRACT_SCHEMA_UNSUPPORTED',
      `Unsupported MU Contract schema version: ${String(schemaVersion)}`,
    );
  }
}

function parsePayload<T>(schema: z.ZodType<T>, value: unknown): T {
  parseVersion(value);
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const location = issue?.path.length ? issue.path.join('.') : 'payload';
    throw new MuContractContractError(
      'MU_CONTRACT_PAYLOAD_INVALID',
      `Invalid MU Contract payload at ${location}`,
    );
  }
  return result.data;
}

export function parseMuContractEventPage(value: unknown): MuContractEventPage {
  return parsePayload(eventPageSchema, value);
}

export function parseMuContractSnapshotPage(value: unknown): MuContractSnapshotPage {
  return parsePayload(snapshotPageSchema, value);
}
