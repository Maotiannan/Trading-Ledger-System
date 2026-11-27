/** @jest-environment node */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import schema from '../../../docs/integrations/mucont-customers-v1.schema.json';
import fixtures from '../../../docs/integrations/mucont-customers-v1.fixtures.json';
import marks from '../../../docs/integrations/mucont-customer-marks-v1.fixtures.json';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

describe('mucont customer producer contract', () => {
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  it('pins the shared schema and wire examples rather than fetching the consumer at test time', () => {
    for (const [file, digest] of [
      ['mucont-customer-marks-v1.fixtures.json', '7bf2d7009877883501a1852023631367f9b9106320d8507202ba97845a137f3c'],
      ['mucont-customers-v1.schema.json', '4e1143000e4e33c38ad5c9bf2a5d442fb5a3f8f4fcc63e0b67269a12f75b01e1'],
    ]) expect(createHash('sha256').update(readFileSync('docs/integrations/' + file)).digest('hex')).toBe(digest);
  });
  const requestShape = ajv.getSchema(schema.$id + '#/definitions/MarksRequest')!;
  it.each(marks.cases)('checks v1 marks request shape and response: $name', ({ name, request, response }) => {
    // Trimming and the distinct-ID limit are route semantics, not maxItems on the wire.
    expect(requestShape(request)).toBe(!['missing-field', 'unexpected-field'].includes(name));
    expect(validate(response)).toBe(true);
  });
  it.each(fixtures.cases)('validates $name', ({ response }) => {
    expect(validate(response)).toBe(true);
  });
  it('rejects missing master fields and inconsistent last-page metadata', () => {
    expect(validate({ items: [], hasMore: false, nextCursor: 'invalid' })).toBe(false);
    expect(validate({ customerId: 'a', capturedAt: '2026-10-30T07:00:00Z', completeness: 'MASTER_FULL', profile: {} })).toBe(false);
  });
  it('accepts latest-mark batches with a database version and explicit missing IDs', () => {
    expect(validate({ items: [{ customerId: 'id', mark: null, sourceVersion: '2026-11-13T00:00:00.000Z' }], missingCustomerIds: ['missing'] })).toBe(true);
    expect(validate({ items: [{ customerId: 'id', mark: 'NEW' }], missingCustomerIds: [] })).toBe(false);
  });
});
