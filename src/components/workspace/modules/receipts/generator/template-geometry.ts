export const RECEIPT_TEMPLATE_CANVAS = { width: 1200, height: 1650 } as const;

export const RECEIPT_TEMPLATE_SIGNATURE_BOXES = {
  receiver: { x: 80, y: 1200, width: 420, height: 160 },
  payer: { x: 660, y: 1200, width: 420, height: 160 },
} as const;

export const RECEIPT_TEMPLATE_TEXT_ROWS = [
  { key: 'orderNo', label: 'Order No.', x: 60, y: 190 },
  { key: 'invNo', label: 'Invoice No.', x: 60, y: 232 },
  { key: 'clientName', label: 'Client', x: 60, y: 274 },
  { key: 'clientTel', label: 'Tel', x: 60, y: 316 },
  { key: 'usdAmount', label: 'Amount (USD)', x: 60, y: 358 },
  { key: 'amountInWords', label: 'Amount in words', x: 60, y: 400 },
  { key: 'motif', label: 'Motif', x: 60, y: 442 },
  { key: 'balanceBefore', label: 'Balance before', x: 60, y: 484 },
  { key: 'balanceAfter', label: 'Balance after', x: 60, y: 526 },
  { key: 'resteAPayer', label: 'Reste a payer', x: 60, y: 568 },
  { key: 'receivedBy', label: 'Received by', x: 60, y: 610 },
] as const;
