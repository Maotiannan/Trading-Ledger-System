'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type {
  CustomerCompanyFileOverwriteProposal,
  CustomerCompanyFileSummary,
  CustomerFormState,
  CustomerOwnerOption,
} from '../types';

type CustomerCompanyFileOverwriteKey = CustomerCompanyFileOverwriteProposal['fields'][number]['key'];

function CustomerCompanyFileOverwritePanel({
  proposal,
  tx,
  onApply,
  onDismiss,
}: {
  proposal: CustomerCompanyFileOverwriteProposal;
  tx: (zh: string, en: string) => string;
  onApply?: (keys: CustomerCompanyFileOverwriteKey[]) => void;
  onDismiss?: () => void;
}) {
  const [selectedOverwriteKeys, setSelectedOverwriteKeys] = useState<CustomerCompanyFileOverwriteKey[]>(
    () => proposal.fields.filter((field) => field.selected).map((field) => field.key),
  );
  const selectedOverwriteKeySet = useMemo(() => new Set(selectedOverwriteKeys), [selectedOverwriteKeys]);

  const toggleOverwriteKey = (key: CustomerCompanyFileOverwriteKey, checked: boolean) => {
    setSelectedOverwriteKeys((prev) => {
      if (checked) return Array.from(new Set([...prev, key]));
      return prev.filter((item) => item !== key);
    });
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <section
        role="dialog"
        aria-labelledby="customer-company-file-overwrite-title"
        className="space-y-4"
      >
        <div className="mb-4 space-y-2">
          <h2 id="customer-company-file-overwrite-title" className="text-lg font-semibold">
            {tx('确认是否覆盖客户信息', 'Confirm customer field overwrite')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {tx('AI识别结果不会自动覆盖已有信息，请逐项确认。', 'AI results will not overwrite existing values automatically. Confirm each field.')}
          </p>
        </div>
        <div className="space-y-3">
          {proposal.fields.map((field) => (
            <label key={field.key} className="flex items-start gap-3 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={selectedOverwriteKeySet.has(field.key)}
                onChange={(event) => toggleOverwriteKey(field.key, event.target.checked)}
              />
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block font-medium">{field.label}</span>
                <span className="grid gap-1 sm:grid-cols-2">
                  <span className="rounded bg-muted px-2 py-1">
                    {tx('原值', 'Current')}: <span className="font-medium">{field.currentValue || '-'}</span>
                  </span>
                  <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-900">
                    {tx('识别值', 'Recognized')}: <span className="font-medium">{field.nextValue || '-'}</span>
                  </span>
                </span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onDismiss?.()}>{tx('不覆盖', 'Do not overwrite')}</Button>
          <Button onClick={() => onApply?.(selectedOverwriteKeys)}>{tx('应用所选覆盖', 'Apply selected overwrites')}</Button>
        </div>
      </section>
    </div>
  );
}

export type CustomerFormDialogProps = {
  open: boolean;
  editing: Record<string, unknown> | null;
  form: CustomerFormState;
  isAdmin: boolean;
  ownerOptions: CustomerOwnerOption[];
  tx: (zh: string, en: string) => string;
  phoneConflict: boolean;
  phoneConflictMessage: string;
  companyFiles?: CustomerCompanyFileSummary[];
  companyFileUploading?: boolean;
  companyFileError?: string;
  companyFileProposal?: CustomerCompanyFileOverwriteProposal | null;
  onOpenChange: (open: boolean) => void;
  onFormChange: (updater: (prev: CustomerFormState) => CustomerFormState) => void;
  onSubmit: () => void;
  onCompanyFileUpload?: (file: File) => void;
  onCompanyFileDelete?: (assetId: string) => void;
  onApplyCompanyFileOcrProposal?: (keys: Array<CustomerCompanyFileOverwriteProposal['fields'][number]['key']>) => void;
  onDismissCompanyFileOcrProposal?: () => void;
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
  companyFiles = [],
  companyFileUploading = false,
  companyFileError = '',
  companyFileProposal = null,
  onOpenChange,
  onFormChange,
  onSubmit,
  onCompanyFileUpload,
  onCompanyFileDelete,
  onApplyCompanyFileOcrProposal,
  onDismissCompanyFileOcrProposal,
}: CustomerFormDialogProps) {
  const proposalKey = useMemo(
    () => companyFileProposal?.fields.map((field) => `${field.key}:${field.currentValue}->${field.nextValue}:${field.selected}`).join('|') || '',
    [companyFileProposal],
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? tx('编辑客户', 'Edit Customer') : tx('创建客户', 'Create Customer')}</DialogTitle>
            <DialogDescription>
              {tx('维护客户基础信息，手机号允许重复但会显示冲突提示。', 'Maintain customer details. Duplicate phone numbers are allowed but highlighted as conflicts.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="MARK*" value={form.mark} onChange={(e) => onFormChange((prev) => ({ ...prev, mark: e.target.value }))} />
            <Input placeholder="ORDER_NAME*" value={form.orderName} onChange={(e) => onFormChange((prev) => ({ ...prev, orderName: e.target.value.toUpperCase() }))} />
            {editing && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{tx('附加 ORDER_NAME', 'Additional ORDER_NAME')}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onFormChange((prev) => ({ ...prev, orderNames: [...prev.orderNames, ''] }))}
                  >
                    {tx('新增', 'Add')}
                  </Button>
                </div>
                <div className="space-y-2">
                  {form.orderNames.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{tx('当前没有附加 ORDER_NAME', 'No additional ORDER_NAME yet.')}</p>
                  ) : form.orderNames.map((value, index) => (
                    <div key={`alias-${index}`} className="flex items-center gap-2">
                      <Input
                        placeholder={tx('附加 ORDER_NAME', 'Additional ORDER_NAME')}
                        value={value}
                        onChange={(e) => onFormChange((prev) => ({
                          ...prev,
                          orderNames: prev.orderNames.map((item, itemIndex) => (itemIndex === index ? e.target.value.toUpperCase() : item)),
                        }))}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onFormChange((prev) => ({
                          ...prev,
                          orderNames: prev.orderNames.filter((_, itemIndex) => itemIndex !== index),
                        }))}
                      >
                        {tx('删除', 'Remove')}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
            {editing && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{tx('公司文件', 'Company Files')}</p>
                    <p className="text-xs text-muted-foreground">
                      {tx('新文件会追加保存，不会覆盖旧文件。', 'New files are appended and never overwrite old files.')}
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="customer-company-file-upload" className="sr-only">
                      {tx('上传公司文件', 'Upload company file')}
                    </Label>
                    <Input
                      id="customer-company-file-upload"
                      aria-label={tx('上传公司文件', 'Upload company file')}
                      type="file"
                      accept="image/*,.pdf,.txt,.doc,.docx,.xls,.xlsx"
                      disabled={companyFileUploading}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) onCompanyFileUpload?.(file);
                        event.target.value = '';
                      }}
                    />
                  </div>
                </div>
                {companyFileError && <p className="text-sm text-red-600">{companyFileError}</p>}
                <div className="space-y-2">
                  {companyFiles.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{tx('当前没有公司文件', 'No company files yet.')}</p>
                  ) : companyFiles.map((file) => (
                    <div key={file.id} className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{Math.max(1, Math.round(file.sizeBytes / 1024))} KB</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={tx('删除文件', 'Delete file')}
                        onClick={() => onCompanyFileDelete?.(file.id)}
                        disabled={companyFileUploading}
                      >
                        {tx('删除', 'Delete')}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {companyFileProposal && (
            <CustomerCompanyFileOverwritePanel
              key={proposalKey}
              proposal={companyFileProposal}
              tx={tx}
              onApply={onApplyCompanyFileOcrProposal}
              onDismiss={onDismissCompanyFileOcrProposal}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>{tx('取消', 'Cancel')}</Button>
            <Button onClick={onSubmit}>{tx('保存', 'Save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
