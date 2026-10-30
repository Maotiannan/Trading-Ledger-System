/** @jest-environment node */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import schema from '../../../docs/integrations/mucont-customers-v1.schema.json';
import fixtures from '../../../docs/integrations/mucont-customers-v1.fixtures.json';

describe('mucont customer producer contract', () => {
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  it.each(fixtures.cases)('validates $name', ({ response }) => {
    expect(validate(response)).toBe(true);
  });
  it('rejects missing master fields and inconsistent last-page metadata', () => {
    expect(validate({ items: [], hasMore: false, nextCursor: 'invalid' })).toBe(false);
    expect(validate({ customerId: 'a', capturedAt: '2026-10-30T07:00:00Z', completeness: 'MASTER_FULL', profile: {} })).toBe(false);
  });
});
