export type ApiAction = {
  action: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  description: string;
  bodyExample?: Record<string, unknown>;
};

export type ApiModule = {
  endpoint: string;
  description: string;
  actions: ApiAction[];
};

export const apiCatalog: ApiModule[] = [
  {
    endpoint: '/api/auth',
    description: 'Authentication and user administration',
    actions: [
      { action: 'login', method: 'POST', description: 'Login and set session cookie', bodyExample: { action: 'login', email: 'admin@example.com', password: '***' } },
      { action: 'logout', method: 'POST', description: 'Logout and clear session cookie', bodyExample: { action: 'logout' } },
      { action: 'me', method: 'POST', description: 'Get current user by session', bodyExample: { action: 'me' } },
      { action: 'list', method: 'POST', description: 'List users (admin)', bodyExample: { action: 'list' } },
      { action: 'create', method: 'POST', description: 'Create user (admin)', bodyExample: { action: 'create', email: 'user@example.com', password: '***', name: 'User' } },
      { action: 'delete', method: 'POST', description: 'Delete user (admin)', bodyExample: { action: 'delete', userId: 'user-id' } },
      { action: 'reset-password', method: 'POST', description: 'Reset password (admin)', bodyExample: { action: 'reset-password', userId: 'user-id', password: '***' } },
      { action: 'change-password', method: 'POST', description: 'Change own password', bodyExample: { action: 'change-password', oldPassword: '***', newPassword: '***' } },
    ],
  },
  {
    endpoint: '/api/invoice',
    description: 'Invoice and order management',
    actions: [
      { action: 'list', method: 'GET', description: 'List invoices' },
      { action: 'create', method: 'POST', description: 'Create invoice and orders', bodyExample: { invNo: 'L001MH', orders: [{ orderNo: 'ABC-1', tokens: 100, amount: 100 }] } },
      { action: 'import-excel', method: 'POST', description: 'Bulk import invoices from Excel (multipart form)' },
      { action: 'import-rows', method: 'POST', description: 'Retry import issue rows only', bodyExample: { action: 'import-rows', rows: [{ rowNo: 2, invNo: 'L001MH', orderNo: 'ABC-1', amount: '100', customerMark: 'MAB-1' }] } },
      { action: 'updateOrder', method: 'PUT', description: 'Update order', bodyExample: { action: 'updateOrder', orderId: 'order-id', tokens: 120, amount: 120 } },
      { action: 'addOrder', method: 'PUT', description: 'Add order to invoice', bodyExample: { action: 'addOrder', invoiceId: 'invoice-id', orderNo: 'ABC-2', tokens: 50, amount: 50 } },
      { action: 'deleteOrder', method: 'PUT', description: 'Delete order', bodyExample: { action: 'deleteOrder', orderId: 'order-id' } },
      { action: 'transferBalance', method: 'PUT', description: 'Transfer overpaid balance between orders', bodyExample: { action: 'transferBalance', fromOrderId: 'from-id', toOrderId: 'to-id', transferAmount: 10 } },
      { action: 'rematch', method: 'PUT', description: 'Run rematch process', bodyExample: { action: 'rematch' } },
      { action: 'delete', method: 'DELETE', description: 'Delete invoice', bodyExample: { invoiceId: 'invoice-id' } },
    ],
  },
  {
    endpoint: '/api/orders',
    description: 'Independent Orders page records that do not participate in finance matching',
    actions: [
      { action: 'list', method: 'GET', description: 'List visible Orders page records' },
      { action: 'customer-options', method: 'GET', description: 'List customer candidates for Orders page creation' },
      { action: 'create', method: 'POST', description: 'Create an independent Orders page record; visible finance-order duplicates are allowed and can infer/link customer data, while Orders-page duplicates are still rejected', bodyExample: { action: 'create', orderNo: 'PIKIN-23', customerId: 'customer-id', remark: 'PI preparing' } },
      { action: 'update', method: 'POST', description: 'Update status/remark for visible accounts; PI/system note fields require upper ADMIN accounts', bodyExample: { action: 'update', orderId: 'order-tracker-id', status: 'Confirmed', piStatus: true, systemNote: 'PI approved' } },
    ],
  },
  {
    endpoint: '/api/sync/customers',
    description: 'Incremental customer synchronization for external clients',
    actions: [
      {
        action: 'sync',
        method: 'GET',
        description: 'Return customer upserts, delete tombstones, disabled markers, and the next cursor since the last sync',
        bodyExample: { query: 'since=<opaque-nextCursor>&limit=500' },
      },
    ],
  },
  {
    endpoint: '/api/customer/fixes',
    description: 'Customer fix queue and repair actions',
    actions: [
      { action: 'list', method: 'GET', description: 'List visible order/receipt records that still need customer repair; stale repair flags are self-cleared when the source now matches a visible customer' },
      { action: 'resolve-order', method: 'POST', description: 'Repair an order by saving corrected customer fields', bodyExample: { action: 'resolve-order', orderId: 'order-id', customerMark: 'MAB-1', customerName: 'Customer', customerPhone: '224...' } },
      { action: 'resolve-receipt', method: 'POST', description: 'Repair an SR_Receipts record by saving corrected customer fields and syncing the linked order when present', bodyExample: { action: 'resolve-receipt', receiptId: 'receipt-id', customerMark: 'MAB-1', customerName: 'Customer', customerPhone: '224...' } },
      { action: 'link-order-customer', method: 'POST', description: 'Repair an order by linking it to an existing visible customer', bodyExample: { action: 'link-order-customer', orderId: 'order-id', customerId: 'customer-id' } },
      { action: 'link-receipt-customer', method: 'POST', description: 'Repair an SR_Receipts record by linking it to an existing visible customer and syncing the linked order when present', bodyExample: { action: 'link-receipt-customer', receiptId: 'receipt-id', customerId: 'customer-id' } },
    ],
  },
  {
    endpoint: '/api/receipt',
    description: 'Receipt OCR and lifecycle',
    actions: [
      { action: 'list', method: 'GET', description: 'List receipts; supports exact amount filtering with amount=<usd>' },
      { action: 'recognize', method: 'POST', description: 'OCR recognize receipt', bodyExample: { action: 'recognize', imageBase64: 'data:image/jpeg;base64,...' } },
      { action: 'confirm', method: 'POST', description: 'Confirm recognized receipt', bodyExample: { action: 'confirm', receipt: {} } },
      { action: 'direct-create', method: 'POST', description: 'Create receipt directly without OCR', bodyExample: { action: 'direct-create', usd: 100, orderNo: 'ORDER-001', customerMark: 'MAB-1' } },
      { action: 'update', method: 'POST', description: 'Update receipt', bodyExample: { action: 'update', receiptId: 'receipt-id', data: '{}' } },
      { action: 'request-edit', method: 'POST', description: 'Submit a receipt edit request for approval (sales)', bodyExample: { action: 'request-edit', receiptId: 'receipt-id', data: { receiptNo: '0001002', date: '2026-05-04', invNo: 'INV-2', customerMark: 'MAB-2', payer: 'BETA', tel: '456' } } },
      { action: 'review-edit', method: 'POST', description: 'Approve or reject a pending receipt edit request (admin)', bodyExample: { action: 'review-edit', requestId: 'request-id', decision: 'approve', comment: 'looks good' } },
      { action: 'list-edit-requests', method: 'POST', description: 'List visible receipt edit requests for the approval page' },
      { action: 'mark-received', method: 'POST', description: 'Finalize receipt completion (admin only)', bodyExample: { action: 'mark-received', receiptId: 'receipt-id' } },
    ],
  },
  {
    endpoint: '/api/receipt-generator',
    description: 'Signed receipt generator flow',
    actions: [
      { action: 'order-context', method: 'GET', description: 'Resolve exact order context for signed receipt generation', bodyExample: { orderNo: 'BIG-ALPHA-07', usdAmount: 2500 } },
      { action: 'session', method: 'GET', description: 'Load a signing session by sessionId', bodyExample: { sessionId: 'session-id' } },
      { action: 'resume-by-receipt', method: 'GET', description: 'Resume an open signing session by receiptId', bodyExample: { receiptId: 'receipt-id' } },
      { action: 'create-session', method: 'POST', description: 'Create a SIGNING_PENDING receipt and signing session', bodyExample: { action: 'create-session', orderNo: 'BIG-ALPHA-07', usdAmount: 2500 } },
      { action: 'finalize', method: 'POST', description: 'Finalize the signed receipt, store assets, and enter normal receipt flow (multipart form)', bodyExample: { action: 'finalize', sessionId: 'session-id', receiptImage: '<png>', receiverSignature: '<png>', payerSignature: '<png>' } },
    ],
  },
  {
    endpoint: '/api/detail',
    description: 'Payment detail OCR and lifecycle',
    actions: [
      { action: 'list', method: 'GET', description: 'List payment details; supports exact amount filtering with amount=<usd>' },
      { action: 'recognize', method: 'POST', description: 'OCR recognize detail', bodyExample: { action: 'recognize', imageBase64: 'data:image/jpeg;base64,...' } },
      { action: 'confirm', method: 'POST', description: 'Confirm recognized detail', bodyExample: { action: 'confirm', detail: {} } },
      { action: 'direct-create', method: 'POST', description: 'Create detail directly without OCR', bodyExample: { action: 'direct-create', items: [{ orderNo: 'ORDER-001', amount: 100 }] } },
      { action: 'update', method: 'POST', description: 'Update detail', bodyExample: { action: 'update', detailId: 'detail-id', data: '{}' } },
      { action: 'request-edit', method: 'POST', description: 'Submit a payment detail edit request for approval (sales)', bodyExample: { action: 'request-edit', detailId: 'detail-id', data: { date: '2026-05-05', items: [{ mark: 'MAB-1', orderNo: 'ORDER-001', amount: 100, receiptId: 'receipt-id' }] } } },
      { action: 'review-edit', method: 'POST', description: 'Approve or reject a pending detail edit request (admin); stale receipt links are re-matched by order and amount during approval', bodyExample: { action: 'review-edit', requestId: 'request-id', decision: 'approve', comment: 'looks good' } },
      { action: 'list-edit-requests', method: 'POST', description: 'List visible payment detail edit requests for the approval page' },
    ],
  },
  {
    endpoint: '/api/swift',
    description: 'SWIFT OCR and lifecycle',
    actions: [
      { action: 'list', method: 'GET', description: 'List swifts; supports exact amount filtering with amount=<usd>' },
      { action: 'recognize', method: 'POST', description: 'OCR recognize swift', bodyExample: { action: 'recognize', imageBase64: 'data:image/jpeg;base64,...' } },
      { action: 'confirm', method: 'POST', description: 'Confirm recognized swift', bodyExample: { action: 'confirm', swift: {} } },
      { action: 'direct-create', method: 'POST', description: 'Create swift directly without OCR', bodyExample: { action: 'direct-create', detailId: 'detail-id', amount: 100 } },
      { action: 'update', method: 'POST', description: 'Update swift', bodyExample: { action: 'update', swiftId: 'swift-id', data: { amount: 100, date: '2026-05-05', senderName: 'sender', senderAddress: 'addr', receiverName: 'receiver', receiverAccount: 'acct' } } },
      { action: 'request-edit', method: 'POST', description: 'Submit a SWIFT edit request for approval (sales)', bodyExample: { action: 'request-edit', swiftId: 'swift-id', data: { amount: 100, date: '2026-05-05', senderName: 'sender', senderAddress: 'addr', receiverName: 'receiver', receiverAccount: 'acct' } } },
      { action: 'review-edit', method: 'POST', description: 'Approve or reject a pending SWIFT edit request (admin)', bodyExample: { action: 'review-edit', requestId: 'request-id', decision: 'approve', comment: 'looks good' } },
      { action: 'list-edit-requests', method: 'POST', description: 'List visible SWIFT edit requests for the approval page' },
      { action: 'delete', method: 'POST', description: 'Delete swift (admin)', bodyExample: { action: 'delete', swiftId: 'swift-id' } },
    ],
  },
  {
    endpoint: '/api/deletion',
    description: 'Deletion requests and approvals',
    actions: [
      { action: 'list', method: 'GET', description: 'List deletion requests' },
      { action: 'request', method: 'POST', description: 'Submit deletion request', bodyExample: { action: 'request', targetType: 'RECEIPT', targetId: 'target-id', reason: 'bad data' } },
      { action: 'approve', method: 'POST', description: 'Approve request (admin)', bodyExample: { action: 'approve', requestId: 'request-id' } },
      { action: 'reject', method: 'POST', description: 'Reject request (admin)', bodyExample: { action: 'reject', requestId: 'request-id' } },
    ],
  },
  {
    endpoint: '/api/report',
    description: 'Export report',
    actions: [
      { action: 'export', method: 'GET', description: 'Export report by format', bodyExample: { format: 'excel|pdf' } },
    ],
  },
  {
    endpoint: '/api/locale',
    description: 'Set UI locale',
    actions: [
      { action: 'set', method: 'POST', description: 'Set locale cookie', bodyExample: { locale: 'zh|en' } },
    ],
  },
  {
    endpoint: '/api/init',
    description: 'Admin bootstrap route (disabled by default)',
    actions: [
      { action: 'init', method: 'POST', description: 'Create initial admin with token header', bodyExample: { header: 'x-init-token: ...' } },
    ],
  },
  {
    endpoint: '/api/settings',
    description: 'System settings',
    actions: [
      { action: 'list', method: 'GET', description: 'Get settings and permissions' },
      { action: 'update-config', method: 'POST', description: 'Update system config (admin)', bodyExample: { action: 'update-config', settings: { OCR_MODEL: 'gpt-4o-mini' } } },
      { action: 'test-ocr', method: 'POST', description: 'Test OCR connectivity (admin)', bodyExample: { action: 'test-ocr' } },
      { action: 'purge-business-data', method: 'POST', description: 'Purge business data but keep users (admin)', bodyExample: { action: 'purge-business-data' } },
      { action: 'purge-branch-data', method: 'POST', description: 'Purge selected branch modules with dependency cascade (admin)', bodyExample: { action: 'purge-branch-data', targetUserId: 'user-id', modules: ['all'], password: '***' } },
    ],
  },
  {
    endpoint: '/api/excel/token',
    description: 'Per-account Excel API token management (session authenticated)',
    actions: [
      { action: 'list', method: 'GET', description: 'List current account Excel token metadata' },
      { action: 'generate', method: 'POST', description: 'Rotate and return a one-time Excel API token', bodyExample: { action: 'generate', name: 'Excel desktop' } },
      { action: 'revoke', method: 'POST', description: 'Revoke a current account Excel API token', bodyExample: { action: 'revoke', id: 'token-id' } },
    ],
  },
  {
    endpoint: '/api/excel/ml',
    description: 'Excel ML single-field lookup (Bearer token authenticated)',
    actions: [
      {
        action: 'lookup',
        method: 'GET',
        description: 'Resolve one field by order number. Field 1 ORDER NAME, 2 COMPANY NAME fallback CUSTOMER NAME, 3 MARK, 4 CUSTOMER NAME, 5 COMPANY NAME, 6 PHONE, 7 CITY, 8 CONSIGNEE, 9 COMPANY ADDRESS, 10 CREDIT, 11 CUSTOMER ID.',
        bodyExample: { header: 'Authorization: Bearer ml_...', query: 'orderNo=GANDO-10&field=2&format=json' },
      },
    ],
  },
  {
    endpoint: '/api/excel/ml/batch',
    description: 'Excel ML batch lookup (Bearer token authenticated)',
    actions: [
      {
        action: 'batch-lookup',
        method: 'POST',
        description: 'Resolve multiple order-number field lookups and return per-row success or errors',
        bodyExample: { items: [{ orderNo: 'GANDO-10', field: 1 }, { orderNo: 'GANDO-10', field: 2 }] },
      },
    ],
  },
  {
    endpoint: '/api/upload-image',
    description: 'Protected business image upload and read',
    actions: [
      { action: 'read', method: 'GET', description: 'Read uploaded image by protected path', bodyExample: { path: '/upload/images/receipts/direct/abc.png' } },
      { action: 'upload', method: 'POST', description: 'Upload protected business image', bodyExample: { action: 'upload', category: 'receipt-direct', file: '<multipart image>' } },
    ],
  },
];

export const configTemplate = {
  required: ['DATABASE_URL', 'SESSION_SECRET'],
  optional: [
    'POSTGRES_DB',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'ENABLE_INIT_ROUTE',
    'INIT_ADMIN_TOKEN',
    'INIT_ADMIN_EMAIL',
    'INIT_ADMIN_PASSWORD',
    'OCR_DISABLED',
    'OCR_API_BASE_URL',
    'OCR_API_KEY',
    'OCR_MODEL',
    'OCR_MAX_RETRIES',
    'OCR_TIMEOUT_MS',
    'OCR_RETRY_BASE_DELAY_MS',
    'OCR_INPUT_COST_PER_1K',
    'OCR_OUTPUT_COST_PER_1K',
    'EXCEL_LOOKUP_RATE_LIMIT_WINDOW_MS',
    'EXCEL_LOOKUP_RATE_LIMIT_MAX',
    'UPLOAD_HOST_DIR',
  ],
} as const;
