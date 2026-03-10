'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import type { BranchPurgeTarget, PurgeFormState } from '../types';

export type BranchPurgeCardProps = {
  canPurgeBranch: boolean;
  branchPurgeTargets: BranchPurgeTarget[];
  purgeModuleKeys: string[];
  purgingBranch: boolean;
  purgeForm: PurgeFormState;
  tx: (zh: string, en: string) => string;
  onPurgeFormChange: (updater: (prev: PurgeFormState) => PurgeFormState) => void;
  onTogglePurgeModule: (moduleKey: string, checked: boolean) => void;
  onSubmit: () => void;
};

export function BranchPurgeCard({
  canPurgeBranch,
  branchPurgeTargets,
  purgeModuleKeys,
  purgingBranch,
  purgeForm,
  tx,
  onPurgeFormChange,
  onTogglePurgeModule,
  onSubmit,
}: BranchPurgeCardProps) {
  if (!canPurgeBranch) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx('分支业务清库', 'Branch Data Purge')}</CardTitle>
        <CardDescription>
          {tx('输入当前管理员密码后，可按模块清理任意账号分支的业务数据（保留系统配置与用户配置）。', 'Enter current admin password to purge selected business modules under any account branch (system/user settings are preserved).')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label>{tx('目标账号', 'Target Account')}</Label>
          <select
            className="w-full border rounded-md px-3 py-2 text-sm"
            value={purgeForm.targetUserId}
            onChange={(e) => onPurgeFormChange((prev) => ({ ...prev, targetUserId: e.target.value }))}
          >
            {branchPurgeTargets.map((target) => (
              <option key={target.id} value={target.id}>
                {`${target.email} (${target.role}, L${target.level})`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>{tx('清理模块', 'Purge Modules')}</Label>
          <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2">
            {(purgeModuleKeys.length > 0 ? purgeModuleKeys : ['all', 'invoice', 'receipt', 'detail', 'swift', 'customer']).map((moduleKey) => {
              const checked = purgeForm.modules.includes(moduleKey);
              const labelMap: Record<string, string> = {
                all: tx('全部', 'All'),
                invoice: tx('账单', 'Invoice'),
                receipt: tx('收据', 'Receipt'),
                detail: tx('明细', 'Detail'),
                swift: 'SWIFT',
                customer: tx('客户', 'Customer'),
              };
              return (
                <label key={moduleKey} className="flex items-center gap-2 border rounded-md px-2 py-2 text-sm">
                  <input type="checkbox" checked={checked} onChange={(e) => onTogglePurgeModule(moduleKey, e.target.checked)} />
                  <span>{labelMap[moduleKey] || moduleKey}</span>
                </label>
              );
            })}
          </div>
        </div>
        <div>
          <Label>{tx('确认密码', 'Confirm Password')}</Label>
          <Input
            type="password"
            value={purgeForm.password}
            onChange={(e) => onPurgeFormChange((prev) => ({ ...prev, password: e.target.value }))}
            placeholder={tx('输入当前管理员密码', 'Enter current admin password')}
          />
        </div>
        <div className="flex justify-end">
          <Button
            variant="destructive"
            onClick={onSubmit}
            disabled={purgingBranch || !purgeForm.targetUserId || !purgeForm.password || purgeForm.modules.length === 0}
          >
            {purgingBranch && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {tx('执行分支清库', 'Run Branch Purge')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
