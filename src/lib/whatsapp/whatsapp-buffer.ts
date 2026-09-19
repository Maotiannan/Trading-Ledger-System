import { computeOrderBalanceFromReceipts, type ComputeOrderBalanceInput, type OrderBalanceReceiptInput } from '@/lib/order-balance';

export const WHATSAPP_BUFFER_MS = 5 * 60 * 1000;
export const EDITABLE_WHATSAPP_STATUSES = ['PENDING', 'QUEUED', 'PAUSED'] as const;
export const bufferDeadline = (now = new Date()) => new Date(now.getTime() + WHATSAPP_BUFFER_MS);

export function pendingDeliveryUpdate(input: { paused: boolean; changed: boolean; wasPaused: boolean; requiresApproval: boolean }, now = new Date()) {
  if (input.paused) return { status: 'PAUSED' as const, failureCode: 'DELETION_PENDING', approvedAt: null, approvedBy: null };
  if (!input.changed && !input.wasPaused) return {};
  return { status: input.requiresApproval ? 'PENDING' as const : 'QUEUED' as const,
    nextSendAt: bufferDeadline(now), failureCode: null, approvedAt: null, approvedBy: null };
}

type SequencedReceipt = OrderBalanceReceiptInput & { id: string; createdAt: Date };
// Recording sequence, not an editable/backdated receipt date, defines the cutoff.
export function computeReceiptBalanceAfter(order: Omit<ComputeOrderBalanceInput, 'receipts'> & { receipts: SequencedReceipt[] }, receipt: Pick<SequencedReceipt, 'id' | 'createdAt'>) {
  return computeOrderBalanceFromReceipts({ amount: order.amount, receipts: order.receipts.filter(row =>
    row.createdAt < receipt.createdAt || (row.createdAt.getTime() === receipt.createdAt.getTime() && row.id <= receipt.id)) });
}
