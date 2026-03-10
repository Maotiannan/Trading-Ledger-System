'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, Upload } from 'lucide-react';
import type { CustomerOwnerOption } from '../types';

export type CustomerToolbarProps = {
  isAdmin: boolean;
  search: string;
  importOwnerId: string;
  ownerOptions: CustomerOwnerOption[];
  customerImporting: boolean;
  tx: (zh: string, en: string) => string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (file: File) => void;
  onSearchChange: (value: string) => void;
  onImportOwnerChange: (value: string) => void;
  onDownloadTemplate: () => void;
  onOpenImport: () => void;
  onOpenCreate: () => void;
};

export function CustomerToolbar({
  isAdmin,
  search,
  importOwnerId,
  ownerOptions,
  customerImporting,
  tx,
  inputRef,
  onFileChange,
  onSearchChange,
  onImportOwnerChange,
  onDownloadTemplate,
  onOpenImport,
  onOpenCreate,
}: CustomerToolbarProps) {
  return (
    <div className="flex justify-between items-center">
      <h2 className="text-2xl font-bold">{tx('客户管理', 'Customer Management')}</h2>
      <div className="flex gap-2">
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
        <Input
          placeholder={tx('搜索 mark/order_name/name/phone/city', 'Search mark/order_name/name/phone/city')}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-72"
        />
        {isAdmin && (
          <select
            className="h-10 border rounded-md px-3 text-sm bg-white"
            value={importOwnerId}
            onChange={(e) => onImportOwnerChange(e.target.value)}
            title={tx('批量导入默认绑定Sales', 'Default sales binding for import')}
          >
            {ownerOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {`${option.email} (${option.role})`}
              </option>
            ))}
          </select>
        )}
        <Button variant="outline" onClick={onDownloadTemplate}>
          {tx('下载客户模板', 'Download Customer Template')}
        </Button>
        <Button variant="outline" disabled={customerImporting} onClick={onOpenImport}>
          {customerImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
          {tx('批量上传客户', 'Bulk Import Customers')}
        </Button>
        <Button onClick={onOpenCreate}>
          <Plus className="h-4 w-4 mr-2" />
          {tx('新建客户', 'New Customer')}
        </Button>
      </div>
    </div>
  );
}
