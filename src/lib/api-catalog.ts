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
    ],
  },
  {
    endpoint: '/api/invoice',
    description: 'Invoice and order management',
    actions: [
      { action: 'list', method: 'GET', description: 'List invoices' },
      { action: 'create', method: 'POST', description: 'Create invoice and orders', bodyExample: { invNo: 'L001MH', orders: [{ orderNo: 'ABC-1', tokens: 100, amount: 100 }] } },
      { action: 'updateOrder', method: 'PUT', description: 'Update order', bodyExample: { action: 'updateOrder', orderId: 'order-id', tokens: 120, amount: 120 } },
      { action: 'addOrder', method: 'PUT', description: 'Add order to invoice', bodyExample: { action: 'addOrder', invoiceId: 'invoice-id', orderNo: 'ABC-2', tokens: 50, amount: 50 } },
      { action: 'deleteOrder', method: 'PUT', description: 'Delete order', bodyExample: { action: 'deleteOrder', orderId: 'order-id' } },
      { action: 'transferBalance', method: 'PUT', description: 'Transfer overpaid balance between orders', bodyExample: { action: 'transferBalance', fromOrderId: 'from-id', toOrderId: 'to-id', transferAmount: 10 } },
      { action: 'rematch', method: 'PUT', description: 'Run rematch process', bodyExample: { action: 'rematch' } },
      { action: 'delete', method: 'DELETE', description: 'Delete invoice', bodyExample: { invoiceId: 'invoice-id' } },
    ],
  },
  {
    endpoint: '/api/receipt',
    description: 'Receipt OCR and lifecycle',
    actions: [
      { action: 'list', method: 'GET', description: 'List receipts' },
      { action: 'recognize', method: 'POST', description: 'OCR recognize receipt', bodyExample: { action: 'recognize', imageBase64: 'data:image/jpeg;base64,...' } },
      { action: 'confirm', method: 'POST', description: 'Confirm recognized receipt', bodyExample: { action: 'confirm', receipt: {} } },
      { action: 'update', method: 'PUT', description: 'Update receipt', bodyExample: { action: 'update', id: 'receipt-id', updates: {} } },
      { action: 'mark-received', method: 'PUT', description: 'Mark receipt as received (admin)', bodyExample: { action: 'mark-received', receiptId: 'receipt-id' } },
    ],
  },
  {
    endpoint: '/api/detail',
    description: 'Payment detail OCR and lifecycle',
    actions: [
      { action: 'list', method: 'GET', description: 'List details' },
      { action: 'recognize', method: 'POST', description: 'OCR recognize detail', bodyExample: { action: 'recognize', imageBase64: 'data:image/jpeg;base64,...' } },
      { action: 'confirm', method: 'POST', description: 'Confirm recognized detail', bodyExample: { action: 'confirm', detail: {} } },
      { action: 'update', method: 'PUT', description: 'Update detail', bodyExample: { action: 'update', id: 'detail-id', updates: {} } },
    ],
  },
  {
    endpoint: '/api/swift',
    description: 'SWIFT OCR and lifecycle',
    actions: [
      { action: 'list', method: 'GET', description: 'List swifts' },
      { action: 'recognize', method: 'POST', description: 'OCR recognize swift', bodyExample: { action: 'recognize', imageBase64: 'data:image/jpeg;base64,...' } },
      { action: 'confirm', method: 'POST', description: 'Confirm recognized swift', bodyExample: { action: 'confirm', swift: {} } },
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
  ],
} as const;
