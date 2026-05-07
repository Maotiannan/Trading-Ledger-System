import { formatCustomerPayerLabel, getCustomerPayerBase } from './customer-display';

describe('customer display helpers', () => {
  it('prefers COMPANY_NAME and appends MARK for payer/customer labels', () => {
    expect(formatCustomerPayerLabel({
      companyName: ' Alpha Trading SARL ',
      name: 'Alpha Oumar Diallo',
      mark: ' Big Alpha ',
    })).toBe('Alpha Trading SARL "Big Alpha"');
  });

  it('falls back to customer NAME when COMPANY_NAME is empty', () => {
    expect(formatCustomerPayerLabel({
      companyName: '   ',
      name: 'Alpha Oumar Diallo',
      mark: 'Big Alpha',
    })).toBe('Alpha Oumar Diallo "Big Alpha"');
  });

  it('does not create MARK-only payer labels unless explicitly requested', () => {
    expect(formatCustomerPayerLabel({
      companyName: '',
      name: '',
      mark: 'Big Alpha',
    })).toBeNull();
    expect(formatCustomerPayerLabel({
      companyName: '',
      name: '',
      mark: 'Big Alpha',
    }, { fallbackToMark: true })).toBe('Big Alpha');
  });

  it('returns the payer base without the MARK decoration', () => {
    expect(getCustomerPayerBase({
      companyName: '',
      name: 'Alpha Oumar Diallo',
    })).toBe('Alpha Oumar Diallo');
  });
});
