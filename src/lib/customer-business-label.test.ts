import { customerBusinessLabel, customerBusinessNames, customerOrderName } from './customer-business-label';

const customer = { orderName: 'Alpha', mark: 'Shipping Mark', orderNames: [{ orderName: 'AL PHA' }, { orderName: 'Beta' }] };
it('keeps primary first and deduplicates registered aliases without returning a display string as a matching key', () => {
  expect(customerBusinessNames(customer)).toEqual(['Alpha', 'Beta']);
  expect(customerBusinessLabel(customer)).toBe('ALPHA / BETA');
  expect(customerOrderName(customer, 'BETA')).toBe('Beta');
  expect(customerOrderName(customer, 'Person')).toBe('Alpha');
});
it('uses MARK or an explicit order fallback, never a person name', () => {
  expect(customerBusinessLabel({ mark: 'Mark' })).toBe('MARK');
  expect(customerBusinessLabel(null, 'ORDER-01')).toBe('ORDER-01');
  expect(customerBusinessLabel({ mark: '', orderName: '' }, 'OLD MARK')).toBe('-');
});
