import fixtures from '../../../docs/integrations/invoice-generation-v1/fixtures.json';
import { parseInvoiceGeneration, invoicePayloadHash } from './mucont-invoice-contract';

describe('MuCont invoice frozen contract', () => {
  const snapshots = fixtures.map((v) => v.request);
  it('accepts every frozen generation fixture', () => {
    expect(snapshots.length).toBeGreaterThan(0);
    snapshots.forEach((row) => expect(parseInvoiceGeneration(row)).toEqual(row));
  });
  it('rejects inconsistent totals and duplicate stable groups', () => {
    const value = parseInvoiceGeneration(snapshots[0]);
    expect(() => parseInvoiceGeneration({ ...value, invoiceTotal: '1.00' })).toThrow();
    expect(() => parseInvoiceGeneration({ ...value, customers: [value.customers[0], value.customers[0]] })).toThrow();
  });
  it('canonical hashing ignores property order, not payload changes', () => {
    expect(invoicePayloadHash({ a: 1, b: { c: 2 } })).toBe(invoicePayloadHash({ b: { c: 2 }, a: 1 }));
    expect(invoicePayloadHash({ a: 1 })).not.toBe(invoicePayloadHash({ a: 2 }));
  });
});
