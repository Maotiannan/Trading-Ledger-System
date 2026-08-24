'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  CustomerOrderHistoryContent,
  type CustomerOrderHistoryContentProps,
} from './customer-order-history-content';

export type {
  CustomerOrderHistory,
  CustomerOrderHistoryOrder,
  CustomerOrderHistoryPagination,
  CustomerOrderHistoryReceipt,
} from './customer-order-history-content';

export type CustomerOrderHistoryDialogProps = CustomerOrderHistoryContentProps & {
  open: boolean;
  title: string;
  allOrderNames?: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CustomerOrderHistoryDialog({
  open,
  title,
  allOrderNames = false,
  onOpenChange,
  ...historyProps
}: CustomerOrderHistoryDialogProps) {
  const { tx } = historyProps;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-6xl flex-col p-4 sm:p-6 md:w-fit md:max-w-[calc(100vw-32px)]">
        <DialogHeader>
          <DialogTitle>{tx('ORDER_NAME 历史', 'ORDER_NAME History')}: {title || '-'}</DialogTitle>
          <DialogDescription>
            {allOrderNames
              ? tx('查看该客户所有 ORDER_NAME 的历史订单，以及最近收据状态。', 'Review historical orders for all customer ORDER_NAME values and recent receipt statuses.')
              : tx('查看该客户在此 ORDER_NAME 下的历史订单，以及最近收据状态。', 'Review historical orders for this ORDER_NAME and recent receipt statuses.')}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <CustomerOrderHistoryContent {...historyProps} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
