'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { CustomerFormState, CustomerOwnerOption } from '../types';

export type CustomerFormDialogProps = {
  open: boolean;
  editing: Record<string, unknown> | null;
  form: CustomerFormState;
  isAdmin: boolean;
  ownerOptions: CustomerOwnerOption[];
  tx: (zh: string, en: string) => string;
  phoneConflict: boolean;
  phoneConflictMessage: string;
  onOpenChange: (open: boolean) => void;
  onFormChange: (updater: (prev: CustomerFormState) => CustomerFormState) => void;
  onSubmit: () => void;
};

export function CustomerFormDialog({
  open,
  editing,
  form,
  isAdmin,
  ownerOptions,
  tx,
  phoneConflict,
  phoneConflictMessage,
  onOpenChange,
  onFormChange,
  onSubmit,
}: CustomerFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? tx('编辑客户', 'Edit Customer') : tx('创建客户', 'Create Customer')}</DialogTitle>
          <DialogDescription>
            {tx('维护客户基础信息，手机号允许重复但会显示冲突提示。', 'Maintain customer details. Duplicate phone numbers are allowed but highlighted as conflicts.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="MARK*" value={form.mark} onChange={(e) => onFormChange((prev) => ({ ...prev, mark: e.target.value }))} />
          <Input placeholder="ORDER_NAME*" value={form.orderName} onChange={(e) => onFormChange((prev) => ({ ...prev, orderName: e.target.value }))} />
          <Input placeholder="NAME*" value={form.name} onChange={(e) => onFormChange((prev) => ({ ...prev, name: e.target.value }))} />
          <div className="space-y-1">
            <Input
              placeholder="PHONE*"
              value={form.phone}
              title={phoneConflict ? phoneConflictMessage : undefined}
              className={cn(phoneConflict && 'border-red-500 text-red-600 focus-visible:ring-red-200')}
              onChange={(e) => onFormChange((prev) => ({ ...prev, phone: e.target.value }))}
            />
            {phoneConflict && (
              <p className="text-sm text-red-600">{phoneConflictMessage}</p>
            )}
          </div>
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
          <Button onClick={onSubmit}>{tx('保存', 'Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
