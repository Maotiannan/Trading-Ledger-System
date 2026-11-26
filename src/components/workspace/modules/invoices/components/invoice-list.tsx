'use client';

import { activePoolRowCount } from '@/lib/prepayments/pool-types';

import type { CustomerCandidate } from '@/components/workspace/shared';
import type { Invoice, Order } from '@/lib/store';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MoneyInput } from '@/components/workspace/modules/shared/money-input';
import { formatOrderNameDisplay, formatUsdAmount } from '@/lib/display-format';
import { Loader2, Plus, Trash2, ArrowRight, ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import type { BranchAdminOption, TransferFromOrder } from '../types';
import { InvoiceSourceActions } from './invoice-source-actions';
import { InvoiceRenameAction } from './invoice-rename-action';
import { DepositPoolTable } from './deposit-pool-table';

export type InvoiceListProps = {
  invoices: Invoice[];
  expandedInvoices: Set<string>;
  isManager: boolean;
  isAdmin: boolean;
  addingOrderToInvoice: string | null;
  branchAdminOptions: BranchAdminOption[];
  branchAdminLoading: boolean;
  assigningInvoiceId: string | null;
  invoiceBranchAdminSelections: Record<string, string>;
  newOrderNo: string;
  newOrderAmount: string;
  newOrderCustomerMark: string;
  newOrderCustomerId: string;
  newOrderCustomerCandidates: CustomerCandidate[];
  addError: string;
  editingInvoiceDateId: string | null;
  editingInvoiceShipDate: string;
  editingInvoiceReleaseDate: string;
  invoiceDateSaving: boolean;
  submitting: boolean;
  tx: (zh: string, en: string) => string;
  onToggleInvoice: (invoiceId: string) => void;
  onOpenInvoiceDateEditor: (invoiceId: string, currentShipDate?: string | null, currentReleaseDate?: string | null) => void;
  onInvoiceBranchAdminSelect: (invoiceId: string, targetAdminId: string) => void;
  onAssignInvoiceBranchAdmin: (invoiceId: string) => void;
  onEditingInvoiceShipDateChange: (value: string) => void;
  onEditingInvoiceReleaseDateChange: (value: string) => void;
  onClearInvoiceDates: () => void;
  onSaveInvoiceDates: () => void;
  onCancelInvoiceDateEditor: () => void;
  onStartAddOrder: (invoiceId: string) => void;
  onNewOrderNoChange: (value: string) => void;
  onNewOrderAmountChange: (value: string) => void;
  onNewOrderCustomerMarkChange: (value: string) => void;
  onNewOrderCustomerSelect: (customerId: string) => void;
  onSubmitAddOrder: () => void;
  onCancelAddOrder: () => void;
  onOpenOrderHistory: (orderId: string, orderNo: string) => void;
  onOpenTransfer: (order: TransferFromOrder) => void;
  onOpenEditOrder: (invoiceId: string, invoiceInvNo: string, order: Order, sourceLinked: boolean) => void;
  onDeleteOrder: (orderId: string) => void;
  onSourceChanged?: () => void | Promise<void>;
};

export function InvoiceList({
  invoices,
  expandedInvoices,
  isManager,
  isAdmin,
  addingOrderToInvoice,
  branchAdminOptions,
  branchAdminLoading,
  assigningInvoiceId,
  invoiceBranchAdminSelections,
  newOrderNo,
  newOrderAmount,
  newOrderCustomerMark,
  newOrderCustomerId,
  newOrderCustomerCandidates,
  addError,
  editingInvoiceDateId,
  editingInvoiceShipDate,
  editingInvoiceReleaseDate,
  invoiceDateSaving,
  submitting,
  tx,
  onToggleInvoice,
  onOpenInvoiceDateEditor,
  onInvoiceBranchAdminSelect,
  onAssignInvoiceBranchAdmin,
  onEditingInvoiceShipDateChange,
  onEditingInvoiceReleaseDateChange,
  onClearInvoiceDates,
  onSaveInvoiceDates,
  onCancelInvoiceDateEditor,
  onStartAddOrder,
  onNewOrderNoChange,
  onNewOrderAmountChange,
  onNewOrderCustomerMarkChange,
  onNewOrderCustomerSelect,
  onSubmitAddOrder,
  onCancelAddOrder,
  onOpenOrderHistory,
  onOpenTransfer,
  onOpenEditOrder,
  onDeleteOrder,
  onSourceChanged,
}: InvoiceListProps) {
  if (invoices.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-gray-500">
          {tx('暂无账单', 'No invoices')}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {invoices.map((invoice) => (
        <Card key={invoice.id}>
          <CardHeader className="cursor-pointer hover:bg-gray-50" onClick={() => onToggleInvoice(invoice.id)}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                {expandedInvoices.has(invoice.id) ? (
                  <ChevronDown className="h-5 w-5 text-gray-500" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-gray-500" />
                )}
                <div>
                  <CardTitle className="flex flex-wrap items-center gap-1 text-lg">
                    <span className="break-all">{invoice.invNo}</span>
                <InvoiceRenameAction invoice={invoice} isAdmin={isAdmin} tx={tx} onChanged={onSourceChanged} />
                    <InvoiceSourceActions invoice={invoice} tx={tx} onChanged={onSourceChanged} />
                  </CardTitle>
                  <CardDescription>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{tx(`${invoice.depositPool ? activePoolRowCount(invoice.depositPool.rows) : invoice.orders.length} 个条目`, `${invoice.depositPool ? activePoolRowCount(invoice.depositPool.rows) : invoice.orders.length} entries`)}</span>
                      {editingInvoiceDateId === invoice.id ? (
                        <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
                          <span>{tx('发货', 'SHIP')}</span>
                          <Input
                            type="date"
                            value={editingInvoiceShipDate}
                            onChange={(event) => onEditingInvoiceShipDateChange(event.target.value)}
                            className="h-8 w-[150px]"
                          />
                          <span>{tx('放货', 'RELEASE')}</span>
                          <Input
                            type="date"
                            value={editingInvoiceReleaseDate}
                            onChange={(event) => onEditingInvoiceReleaseDateChange(event.target.value)}
                            className="h-8 w-[150px]"
                          />
                          <Button size="sm" variant="outline" onClick={onClearInvoiceDates}>
                            {tx('清空', 'Clear')}
                          </Button>
                          <Button size="sm" onClick={onSaveInvoiceDates} disabled={invoiceDateSaving}>
                            {invoiceDateSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                            {tx('保存', 'Save')}
                          </Button>
                          <Button size="sm" variant="outline" onClick={onCancelInvoiceDateEditor} disabled={invoiceDateSaving}>
                            {tx('取消', 'Cancel')}
                          </Button>
                        </div>
                      ) : (
                        <>
                          <span>{`${tx('发货', 'SHIP')}: ${invoice.shipDate ? new Date(invoice.shipDate).toLocaleDateString() : '-'}`}</span>
                          <span>{`${tx('放货', 'RELEASE')}: ${invoice.releaseDate ? new Date(invoice.releaseDate).toLocaleDateString() : '-'}`}</span>
                          {invoice.source && <>
                            <span>{tx('预计到港', 'ETA')}: {invoice.estimatedArrivalDate ? new Date(invoice.estimatedArrivalDate).toLocaleDateString() : '-'}</span>
                            {invoice.source.creditInsurance && <span>{tx('信保', 'Credit insurance')}: {invoice.source.creditInsurance}</span>}
                            {invoice.source.metadataStale && <span role="status">{tx('来源资料暂未更新，显示上次成功内容', 'Source unavailable; showing last successful data')}</span>}
                          </>}
                          {isManager && !invoice.source && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpenInvoiceDateEditor(invoice.id, invoice.shipDate, invoice.releaseDate);
                              }}
                              className="h-7 px-2"
                            >
                              <Pencil className="h-3.5 w-3.5 mr-1" />
                              {tx('编辑日期', 'Edit Dates')}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </CardDescription>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm sm:justify-end">
                <div className="text-right">
                  <div className="text-gray-500">{invoice.depositPool ? tx('预留 / 冻结', 'Reserved / Held') : tx('总金额', 'Total Amount')}</div>
                  <div className="font-semibold">{invoice.depositPool ? `${formatUsdAmount(invoice.depositPool.reservedTotal)} / ${formatUsdAmount(invoice.depositPool.heldTotal)}` : formatUsdAmount(invoice.invAmount)}</div>
                </div>
                <div className="text-right">
                  <div className="text-gray-500">{invoice.depositPool ? tx('可用余额', 'Available') : tx('未收金额', 'Outstanding')}</div>
                  <div className={`font-semibold ${invoice.invBalance > 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {formatUsdAmount(invoice.depositPool?.availableTotal ?? invoice.invBalance)}
                  </div>
                </div>
              </div>
            </div>
          </CardHeader>

          {expandedInvoices.has(invoice.id) && (
            <CardContent className="border-t pt-4">
              {invoice.depositPool ? <DepositPoolTable pool={invoice.depositPool} tx={tx} isAdmin={isAdmin}
                onHistory={onOpenOrderHistory} onTransfer={onOpenTransfer} onChanged={() => { void onSourceChanged?.(); }} /> : <>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h4 className="font-medium">{tx('订单明细', 'Order Details')}</h4>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                  {isAdmin && (
                    branchAdminOptions.length > 0 ? (
                      <>
                        <Select
                          value={invoiceBranchAdminSelections[invoice.id] || undefined}
                          onValueChange={(value) => onInvoiceBranchAdminSelect(invoice.id, value)}
                        >
                          <SelectTrigger className="w-[240px]" data-testid={`invoice-assign-admin-select-${invoice.id}`}>
                            <SelectValue placeholder={tx('分配给分支ADMIN', 'Assign to branch admin')} />
                          </SelectTrigger>
                          <SelectContent>
                            {branchAdminOptions.map((option) => (
                              <SelectItem key={option.id} value={option.id}>
                                {option.name ? `${option.name} (${option.email})` : option.email}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onAssignInvoiceBranchAdmin(invoice.id)}
                          data-testid={`invoice-assign-admin-button-${invoice.id}`}
                          disabled={branchAdminLoading || assigningInvoiceId === invoice.id || !invoiceBranchAdminSelections[invoice.id]}
                        >
                          {assigningInvoiceId === invoice.id && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                          {tx('分配', 'Assign')}
                        </Button>
                      </>
                    ) : (
                      <div className="text-xs text-gray-500">
                        {tx('当前无可分配的分支ADMIN', 'No branch admin available')}
                      </div>
                    )
                  )}
                  {isManager && !invoice.source && (
                    <Button size="sm" variant="outline" onClick={() => onStartAddOrder(invoice.id)}>
                      <Plus className="h-4 w-4 mr-1" />
                      {tx('添加订单', 'Add Order')}
                    </Button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tx('客户单号 (ORDER)', 'Order No. (ORDER)')}</TableHead>
                    <TableHead>MARK</TableHead>
                    <TableHead>{tx('金额 (AMOUNT)', 'Amount (AMOUNT)')}</TableHead>
                    <TableHead>{tx('未收金额', 'Outstanding')}</TableHead>
                    {isManager && <TableHead className="text-right">{tx('操作', 'Actions')}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          className={`underline ${order.needsCustomerFix ? 'text-red-600' : 'text-blue-600'}`}
                          onClick={() => onOpenOrderHistory(order.id, order.orderNo)}
                        >
                          {formatOrderNameDisplay(order.orderNo)}
                        </button>
                        {order.needsCustomerFix && (
                          <div className="text-xs text-red-500">{tx('请修复客户信息', 'Please fix customer information')}</div>
                        )}
                      </TableCell>
                      <TableCell>{order.customerMark || '-'}</TableCell>
                      <TableCell>{formatUsdAmount(order.amount)}</TableCell>
                      <TableCell className={order.orderBalance > 0 ? 'text-red-500' : 'text-green-500'}>
                        {formatUsdAmount(Math.abs(order.orderBalance))}
                        {order.orderBalance < 0 && <span className="ml-1 text-xs">{tx('(多付)', '(Overpaid)')}</span>}
                      </TableCell>
                      {isManager && (
                        <TableCell className="text-right">
                          {order.orderBalance < 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onOpenTransfer({ id: order.id, orderNo: order.orderNo, balance: order.orderBalance })}
                              title={tx('转移多付金额', 'Transfer Overpayment')}
                              className="text-blue-600 hover:text-blue-700"
                            >
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          )}
                          {(!invoice.source || invoice.source.revision) && <Button size="sm" variant="ghost" onClick={() => onOpenEditOrder(invoice.id, invoice.invNo, order, Boolean(invoice.source))}>
                            <Pencil className="h-4 w-4" />
                          </Button>}
                          {!invoice.source && <Button size="sm" variant="ghost" onClick={() => onDeleteOrder(order.id)}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {invoice.orders.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={isManager ? 5 : 4} className="text-center py-4 text-gray-500">
                        {tx('暂无订单', 'No orders')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </div>

              {addingOrderToInvoice === invoice.id && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <h5 className="font-medium mb-3">{tx('添加新订单', 'Add New Order')}</h5>
                  {addError && (
                    <Alert variant="destructive" className="mb-3">
                      <AlertDescription>{addError}</AlertDescription>
                    </Alert>
                  )}
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <Input
                      placeholder={tx('客户单号', 'Order number')}
                      value={newOrderNo}
                      onChange={(e) => onNewOrderNoChange(e.target.value)}
                      className="flex-1"
                    />
                    <MoneyInput
                      placeholder={tx('金额', 'Amount')}
                      value={newOrderAmount}
                      onValueChange={onNewOrderAmountChange}
                      className="w-full sm:w-32"
                    />
                    <Input
                      placeholder={tx('客户MARK(必填)', 'Customer MARK (required)')}
                      value={newOrderCustomerMark}
                      onChange={(e) => onNewOrderCustomerMarkChange(e.target.value)}
                      className="w-full sm:w-44"
                    />
                    {newOrderCustomerCandidates.length > 1 && (
                      <select
                        className="border rounded-md px-2 py-2 text-sm"
                        value={newOrderCustomerId}
                        onChange={(e) => onNewOrderCustomerSelect(e.target.value)}
                      >
                        <option value="">{tx('选择客户', 'Select customer')}</option>
                        {newOrderCustomerCandidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>{candidate.mark}/{formatOrderNameDisplay(candidate.orderName)}</option>
                        ))}
                      </select>
                    )}
                    <Button onClick={onSubmitAddOrder} disabled={submitting}>
                      {submitting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                      {tx('添加', 'Add')}
                    </Button>
                    <Button variant="outline" onClick={onCancelAddOrder}>
                      {tx('取消', 'Cancel')}
                    </Button>
                  </div>
                </div>
              )}
              </>}
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
