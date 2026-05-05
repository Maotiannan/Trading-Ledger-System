'use client';

import { Button } from '@/components/ui/button';
import { Loader2, Plus, RefreshCw, Upload } from 'lucide-react';

export type InvoiceToolbarProps = {
  isManager: boolean;
  invoiceImporting: boolean;
  rematchLoading: boolean;
  tx: (zh: string, en: string) => string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (file: File) => void;
  onDownloadTemplate: () => void;
  onOpenImport: () => void;
  onOpenRematch: () => void;
  onOpenCreate: () => void;
};

export function InvoiceToolbar({
  isManager,
  invoiceImporting,
  rematchLoading,
  tx,
  inputRef,
  onFileChange,
  onDownloadTemplate,
  onOpenImport,
  onOpenRematch,
  onOpenCreate,
}: InvoiceToolbarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 className="text-2xl font-bold">{tx('账单管理', 'Invoice Management')}</h2>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        {isManager && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFileChange(file);
              }}
            />
            <Button variant="outline" onClick={onDownloadTemplate}>
              {tx('下载账单模板', 'Download Invoice Template')}
            </Button>
            <Button variant="outline" disabled={invoiceImporting} onClick={onOpenImport}>
              {invoiceImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              {tx('批量上传账单', 'Bulk Import Invoices')}
            </Button>
            <Button variant="outline" onClick={onOpenRematch} disabled={rematchLoading}>
              {rematchLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              {tx('刷新匹配', 'Rematch')}
            </Button>
            <Button onClick={onOpenCreate}>
              <Plus className="h-4 w-4 mr-2" />
              {tx('直接创建账单', 'Create Invoice')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
