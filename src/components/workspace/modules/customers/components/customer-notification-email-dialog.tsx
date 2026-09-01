'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { CustomerNotificationEmailItem, CustomerNotificationLanguage } from '../types';

export type CustomerNotificationEmailDialogProps = {
  open: boolean;
  customerLabel: string;
  emails: CustomerNotificationEmailItem[];
  language: CustomerNotificationLanguage;
  inputValue: string;
  editingEmailId: string | null;
  loading: boolean;
  submitting: boolean;
  error: string;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onStartEdit: (email: CustomerNotificationEmailItem) => void;
  onCancelEdit: () => void;
  onDelete: (id: string) => void;
  onSetPrimary: (id: string) => void;
  onLanguageChange: (language: CustomerNotificationLanguage) => void;
};

export function CustomerNotificationEmailDialog({
  open,
  customerLabel,
  emails,
  language,
  inputValue,
  editingEmailId,
  loading,
  submitting,
  error,
  tx,
  onOpenChange,
  onInputChange,
  onSubmit,
  onStartEdit,
  onCancelEdit,
  onDelete,
  onSetPrimary,
  onLanguageChange,
}: CustomerNotificationEmailDialogProps) {
  const editing = Boolean(editingEmailId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] w-[calc(100vw-24px)] max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6">
          <DialogTitle>{tx('客户通知邮箱', 'Customer Notification Emails')}</DialogTitle>
          <DialogDescription>
            {customerLabel || tx('维护客户通知邮箱和语言偏好。', 'Manage notification emails and language preference.')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4 sm:px-6">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="customer-notification-language">{tx('语言偏好', 'Language Preference')}</Label>
            <select
              id="customer-notification-language"
              aria-label={tx('语言偏好', 'Language Preference')}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={language}
              disabled={loading || submitting}
              onChange={(event) => onLanguageChange(event.target.value as CustomerNotificationLanguage)}
            >
              <option value="ENGLISH">English</option>
              <option value="FRENCH">Francais</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="customer-notification-email">
              {editing ? tx('修改邮箱', 'Edit Email') : tx('新增邮箱', 'Add Email')}
            </Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="customer-notification-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={320}
                value={inputValue}
                disabled={loading || submitting}
                placeholder={tx('输入客户邮箱', 'Enter customer email')}
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onSubmit();
                  }
                }}
              />
              <div className="flex shrink-0 gap-2">
                <Button type="button" onClick={onSubmit} disabled={loading || submitting || !inputValue.trim()}>
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : editing ? <Pencil className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
                  {editing ? tx('保存', 'Save') : tx('新增', 'Add')}
                </Button>
                {editing ? (
                  <Button type="button" variant="outline" onClick={onCancelEdit} disabled={submitting}>
                    <X className="mr-2 h-4 w-4" />
                    {tx('取消', 'Cancel')}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="rounded-md border">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {tx('加载中...', 'Loading...')}
              </div>
            ) : emails.length > 0 ? (
              <div className="max-h-[40dvh] divide-y overflow-y-auto">
                {emails.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 p-3">
                    <input
                      type="radio"
                      name="customer-primary-notification-email"
                      aria-label={item.email}
                      checked={item.isPrimary}
                      disabled={submitting}
                      onChange={() => onSetPrimary(item.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="break-all text-sm font-medium">{item.email}</div>
                      {item.isPrimary ? (
                        <div className="mt-1 text-xs text-emerald-700">{tx('主邮箱', 'Primary')}</div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        aria-label={`${tx('编辑', 'Edit')} ${item.email}`}
                        title={`${tx('编辑', 'Edit')} ${item.email}`}
                        disabled={submitting}
                        onClick={() => onStartEdit(item)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-red-600 hover:text-red-700"
                        aria-label={`${tx('删除', 'Delete')} ${item.email}`}
                        title={`${tx('删除', 'Delete')} ${item.email}`}
                        disabled={submitting}
                        onClick={() => onDelete(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {tx('暂无通知邮箱，请在上方新增。', 'No notification email yet. Add one above.')}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="sticky bottom-0 shrink-0 border-t bg-background px-4 py-3 sm:px-6">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {tx('关闭', 'Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
