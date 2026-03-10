'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

export type InvoiceSearchCardProps = {
  search: string;
  tx: (zh: string, en: string) => string;
  onSearchChange: (value: string) => void;
  onReset: () => void;
};

export function InvoiceSearchCard({ search, tx, onSearchChange, onReset }: InvoiceSearchCardProps) {
  return (
    <Card>
      <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input
          placeholder={tx('搜索 INV NO / ORDER', 'Search INV NO / ORDER')}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <div />
        <div className="flex justify-end">
          <Button variant="outline" onClick={onReset}>
            {tx('重置筛选', 'Reset Filters')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
