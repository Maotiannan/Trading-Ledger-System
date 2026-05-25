'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react';

export type CustomerConsigneeItem = {
  id: string;
  consignee: string;
  isPrimary: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type CustomerConsigneeDialogProps = {
  open: boolean;
  customerLabel: string;
  consignees: CustomerConsigneeItem[];
  inputValue: string;
  loading: boolean;
  submitting: boolean;
  error: string;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onInputChange: (value: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onSetPrimary: (id: string) => void;
};

export function CustomerConsigneeDialog({
  open,
  customerLabel,
  consignees,
  inputValue,
  loading,
  submitting,
  error,
  tx,
  onOpenChange,
  onInputChange,
  onAdd,
  onDelete,
  onSetPrimary,
}: CustomerConsigneeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-2xl flex-col p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{tx('CONSIGNEE 管理', 'CONSIGNEE Management')}</DialogTitle>
          <DialogDescription>
            {customerLabel || tx('为该客户维护多个 CONSIGNEE。', 'Manage multiple CONSIGNEE values for this customer.')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="customer-consignee-input">CONSIGNEE</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="customer-consignee-input"
                value={inputValue}
                placeholder={tx('输入新的 CONSIGNEE', 'Enter a new CONSIGNEE')}
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onAdd();
                  }
                }}
              />
              <Button type="button" onClick={onAdd} disabled={submitting || !inputValue.trim()}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                {tx('新增', 'Add')}
              </Button>
            </div>
          </div>

          <div className="rounded-md border">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {tx('加载中...', 'Loading...')}
              </div>
            ) : consignees.length > 0 ? (
              <div className="divide-y">
                {consignees.map((item) => (
                  <div key={item.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="whitespace-normal break-words text-sm font-medium">{item.consignee}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
                      {item.isPrimary ? (
                        <div className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          {tx('当前默认', 'Primary')}
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onSetPrimary(item.id)}
                          disabled={submitting || item.id.startsWith('legacy-')}
                        >
                          {tx('设为默认', 'Set default')}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-red-600 hover:text-red-700"
                        aria-label={tx('删除 CONSIGNEE', 'Delete CONSIGNEE')}
                        title={tx('删除 CONSIGNEE', 'Delete CONSIGNEE')}
                        onClick={() => onDelete(item.id)}
                        disabled={submitting || item.id.startsWith('legacy-')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {tx('暂无 CONSIGNEE，请新增。', 'No CONSIGNEE yet. Add one above.')}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tx('关闭', 'Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
