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

  it('should expose receipt edit approval actions', () => {
    expect(findAction('/api/receipt', 'request-edit')?.method).toBe('POST');
    expect(findAction('/api/receipt', 'review-edit')?.method).toBe('POST');
    expect(findAction('/api/receipt', 'list-edit-requests')?.method).toBe('POST');
  });

  it('should expose detail and swift edit approval actions', () => {
    expect(findAction('/api/detail', 'request-edit')?.method).toBe('POST');
    expect(findAction('/api/detail', 'review-edit')?.method).toBe('POST');
    expect(findAction('/api/detail', 'list-edit-requests')?.method).toBe('POST');
    expect(findAction('/api/swift', 'update')?.method).toBe('POST');
    expect(findAction('/api/swift', 'request-edit')?.method).toBe('POST');
    expect(findAction('/api/swift', 'review-edit')?.method).toBe('POST');
    expect(findAction('/api/swift', 'list-edit-requests')?.method).toBe('POST');
  });

  it('should expose direct-create for receipt/detail/swift', () => {
    expect(findAction('/api/receipt', 'direct-create')?.method).toBe('POST');
    expect(findAction('/api/detail', 'direct-create')?.method).toBe('POST');
    expect(findAction('/api/swift', 'direct-create')?.method).toBe('POST');
  });

  it('should expose independent Orders page actions', () => {
    expect(findAction('/api/orders', 'list')?.method).toBe('GET');
    expect(findAction('/api/orders', 'customer-options')?.method).toBe('GET');
    expect(findAction('/api/orders', 'create')?.method).toBe('POST');
    expect(findAction('/api/orders', 'update')?.method).toBe('POST');
  });

  it('should expose protected upload-image read and upload actions', () => {
    expect(findAction('/api/upload-image', 'read')?.method).toBe('GET');
    expect(findAction('/api/upload-image', 'upload')?.method).toBe('POST');
  });

  it('should expose Excel ML token and lookup routes', () => {
    expect(findAction('/api/excel/token', 'generate')?.method).toBe('POST');
    expect(findAction('/api/excel/token', 'revoke')?.method).toBe('POST');
    expect(findAction('/api/excel/ml', 'lookup')?.method).toBe('GET');
    expect(findAction('/api/excel/ml/batch', 'batch-lookup')?.method).toBe('POST');
  });
});
