import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020';
import type { AnySchema } from 'ajv';
import addFormats from 'ajv-formats';

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), 'utf8'));
}

describe('MU Contract shared JSON Schema', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const validate = ajv.compile(
    readJson('docs/integrations/mu-contract-order-sync-v1.schema.json') as AnySchema,
  );

  it('matches the schema published by MU Contract byte for byte', () => {
    const schema = readFileSync(
      path.join(process.cwd(), 'docs/integrations/mu-contract-order-sync-v1.schema.json'),
    );

    expect(createHash('sha256').update(schema).digest('hex'))
      .toBe('45bfaaa9e6ae4f13c1c45a7aaab034cfbad6e1305204e4130178dcb3e482941b');
  });

  it.each([
    'tests/fixtures/mu-contract-order-sync/formal-generated.json',
    'tests/fixtures/mu-contract-order-sync/deactivated.json',
  ])('accepts the shared fixture %s', (fixturePath) => {
    const fixture = readJson(fixturePath);

    expect(validate(fixture)).toBe(true);
    expect(validate.errors).toBeNull();
  });

  it('rejects undeclared event properties', () => {
    const fixture = readJson(
      'tests/fixtures/mu-contract-order-sync/formal-generated.json',
    ) as { events: Array<Record<string, unknown>> };
    fixture.events[0].secret = 'must-not-cross-the-contract';

    expect(validate(fixture)).toBe(false);
  });

  it.each([
    ['cursor above signed bigint', (fixture: any) => { fixture.events[0].cursor = '9223372036854775808'; fixture.nextCursor = '9223372036854775808'; }],
    ['source version above signed int', (fixture: any) => { fixture.events[0].source.version = 2147483648; }],
    ['official amount above 16 integer digits', (fixture: any) => { fixture.events[0].officialAmount.value = '10000000000000000.00'; }],
  ])('rejects %s', (_label, mutate) => {
    const fixture = readJson(
      'tests/fixtures/mu-contract-order-sync/formal-generated.json',
    ) as Record<string, unknown>;
    mutate(fixture);

    expect(validate(fixture)).toBe(false);
  });

  it('accepts the exact persistence maxima', () => {
    const fixture = readJson(
      'tests/fixtures/mu-contract-order-sync/formal-generated.json',
    ) as { events: Array<{ cursor: string; source: { version: number } }>; nextCursor: string };
    fixture.events[0].cursor = '9223372036854775807';
    fixture.events[0].source.version = 2147483647;
    fixture.nextCursor = '9223372036854775807';

    expect(validate(fixture)).toBe(true);
  });
});
