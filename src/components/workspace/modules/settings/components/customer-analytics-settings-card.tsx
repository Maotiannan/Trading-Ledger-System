'use client';

import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const analyticsFields = [
  {
    key: 'CUSTOMER_ANALYTICS_LOOKBACK_MONTHS',
    zh: '回看月份',
    en: 'Lookback months',
    fallback: '12',
    min: 1,
    max: 60,
  },
  {
    key: 'CUSTOMER_ANALYTICS_NORMAL_DAYS',
    zh: '正常期限（天）',
    en: 'Normal term (days)',
    fallback: '30',
    min: 1,
    max: 3650,
  },
  {
    key: 'CUSTOMER_ANALYTICS_MILD_DELAY_DAYS',
    zh: '轻微拖延（天）',
    en: 'Mild delay (days)',
    fallback: '60',
    min: 1,
    max: 3650,
  },
  {
    key: 'CUSTOMER_ANALYTICS_DELAY_DAYS',
    zh: '拖延（天）',
    en: 'Delay (days)',
    fallback: '90',
    min: 1,
    max: 3650,
  },
  {
    key: 'CUSTOMER_ANALYTICS_WARNING_DAYS',
    zh: '警告（天）',
    en: 'Warning (days)',
    fallback: '120',
    min: 1,
    max: 3650,
  },
  {
    key: 'CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS',
    zh: '加倍警告（天）',
    en: 'Double warning (days)',
    fallback: '150',
    min: 1,
    max: 3650,
  },
  {
    key: 'CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS',
    zh: '严重警告（天）',
    en: 'Severe warning (days)',
    fallback: '180',
    min: 1,
    max: 3650,
  },
] as const;

export type CustomerAnalyticsSettingsCardProps = {
  loading: boolean;
  saving: boolean;
  canEdit: boolean;
  config: Record<string, string>;
  tx: (zh: string, en: string) => string;
  onFieldChange: (key: string, value: string) => void;
  onSave: () => void;
};

export function CustomerAnalyticsSettingsCard({
  loading,
  saving,
  canEdit,
  config,
  tx,
  onFieldChange,
  onSave,
}: CustomerAnalyticsSettingsCardProps) {
  return (
    <Card data-testid="customer-analytics-settings-card">
      <CardHeader>
        <CardTitle>{tx('客户分析规则', 'Customer Analytics Rules')}</CardTitle>
        <CardDescription>
          {tx(
            '设置付款能力回看范围和付款周期风险分界。所有账号使用同一套规则。',
            'Set the payment-capacity lookback and payment-cycle risk boundaries used by every account.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {analyticsFields.map((field) => {
                const id = `customer-analytics-${field.key.toLowerCase().replaceAll('_', '-')}`;
                return (
                  <div key={field.key} className="space-y-1.5">
                    <Label htmlFor={id}>{tx(field.zh, field.en)}</Label>
                    <Input
                      id={id}
                      type="number"
                      inputMode="numeric"
                      min={field.min}
                      max={field.max}
                      step={1}
                      value={config[field.key] ?? field.fallback}
                      disabled={!canEdit}
                      onChange={(event) => onFieldChange(field.key, event.target.value)}
                    />
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {tx(
                '天数必须使用整数，并按正常、轻微拖延、拖延、警告、加倍警告、严重警告严格递增。',
                'Use whole days in strictly increasing order: normal, mild delay, delay, warning, double warning, severe warning.',
              )}
            </p>
            <div className="flex justify-end">
              <Button onClick={onSave} disabled={!canEdit || saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {tx('保存客户分析设置', 'Save Customer Analytics Settings')}
              </Button>
            </div>
            {!canEdit ? (
              <p className="text-sm text-muted-foreground">
                {tx(
                  '仅管理员可编辑全局客户分析规则。',
                  'Only admins can edit global customer analytics rules.',
                )}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
