'use client';

import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  CustomerOrderHistoryContent,
  type CustomerOrderHistoryContentProps,
} from '@/components/workspace/modules/customers/components/customer-order-history-content';
import { formatOrderNameDisplay, formatUsdAmount } from '@/lib/display-format';
import { formatAppDate } from '@/lib/app-time';
import type {
  DashboardCustomerOutstanding,
  DashboardCustomerOutstandingOrder,
} from '@/lib/dashboard-customer-outstanding';
import { downloadCustomerOutstandingStatement } from '@/lib/customer-outstanding-export-image';
import { Download, Loader2 } from 'lucide-react';
import { useState } from 'react';

type StatementLanguage = 'en' | 'fr';

export type DashboardCustomerDetailDialogProps = {
  open: boolean;
  customerId: string | null;
  title: string;
  customerMark?: string;
  outstanding: DashboardCustomerOutstanding | null;
  historyProps: CustomerOrderHistoryContentProps;
  unboundMessage: string;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
};

function OutstandingSection({
  kind,
  orders,
  subtotal,
  tx,
}: {
  kind: 'released' | 'in-transit';
  orders: DashboardCustomerOutstandingOrder[];
  subtotal: number;
  tx: DashboardCustomerDetailDialogProps['tx'];
}) {
  const released = kind === 'released';
  const title = released ? tx('已放单', 'Released') : tx('运输中', 'In Transit');

  return (
    <section data-customer-detail-section={kind} className="rounded-md border">
      <div className="flex flex-col gap-2 border-b bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
        <Badge
          variant="outline"
          className={released
            ? 'w-fit border-green-300 bg-green-50 text-green-800'
            : 'w-fit border-amber-300 bg-amber-50 text-amber-800'}
        >
          {title}
        </Badge>
        <span className="font-semibold text-red-600">
          {tx(`小计：${formatUsdAmount(subtotal)}`, `Subtotal: ${formatUsdAmount(subtotal)}`)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ORDER NO</TableHead>
              <TableHead>INV NO</TableHead>
              {released ? <TableHead>{tx('天数', 'Days')}</TableHead> : null}
              <TableHead>{tx('余额', 'Balance')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.orderId}>
                <TableCell className="font-medium">{formatOrderNameDisplay(order.orderNo)}</TableCell>
                <TableCell>{order.invNo}</TableCell>
                {released ? <TableCell>{order.daysSinceRelease ?? '-'}</TableCell> : null}
                <TableCell className="font-medium text-red-600">{formatUsdAmount(order.outstanding)}</TableCell>
              </TableRow>
            ))}
            {orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={released ? 4 : 3} className="py-6 text-center text-muted-foreground">
                  {released
                    ? tx('暂无已放单未付清订单', 'No released unpaid orders')
                    : tx('暂无运输中未付清订单', 'No in-transit unpaid orders')}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

export function DashboardCustomerDetailDialog({
  open,
  customerId,
  title,
  customerMark,
  outstanding,
  historyProps,
  unboundMessage,
  tx,
  onOpenChange,
}: DashboardCustomerDetailDialogProps) {
  const [exporting, setExporting] = useState(false);
  const [languageDialogOpen, setLanguageDialogOpen] = useState(false);
  const releasedOrders = outstanding?.orders.filter((order) => order.statusGroup === 'RELEASED') ?? [];
  const inTransitOrders = outstanding?.orders.filter((order) => order.statusGroup === 'IN_TRANSIT') ?? [];

  const exportStatement = async (language: StatementLanguage) => {
    if (!outstanding) return;
    setLanguageDialogOpen(false);
    setExporting(true);
    const french = language === 'fr';
    try {
      await downloadCustomerOutstandingStatement({
        customerMark: customerMark || title,
        statementDate: formatAppDate(new Date()),
        outstanding,
        labels: {
          title: french ? 'État des encours client' : 'Customer Outstanding Statement',
          customer: french ? 'Client' : 'Customer',
          statementDate: french ? 'Date du relevé' : 'Statement Date',
          totalUnpaid: french ? 'Total impayé' : 'Total Unpaid',
          released: french ? 'Commandes libérées' : 'Released Orders',
          inTransit: french ? 'Commandes en transit' : 'In-Transit Orders',
          orderNo: french ? 'N° DE COMMANDE' : 'ORDER NO',
          balance: french ? 'SOLDE' : 'BALANCE',
          days: french ? 'JOURS' : 'DAYS',
          subtotal: french ? 'Sous-total' : 'Subtotal',
          contactNote: french ? 'Veuillez contacter MU Group si une information est incorrecte.' : 'Please contact MU Group if any information is incorrect.',
        },
      });
    } catch {
      window.alert(tx('图片导出失败，请稍后重试。', 'Image export failed. Please try again later.'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="dashboard-customer-detail-dialog"
        className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-6xl flex-col p-4 sm:p-6 md:max-w-[calc(100vw-2rem)]"
      >
        <DialogHeader>
          <DialogTitle className="flex flex-col gap-1 break-words sm:flex-row sm:items-center sm:justify-between">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{formatOrderNameDisplay(title) || '-'}</span>
            {outstanding ? (
              <button
                type="button"
                aria-label={tx('下载客户欠款图片', 'Download outstanding statement')}
                title={tx('下载客户欠款图片', 'Download outstanding statement')}
                className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={exporting}
                onClick={() => setLanguageDialogOpen(true)}
              >
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              </button>
            ) : null}
          </span>
            <span className="text-sm font-semibold text-red-600">
              {tx('未付总计', 'Total Unpaid')}: {formatUsdAmount(outstanding?.totalOutstanding ?? 0)}
            </span>
          </DialogTitle>
          <DialogDescription>
            {tx('客户欠款、历史订单和最近付款记录', 'Customer outstanding, historical orders, and recent payments.')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <OutstandingSection
            kind="released"
            orders={releasedOrders}
            subtotal={outstanding?.statusSubtotals.released ?? 0}
            tx={tx}
          />
          <OutstandingSection
            kind="in-transit"
            orders={inTransitOrders}
            subtotal={outstanding?.statusSubtotals.inTransit ?? 0}
            tx={tx}
          />
          {customerId ? (
            <section data-customer-detail-section="history">
              <CustomerOrderHistoryContent {...historyProps} sectionOrder="receipts-first" />
            </section>
          ) : (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {unboundMessage}
            </p>
          )}
        </div>
      </DialogContent>
      <Dialog open={languageDialogOpen} onOpenChange={setLanguageDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <DialogHeader>
            <DialogTitle>{tx('选择图片语言', 'Choose statement language')}</DialogTitle>
            <DialogDescription>{tx('请选择要生成的客户欠款图片语言。', 'Choose the language for the customer outstanding statement.')}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              className="rounded-md border px-4 py-3 text-sm font-semibold hover:bg-muted"
              onClick={() => void exportStatement('en')}
              disabled={exporting}
            >
              English
            </button>
            <button
              type="button"
              className="rounded-md border px-4 py-3 text-sm font-semibold hover:bg-muted"
              onClick={() => void exportStatement('fr')}
              disabled={exporting}
            >
              Français
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
