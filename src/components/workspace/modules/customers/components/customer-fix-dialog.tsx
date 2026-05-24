'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { submitSearchOnEnter } from '@/components/workspace/shared/search-key';
import type { CustomerFormState, CustomerOwnerOption } from '../types';

export type CustomerFixDialogProps = {
  fixingTarget: { type: 'order' | 'receipt'; id: string } | null;
  form: CustomerFormState;
  isAdmin: boolean;
  ownerOptions: CustomerOwnerOption[];
  existingCustomerSearch: string;
  existingCustomerOptions: Array<Record<string, unknown>>;
  existingCustomerId: string;
  existingCustomerSearching: boolean;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onFormChange: (updater: (prev: CustomerFormState) => CustomerFormState) => void;
  onExistingCustomerSearchChange: (value: string) => void;
  onExistingCustomerSearchSubmit?: (value: string) => void;
  onExistingCustomerSelect: (row: Record<string, unknown>) => void;
  onSubmit: () => void;
};

export function CustomerFixDialog({
  fixingTarget,
  form,
  isAdmin,
  ownerOptions,
  existingCustomerSearch,
  existingCustomerOptions,
  existingCustomerId,
  existingCustomerSearching,
  tx,
  onOpenChange,
  onFormChange,
  onExistingCustomerSearchChange,
  onExistingCustomerSearchSubmit,
  onExistingCustomerSelect,
  onSubmit,
}: CustomerFixDialogProps) {
  return (
    <Dialog open={!!fixingTarget} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tx('修复客户信息并加入客户库', 'Fix Customer Info And Save')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-2 text-sm font-medium">{tx('搜索已有客户并关联', 'Search Existing Customer To Link')}</div>
            <Input
              placeholder={tx('搜索 MARK/ORDER_NAME/NAME/PHONE', 'Search MARK/ORDER_NAME/NAME/PHONE')}
              value={existingCustomerSearch}
              onChange={(e) => onExistingCustomerSearchChange(e.target.value)}
              onKeyDown={(event) => submitSearchOnEnter(event, (value) => onExistingCustomerSearchSubmit?.(value))}
            />
            <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">
              {existingCustomerSearching && (
                <div className="text-xs text-muted-foreground">{tx('正在搜索...', 'Searching...')}</div>
              )}
              {!existingCustomerSearching && existingCustomerOptions.map((row) => {
                const id = String(row.id || '');
                const selected = id && id === existingCustomerId;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm ${selected ? 'border-blue-500 bg-blue-50' : 'bg-white hover:bg-muted'}`}
                    onClick={() => onExistingCustomerSelect(row)}
                  >
                    <div className="font-medium">{`${String(row.mark || '-')} / ${String(row.orderName || '-')}`}</div>
                    <div className="text-xs text-muted-foreground">{`${String(row.companyName || row.name || '-')} · ${String(row.phone || '-')}`}</div>
                  </button>
                );
              })}
            </div>
          </div>
          <Input placeholder="MARK*" value={form.mark} onChange={(e) => onFormChange((prev) => ({ ...prev, mark: e.target.value }))} />
          <Input placeholder="ORDER_NAME*" value={form.orderName} onChange={(e) => onFormChange((prev) => ({ ...prev, orderName: e.target.value.toUpperCase() }))} />
          <Input placeholder="NAME*" value={form.name} onChange={(e) => onFormChange((prev) => ({ ...prev, name: e.target.value }))} />
          <Input placeholder="PHONE*" value={form.phone} onChange={(e) => onFormChange((prev) => ({ ...prev, phone: e.target.value }))} />
          <Input placeholder="CITY*" value={form.city} onChange={(e) => onFormChange((prev) => ({ ...prev, city: e.target.value }))} />
          <Input placeholder={tx('CONSIGNEE(可空)', 'CONSIGNEE (optional)')} value={form.consignee} onChange={(e) => onFormChange((prev) => ({ ...prev, consignee: e.target.value }))} />
          {isAdmin && (
            <select
              className="h-10 border rounded-md px-3 text-sm bg-white"
              value={form.ownerId}
              onChange={(e) => onFormChange((prev) => ({ ...prev, ownerId: e.target.value }))}
            >
              {ownerOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {`${option.email} (${option.role})`}
                </option>
              ))}
            </select>
          )}
          {isAdmin && (
            <>
              <Input placeholder="COMPANY_NAME" value={form.companyName} onChange={(e) => onFormChange((prev) => ({ ...prev, companyName: e.target.value }))} />
              <Input placeholder="CREDIT" type="number" min="0" step="0.01" value={form.credit} onChange={(e) => onFormChange((prev) => ({ ...prev, credit: e.target.value }))} />
              <Input placeholder="COMPANY_ADDRESS" value={form.companyAddress} onChange={(e) => onFormChange((prev) => ({ ...prev, companyAddress: e.target.value }))} />
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tx('取消', 'Cancel')}</Button>
          <Button onClick={onSubmit}>
            {existingCustomerId ? tx('关联已有客户', 'Link Existing Customer') : tx('修复并保存', 'Fix And Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
