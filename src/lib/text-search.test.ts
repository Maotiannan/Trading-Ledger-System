import { filterRowsBySearch } from './text-search';

describe('filterRowsBySearch', () => {
  it('matches nested fields and scalar values', () => {
    const rows = [
      {
        id: '1',
        invNo: 'INV-001',
        customer: {
          mark: 'MAB-1',
          address: 'Conakry Port',
        },
      },
      {
        id: '2',
        invNo: 'INV-002',
        customer: {
          mark: 'IB',
          address: 'Kindia',
        },
      },
    ];

    expect(filterRowsBySearch(rows, 'conakry')).toHaveLength(1);
    expect(filterRowsBySearch(rows, 'mab-1')[0]?.id).toBe('1');
    expect(filterRowsBySearch(rows, 'inv-002')[0]?.id).toBe('2');
  });
});
