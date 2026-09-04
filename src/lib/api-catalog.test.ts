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

  it('should expose payment detail preview and export image routes', () => {
    expect(findAction('/api/detail', 'preview-image')?.method).toBe('GET');
    expect(findAction('/api/detail', 'export-pic')?.method).toBe('GET');
  });

  it('should expose independent Orders page actions', () => {
    expect(findAction('/api/orders', 'list')?.method).toBe('GET');
    expect(findAction('/api/orders', 'customer-options')?.method).toBe('GET');
    expect(findAction('/api/orders', 'create')?.method).toBe('POST');
    expect(findAction('/api/orders', 'update')?.method).toBe('POST');
  });

  it('should document explicit system-pool resolutions for invoice rematch', () => {
    expect(findAction('/api/invoice', 'rematch-preview')?.method).toBe('PUT');
    expect(findAction('/api/invoice', 'rematch-apply')?.bodyExample).toEqual({
      action: 'rematch-apply',
      resolutions: [],
      poolResolutions: [{ sourceOrderId: 'pool-order-id', targetInvoiceId: 'invoice-id' }],
    });
  });

  it('should expose customer sync endpoint', () => {
    expect(findAction('/api/sync/customers', 'sync')?.method).toBe('GET');
    expect(findAction('/api/sync/customers/by-orders', 'lookup-by-orders')?.method).toBe('POST');
    expect(findAction('/api/customers/order-consignee/write', 'write-order-consignee')?.method).toBe('POST');
  });

  it('should expose protected upload-image read and upload actions', () => {
    expect(findAction('/api/upload-image', 'read')?.method).toBe('GET');
    expect(findAction('/api/upload-image', 'upload')?.method).toBe('POST');
  });

  it('should expose dashboard customer history search actions', () => {
    expect(findAction('/api/dashboard/customer-history-search', 'search')?.method).toBe('GET');
    expect(findAction('/api/dashboard/customer-history-search', 'history')?.method).toBe('GET');
  });

  it('should expose customer analytics ranking and detail actions', () => {
    expect(findAction('/api/dashboard/customer-analytics', 'ranking')?.method).toBe('GET');
    expect(findAction('/api/dashboard/customer-analytics', 'detail')?.method).toBe('GET');
  });

  it('should expose Excel ML token and lookup routes', () => {
    expect(findAction('/api/excel/token', 'generate')?.method).toBe('POST');
    expect(findAction('/api/excel/token', 'revoke')?.method).toBe('POST');
    expect(findAction('/api/excel/ml', 'lookup')?.method).toBe('GET');
    expect(findAction('/api/excel/ml/batch', 'batch-lookup')?.method).toBe('POST');
  });

  it('should expose customer email maintenance and admin notification workflows', () => {
    expect(findAction('/api/customer-notification-emails', 'list')?.method).toBe('GET');
    expect(findAction('/api/customer-notification-emails', 'update-language')?.method).toBe('POST');
    expect(findAction('/api/email-settings', 'save-settings')?.method).toBe('POST');
    expect(findAction('/api/email-settings', 'preview-template')?.method).toBe('POST');
    expect(findAction('/api/email-notifications', 'list')?.method).toBe('GET');
    expect(findAction('/api/email-notifications', 'approve')?.method).toBe('POST');
    expect(findAction('/api/email-notifications', 'create-correction')?.method).toBe('POST');
  });
});
