/** @jest-environment node */
import { classifyRepairRow, type RepairRow } from './order-business-name-repair';

const row = {
  id: 'o', orderNo: 'BIZ-01', invoiceId: 'i', invoice: { invNo: 'INV' }, customerId: 'c', customerName: 'Person',
  customer: { id: 'c', orderName: 'BIZ', mark: 'MARK', name: 'Person', companyName: 'Company', orderNames: [] },
  mucontGroup: null, sourceNames: [],
} as unknown as RepairRow;

it('only proposes known document-name mistakes with stable customer identity', () => {
  expect(classifyRepairRow(row)).toMatchObject({ decision: 'REPAIR', newValue: 'BIZ', evidence: ['CUSTOMER_NAME'] });
  expect(classifyRepairRow({ ...row, customerName: 'biz' })).toMatchObject({ decision: 'KEEP' });
  expect(classifyRepairRow({ ...row, customerName: 'Unexplained' })).toMatchObject({ decision: 'REVIEW', reason: 'UNPROVEN_TEXT' });
  expect(classifyRepairRow({ ...row, customer: null })).toMatchObject({ decision: 'REVIEW' });
});
it('does not guess between aliases and makes provenance ordering deterministic', () => {
  const aliases = { ...row.customer!, orderNames: [{ orderName: 'ALT' }] };
  expect(classifyRepairRow({ ...row, customer: aliases })).toMatchObject({ decision: 'REPAIR', newValue: 'BIZ' });
  expect(classifyRepairRow({ ...row, orderNo: 'OTHER-01', customer: aliases })).toMatchObject({ decision: 'REVIEW', reason: 'AMBIGUOUS_REGISTERED_ALIASES' });
  const sourceNames = [{ generationId: 'z', value: 'Person' }, { generationId: 'a', value: 'Person' }];
  expect(classifyRepairRow({ ...row, sourceNames })).toEqual(classifyRepairRow({ ...row, sourceNames: [...sourceNames].reverse() }));
});
