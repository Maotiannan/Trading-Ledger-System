import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
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

    expect(page.events[0].cursor).toBe('1042');
    expect(page.events[0].officialAmount?.value).toBe('30040.00');
    expect(page.events[0].occurredAt).toBe('2026-07-17T14:30:00.000Z');
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

    expect(() => parseMuContractEventPage(payload))
      .toThrow(expect.objectContaining({ code: 'MU_CONTRACT_PAYLOAD_INVALID' }));
  });

  it('rejects timestamps without an explicit UTC Z suffix', () => {
    const payload = fixture('formal-generated.json') as {
      events: Array<{ occurredAt: string }>;
    };
    payload.events[0].occurredAt = '2026-07-17T14:30:00';

    expect(() => parseMuContractEventPage(payload))
      .toThrow(expect.objectContaining({ code: 'MU_CONTRACT_PAYLOAD_INVALID' }));
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
});
