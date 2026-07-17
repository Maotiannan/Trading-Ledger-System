import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  isMuContractInvalidEvent,
  MuContractContractError,
  parseMuContractEventPage,
  parseMuContractSnapshotPage,
} from '@/lib/integrations/mu-contract-contract';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(
    path.join(process.cwd(), 'tests', 'fixtures', 'mu-contract-order-sync', name),
    'utf8',
  ));
}

describe('MU Contract order sync version 1 contract', () => {
  it('preserves decimal strings, UTC timestamps, and 64-bit-safe cursor strings', () => {
    const page = parseMuContractEventPage(fixture('formal-generated.json'));
    const event = page.events[0];
    expect(isMuContractInvalidEvent(event)).toBe(false);
    if (isMuContractInvalidEvent(event)) throw new Error('expected a valid fixture event');

    expect(event.cursor).toBe('1042');
    expect(event.officialAmount?.value).toBe('30040.00');
    expect(event.occurredAt).toBe('2026-07-17T14:30:00.000Z');
    expect(page.nextCursor).toBe('1042');
  });

  it('accepts inactive tombstones in the snapshot feed', () => {
    const page = parseMuContractSnapshotPage(fixture('deactivated.json'));

    expect(page.items[0].source.piId).toBe('deleted-pi-id');
    expect(page.items[0].order).toEqual(expect.objectContaining({
      orderNo: 'AB-12',
      active: false,
      deletedAt: '2026-07-17T16:00:00.000Z',
    }));
    expect(page.eventHighWatermark).toBe('1042');
  });

  it('rejects unsupported schema versions with a stable error code', () => {
    const payload = fixture('formal-generated.json') as Record<string, unknown>;

    expect(() => parseMuContractEventPage({ ...payload, schemaVersion: 2 }))
      .toThrow(expect.objectContaining({ code: 'MU_CONTRACT_SCHEMA_UNSUPPORTED' }));
  });

  it('rejects amount values that are not exact two-decimal strings', () => {
    const payload = fixture('formal-generated.json') as {
      events: Array<{ officialAmount: { value: string } }>;
    };
    payload.events[0].officialAmount.value = '30040.0';

    const page = parseMuContractEventPage(payload);
    expect(page.events[0]).toEqual(expect.objectContaining({
      invalid: true,
      cursor: '1042',
      eventId: 'c5a5c257-b3ec-4ce2-b54d-83f8f1aab7e2',
      source: { system: 'MU_CONTRACT', piId: 'stable-hidden-pi-id', version: 4 },
      issuePath: 'officialAmount.value',
      payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(JSON.stringify(page.events[0])).not.toContain('30040.0');
  });

  it('rejects timestamps without an explicit UTC Z suffix', () => {
    const payload = fixture('formal-generated.json') as {
      events: Array<{ occurredAt: string }>;
    };
    payload.events[0].occurredAt = '2026-07-17T14:30:00';

    expect(parseMuContractEventPage(payload).events[0])
      .toEqual(expect.objectContaining({ invalid: true, issuePath: 'occurredAt' }));
  });

  it('rejects active rows carrying a deletion timestamp', () => {
    const payload = fixture('deactivated.json') as {
      items: Array<{ order: { active: boolean; deletedAt: string | null } }>;
    };
    payload.items[0].order.active = true;

    expect(() => parseMuContractSnapshotPage(payload))
      .toThrow(expect.objectContaining({ code: 'MU_CONTRACT_PAYLOAD_INVALID' }));
  });

  it('exposes safe diagnostics without embedding source payloads', () => {
    try {
      parseMuContractEventPage({ schemaVersion: 1, events: 'secret-payload' });
      throw new Error('expected parser failure');
    } catch (error) {
      expect(error).toBeInstanceOf(MuContractContractError);
      expect(String(error)).not.toContain('secret-payload');
    }
  });

  it('rejects the whole page when event identity cannot be stored safely', () => {
    const payload = fixture('formal-generated.json') as {
      events: Array<{ source: { piId: string } }>;
    };
    payload.events[0].source.piId = '';

    expect(() => parseMuContractEventPage(payload))
      .toThrow(expect.objectContaining({ code: 'MU_CONTRACT_PAYLOAD_INVALID' }));
  });

  it.each([
    ['cursor above signed bigint', 'cursor', '9223372036854775808'],
    ['cursor with 20 digits', 'cursor', '10000000000000000000'],
    ['source version above signed int', 'version', 2147483648],
  ])('rejects unsafe %s identity', (_label, field, value) => {
    const payload = fixture('formal-generated.json') as {
      events: Array<{ cursor: string; source: { version: number } }>;
      nextCursor: string;
    };
    if (field === 'cursor') {
      payload.events[0].cursor = String(value);
      payload.nextCursor = String(value);
    } else {
      payload.events[0].source.version = Number(value);
    }

    expect(() => parseMuContractEventPage(payload))
      .toThrow(expect.objectContaining({ code: 'MU_CONTRACT_PAYLOAD_INVALID' }));
  });

  it('bounds official amounts at 16 integer digits while keeping exact cents', () => {
    const accepted = fixture('formal-generated.json') as {
      events: Array<{ officialAmount: { value: string } }>;
    };
    accepted.events[0].officialAmount.value = '9999999999999999.99';
    expect(isMuContractInvalidEvent(parseMuContractEventPage(accepted).events[0])).toBe(false);

    const rejected = fixture('formal-generated.json') as {
      events: Array<{ officialAmount: { value: string } }>;
    };
    rejected.events[0].officialAmount.value = '10000000000000000.00';
    expect(parseMuContractEventPage(rejected).events[0])
      .toEqual(expect.objectContaining({ invalid: true, issuePath: 'officialAmount.value' }));
  });

  it('accepts the exact signed-bigint cursor and signed-int source version maxima', () => {
    const payload = fixture('formal-generated.json') as {
      events: Array<{ cursor: string; source: { version: number } }>;
      nextCursor: string;
    };
    payload.events[0].cursor = '9223372036854775807';
    payload.events[0].source.version = 2147483647;
    payload.nextCursor = '9223372036854775807';

    expect(isMuContractInvalidEvent(parseMuContractEventPage(payload).events[0])).toBe(false);
  });
});
