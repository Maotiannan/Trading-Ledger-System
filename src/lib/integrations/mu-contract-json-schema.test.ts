import { readFileSync } from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), 'utf8'));
}

describe('MU Contract shared JSON Schema', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const validate = ajv.compile(
    readJson('docs/integrations/mu-contract-order-sync-v1.schema.json'),
  );

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
});
