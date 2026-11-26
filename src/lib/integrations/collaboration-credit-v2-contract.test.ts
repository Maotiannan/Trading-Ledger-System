/** @jest-environment node */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import schema from '../../../docs/integrations/collaboration-v1/credit-records-v2.schema.json';
import fixtures from '../../../docs/integrations/collaboration-v1/credit-records-v2.fixtures.json';

describe('credit V2 machine contract', () => {
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  it.each(fixtures.cases)('validates $name', ({ response }) => expect(validate(response)).toBe(true));
  it('rejects identity leakage and imprecise numeric credit', () => {
    const record = fixtures.cases[1].response;
    expect(validate({ ...record, creditAmount: 100 })).toBe(false);
    expect(validate({ ...record, ownerId: 'private' })).toBe(false);
  });
});
