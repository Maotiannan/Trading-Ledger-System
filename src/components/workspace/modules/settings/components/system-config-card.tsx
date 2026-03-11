'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Save } from 'lucide-react';

export type SystemConfigCardProps = {
  loading: boolean;
  savingConfig: boolean;
  testingConfig: boolean;
  canEditConfig: boolean;
  config: Record<string, string>;
  tx: (zh: string, en: string) => string;
  onConfigFieldChange: (key: string, value: string) => void;
  onTestOcrConfig: () => void;
  onSaveConfig: () => void;
};

export function SystemConfigCard({
  loading,
  savingConfig,
  testingConfig,
  canEditConfig,
  config,
  tx,
  onConfigFieldChange,
  onTestOcrConfig,
  onSaveConfig,
}: SystemConfigCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx('系统配置', 'System Configuration')}</CardTitle>
        <CardDescription>{tx('配置通过设置按钮修改，保存后立即生效（管理员权限）', 'Configuration changes are applied immediately (admin only).')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="py-8 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>OCR_API_BASE_URL</Label>
                <Input value={config.OCR_API_BASE_URL || ''} onChange={(e) => onConfigFieldChange('OCR_API_BASE_URL', e.target.value)} disabled={!canEditConfig} />
              </div>
              <div>
                <Label>OCR_MODEL</Label>
                <Input value={config.OCR_MODEL || ''} onChange={(e) => onConfigFieldChange('OCR_MODEL', e.target.value)} disabled={!canEditConfig} />
              </div>
              <div>
                <Label>OCR_API_KEY</Label>
                <Input type="password" value={config.OCR_API_KEY || ''} onChange={(e) => onConfigFieldChange('OCR_API_KEY', e.target.value)} disabled={!canEditConfig} />
              </div>
              <div>
                <Label>OCR_DISABLED</Label>
                <select className="w-full border rounded-md px-3 py-2 text-sm" value={config.OCR_DISABLED || 'false'} onChange={(e) => onConfigFieldChange('OCR_DISABLED', e.target.value)} disabled={!canEditConfig}>
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              </div>
              <div>
                <Label>OCR_MAX_RETRIES</Label>
                <Input value={config.OCR_MAX_RETRIES || ''} onChange={(e) => onConfigFieldChange('OCR_MAX_RETRIES', e.target.value)} disabled={!canEditConfig} />
              </div>
              <div>
                <Label>OCR_TIMEOUT_MS</Label>
                <Input value={config.OCR_TIMEOUT_MS || ''} onChange={(e) => onConfigFieldChange('OCR_TIMEOUT_MS', e.target.value)} disabled={!canEditConfig} />
              </div>
              <div>
                <Label>OCR_RETRY_BASE_DELAY_MS</Label>
                <Input value={config.OCR_RETRY_BASE_DELAY_MS || ''} onChange={(e) => onConfigFieldChange('OCR_RETRY_BASE_DELAY_MS', e.target.value)} disabled={!canEditConfig} />
              </div>
              <div>
                <Label>OCR_INPUT_COST_PER_1K</Label>
                <Input value={config.OCR_INPUT_COST_PER_1K || ''} onChange={(e) => onConfigFieldChange('OCR_INPUT_COST_PER_1K', e.target.value)} disabled={!canEditConfig} />
              </div>
              <div>
                <Label>OCR_OUTPUT_COST_PER_1K</Label>
                <Input value={config.OCR_OUTPUT_COST_PER_1K || ''} onChange={(e) => onConfigFieldChange('OCR_OUTPUT_COST_PER_1K', e.target.value)} disabled={!canEditConfig} />
              </div>
              <div>
                <Label>SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS</Label>
                <select className="w-full border rounded-md px-3 py-2 text-sm" value={config.SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS || 'false'} onChange={(e) => onConfigFieldChange('SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS', e.target.value)} disabled={!canEditConfig}>
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              </div>
              <div>
                <Label>DETAIL_RECEIPT_MATCH_TOLERANCE</Label>
                <Input value={config.DETAIL_RECEIPT_MATCH_TOLERANCE || '5'} onChange={(e) => onConfigFieldChange('DETAIL_RECEIPT_MATCH_TOLERANCE', e.target.value)} disabled={!canEditConfig} />
              </div>
              <div>
                <Label>SWIFT_WARNING_TOLERANCE</Label>
                <Input value={config.SWIFT_WARNING_TOLERANCE || '5'} onChange={(e) => onConfigFieldChange('SWIFT_WARNING_TOLERANCE', e.target.value)} disabled={!canEditConfig} />
              </div>
              <div>
                <Label>SWIFT_REJECT_TOLERANCE</Label>
                <Input value={config.SWIFT_REJECT_TOLERANCE || '50'} onChange={(e) => onConfigFieldChange('SWIFT_REJECT_TOLERANCE', e.target.value)} disabled={!canEditConfig} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onTestOcrConfig} disabled={!canEditConfig || testingConfig}>
                {testingConfig && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {tx('测试OCR连通', 'Test OCR Connection')}
              </Button>
              <Button onClick={onSaveConfig} disabled={!canEditConfig || savingConfig}>
                {savingConfig && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Save className="h-4 w-4 mr-2" />
                {tx('保存系统配置', 'Save Configuration')}
              </Button>
            </div>
            {!canEditConfig && <p className="text-sm text-gray-500">{tx('仅管理员可编辑系统配置。', 'Only admins can edit system configuration.')}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
