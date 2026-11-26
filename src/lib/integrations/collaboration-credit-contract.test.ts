/** @jest-environment node */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import schema from '../../../docs/integrations/collaboration-v1/credit-records.schema.json';
import fixtures from '../../../docs/integrations/collaboration-v1/credit-records.fixtures.json';

describe('collaboration credit producer contract', () => {
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  it.each(fixtures.cases)('validates $name', ({ response }) => { expect(validate(response)).toBe(true); });
  it('rejects numeric amounts, customer data leakage and contradictory pagination', () => {
    const record = fixtures.cases[1].response;
    expect(validate({ ...record, creditAmount: 1.23 })).toBe(false);
    expect(validate({ ...record, ownerId: 'private' })).toBe(false);
    expect(validate({ items: [], nextCursor: 'cursor', hasMore: false, readAt: '2026-11-03T07:00:00Z' })).toBe(false);
  });
});
