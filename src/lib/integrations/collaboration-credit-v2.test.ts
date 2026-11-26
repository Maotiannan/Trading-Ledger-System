/** @jest-environment node */
import { Prisma } from '@prisma/client';
import { customerCreditCodeError } from '@/lib/customer-credit-codes';
import { toCollaborationCreditRecordV2, parseCreditWriteback } from './collaboration-credit-v2';

const source = { id: 'synthetic-source', companyName: 'SYNTHETIC BUYER', credit: new Prisma.Decimal('9007199254740993.01'),
  companyAddress: 'SYNTHETIC ADDRESS', companyContact: null, customerCode: null, creditCode: null,
  orderName: 'SYNTHETIC', phone: '+000 123', updatedAt: new Date('2026-11-03T00:00:00.000Z') };
const request = () => ({ requestId: 'synthetic-request', expectedSourceVersion: 'sha256:' + 'a'.repeat(64),
  confirmation: 'MODIFY_WRITEBACK_CONFIRM', actor: { id: 'synthetic-actor', name: 'Synthetic user' }, fields: { customerCode: '001', creditCode: '002' } });

describe('credit V2 approved source fields and explicit writeback', () => {
  it('projects the requested phone and abbreviation separately from company contact, preserving exact credit and missing manual codes', () => {
    const record = toCollaborationCreditRecordV2(source);
    expect(record).toMatchObject({ orderName: 'SYNTHETIC', phone: '+000 123', contacts: { details: null },
      customerCode: null, creditCode: null, creditAmount: '9007199254740993.01', currency: 'USD' });
    expect(record.missingFields).toEqual(expect.arrayContaining(['customerCode', 'creditCode']));
    expect(toCollaborationCreditRecordV2({ ...source, phone: '+000 456' }).sourceVersion).not.toBe(record.sourceVersion);
    expect(toCollaborationCreditRecordV2({ ...source, customerCode: '001' }).sourceVersion).not.toBe(record.sourceVersion);
    expect(toCollaborationCreditRecordV2(source).sourceVersion).toBe(record.sourceVersion);
  });
  it('requires both manual codes only for nonzero credit without inventing IDs', () => {
    expect(customerCreditCodeError(null, null, null)).toBeNull();
    expect(customerCreditCodeError('0.00', null, null)).toBeNull();
    expect(customerCreditCodeError('1.00', null, '002')).toMatch(/required/);
    expect(customerCreditCodeError('-1.00', '001', null)).toMatch(/required/);
    expect(customerCreditCodeError('9007199254740993.01', '001', '002')).toBeNull();
    expect(customerCreditCodeError('0', 'x'.repeat(192), null)).toMatch(/191/);
  });
  it('requires explicit confirmation, external actor, expected version, request identity and a strict field allowlist', () => {
    expect(parseCreditWriteback(request()).fields).toEqual({ customerCode: '001', creditCode: '002' });
    for (const bad of [null, [], {}, { ...request(), confirmation: 'CONFIRM' }, { ...request(), actor: {} },
      { ...request(), expectedSourceVersion: 'stale' }, { ...request(), fields: {} },
      { ...request(), fields: { ownerId: 'other' } }, { ...request(), extra: true }]) {
      expect(() => parseCreditWriteback(bad)).toThrow();
    }
  });
  it('keeps decimal strings and explicit-null semantics, rejecting numeric coercion, bad currency and blank identity fields', () => {
    expect(parseCreditWriteback({ ...request(), fields: { creditAmount: '9007199254740993.01', address: null, currency: 'USD' } }).fields)
      .toEqual({ creditAmount: '9007199254740993.01', address: null, currency: 'USD' });
    for (const fields of [{ creditAmount: 100 }, { creditAmount: '-1.00' }, { creditAmount: '1.001' },
      { creditAmount: '1e6' }, { currency: 'EUR' }, { orderName: '' }, { phone: null }, { customerCode: 1 }]) {
      expect(() => parseCreditWriteback({ ...request(), fields })).toThrow();
    }
  });
});
