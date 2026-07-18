import { createHash } from 'node:crypto';

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

const MAX_CURSOR = BigInt('9223372036854775807');
const cursorSchema = z.string()
  .regex(/^(0|[1-9]\d{0,18})$/, 'cursor must be an unsigned decimal string with at most 19 digits')
  .refine((value) => BigInt(value) <= MAX_CURSOR, 'cursor exceeds signed 64-bit storage');
const snapshotCursorSchema = z.string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'snapshot cursor must be a signed opaque token');

function isValidUtcTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):([0-5]\d)(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, fraction = '0'] = match;
  const expected = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
    millisecond: Number(fraction.padEnd(3, '0')),
  };
  const parsed = new Date(0);
  parsed.setUTCFullYear(expected.year, expected.month - 1, expected.day);
  parsed.setUTCHours(
    expected.hour,
    expected.minute,
    expected.second,
    expected.millisecond,
  );
  return parsed.getUTCFullYear() === expected.year
    && parsed.getUTCMonth() === expected.month - 1
    && parsed.getUTCDate() === expected.day
    && parsed.getUTCHours() === expected.hour
    && parsed.getUTCMinutes() === expected.minute
    && parsed.getUTCSeconds() === expected.second
    && parsed.getUTCMilliseconds() === expected.millisecond;
}

const utcTimestampSchema = z.string().refine(
  isValidUtcTimestamp,
  'timestamp must be a valid ISO UTC value ending in Z',
);
const trimmedString = (max: number) => z.string()
  .min(1)
  .max(max)
  .refine((value) => /\S/.test(value), 'value must contain a non-whitespace character')
  .transform((value) => value.trim());
const stableIdentityString = (max: number) => z.string()
  .min(1)
  .max(max)
  .refine((value) => value === value.trim(), 'stable identity must not contain surrounding whitespace');

const sourceSchema = z.object({
  system: z.literal('MU_CONTRACT'),
  piId: stableIdentityString(64),
  version: z.number().int().min(1).max(2_147_483_647),
}).strict();

// Identity parsing strips all business fields so an invalid event can be stored safely.
const eventEnvelopeSchema = z.object({
  cursor: cursorSchema,
  eventId: z.string().uuid(),
  source: z.object({
    system: z.literal('MU_CONTRACT'),
    piId: stableIdentityString(64),
    version: z.number().int().min(1).max(2_147_483_647),
  }),
});

const orderSchema = z.object({
  orderNo: trimmedString(191),
  previousOrderNo: trimmedString(191).nullable(),
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
  value: z.string().regex(/^(0|[1-9]\d{0,15})\.\d{2}$/, 'amount must have at most 16 integer digits and exactly two decimals'),
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

const eventPageEnvelopeSchema = z.object({
  schemaVersion: z.literal(MU_CONTRACT_SCHEMA_VERSION),
  events: z.array(z.unknown()).max(500),
  nextCursor: cursorSchema.nullable(),
  hasMore: z.boolean(),
}).strict().superRefine((page, context) => {
  if (page.hasMore && page.events.length === 0) {
    context.addIssue({ code: 'custom', path: ['hasMore'], message: 'hasMore requires at least one event' });
  }
});

const snapshotPageSchema = z.object({
  schemaVersion: z.literal(MU_CONTRACT_SCHEMA_VERSION),
  items: z.array(snapshotItemSchema).max(500),
  eventHighWatermark: cursorSchema,
  nextAfter: snapshotCursorSchema.nullable(),
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
export type MuContractInvalidEvent = z.infer<typeof eventEnvelopeSchema> & {
  invalid: true;
  issuePath: string;
  payloadHash: string;
};
export type MuContractParsedEvent = MuContractOrderEvent | MuContractInvalidEvent;
export type MuContractSnapshotItem = z.infer<typeof snapshotItemSchema>;
export type MuContractEventPage = {
  schemaVersion: typeof MU_CONTRACT_SCHEMA_VERSION;
  events: MuContractParsedEvent[];
  nextCursor: string | null;
  hasMore: boolean;
};
export type MuContractSnapshotPage = z.infer<typeof snapshotPageSchema>;

export function isMuContractInvalidEvent(
  event: MuContractParsedEvent,
): event is MuContractInvalidEvent {
  return 'invalid' in event && event.invalid === true;
}

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

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function parseMuContractEventPage(value: unknown): MuContractEventPage {
  const outer = parsePayload(eventPageEnvelopeSchema, value);
  const events = outer.events.map((rawEvent, index): MuContractParsedEvent => {
    const envelope = eventEnvelopeSchema.safeParse(rawEvent);
    if (!envelope.success) {
      const issue = envelope.error.issues[0];
      const suffix = issue?.path.length ? `.${issue.path.join('.')}` : '';
      throw new MuContractContractError(
        'MU_CONTRACT_PAYLOAD_INVALID',
        `Invalid MU Contract payload at events.${index}${suffix}`,
      );
    }

    const event = eventSchema.safeParse(rawEvent);
    if (event.success) return event.data;
    const issue = event.error.issues[0];
    return {
      invalid: true,
      ...envelope.data,
      issuePath: issue?.path.length ? issue.path.join('.') : 'event',
      payloadHash: createHash('sha256')
        .update(JSON.stringify(canonicalize(rawEvent)))
        .digest('hex'),
    };
  });

  for (let index = 1; index < events.length; index += 1) {
    if (BigInt(events[index].cursor) <= BigInt(events[index - 1].cursor)) {
      throw new MuContractContractError(
        'MU_CONTRACT_PAYLOAD_INVALID',
        `Invalid MU Contract payload at events.${index}.cursor`,
      );
    }
  }
  const lastCursor = events.at(-1)?.cursor ?? null;
  if (lastCursor !== null && outer.nextCursor !== lastCursor) {
    throw new MuContractContractError(
      'MU_CONTRACT_PAYLOAD_INVALID',
      'Invalid MU Contract payload at nextCursor',
    );
  }

  return { ...outer, events };
}

export function parseMuContractSnapshotPage(value: unknown): MuContractSnapshotPage {
  return parsePayload(snapshotPageSchema, value);
}
