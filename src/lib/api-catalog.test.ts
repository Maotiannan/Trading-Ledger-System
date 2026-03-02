import { apiCatalog } from '@/lib/api-catalog';

function findAction(endpoint: string, action: string) {
  const apiModule = apiCatalog.find((item) => item.endpoint === endpoint);
  if (!apiModule) return null;
  return apiModule.actions.find((item) => item.action === action) || null;
}

describe('api-catalog consistency', () => {
  it('should mark receipt and detail update actions as POST', () => {
    expect(findAction('/api/receipt', 'update')?.method).toBe('POST');
    expect(findAction('/api/detail', 'update')?.method).toBe('POST');
  });

  it('should expose direct-create for receipt/detail/swift', () => {
    expect(findAction('/api/receipt', 'direct-create')?.method).toBe('POST');
    expect(findAction('/api/detail', 'direct-create')?.method).toBe('POST');
    expect(findAction('/api/swift', 'direct-create')?.method).toBe('POST');
  });
});
