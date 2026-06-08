'use client';

import { ArrowDown, ArrowUp, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  DASHBOARD_CARD_REGISTRY,
  DASHBOARD_SECTION_REGISTRY,
  moveDashboardCard,
  moveDashboardSection,
  normalizeDashboardLayoutPreference,
  type DashboardCardId,
  type DashboardLayoutPreference,
  type DashboardSectionId,
} from '@/lib/dashboard-layout-preference';

export type DashboardSettingsCardProps = {
  loading: boolean;
  saving: boolean;
  layout: DashboardLayoutPreference;
  tx: (zh: string, en: string) => string;
  onLayoutChange: (layout: DashboardLayoutPreference) => void;
  onSavePreferences: () => void;
};

function labelForSection(id: DashboardSectionId, tx: DashboardSettingsCardProps['tx']): string {
  const section = DASHBOARD_SECTION_REGISTRY.find((item) => item.id === id);
  return section ? tx(section.zh, section.en) : id;
}

function labelForCard(id: DashboardCardId, tx: DashboardSettingsCardProps['tx']): string {
  const card = DASHBOARD_CARD_REGISTRY.find((item) => item.id === id);
  return card ? tx(card.zh, card.en) : id;
}

export function DashboardSettingsCard({
  loading,
  saving,
  layout,
  tx,
  onLayoutChange,
  onSavePreferences,
}: DashboardSettingsCardProps) {
  const disabled = loading || saving;
  const normalizedLayout = normalizeDashboardLayoutPreference(layout);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx('Dashboard 设置', 'Dashboard Settings')}</CardTitle>
        <CardDescription>
          {tx('调整当前账号 Dashboard 卡片的显示、隐藏和顺序。', 'Control Dashboard card visibility and order for your account only.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {normalizedLayout.sections.map((section, sectionIndex) => {
          const sectionLabel = labelForSection(section.id, tx);
          return (
            <div key={section.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
                <h3 className="font-semibold">{sectionLabel}</h3>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled || sectionIndex === 0}
                    aria-label={`Move ${sectionLabel} up`}
                    onClick={() => onLayoutChange(moveDashboardSection(normalizedLayout, section.id, 'up'))}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled || sectionIndex === normalizedLayout.sections.length - 1}
                    aria-label={`Move ${sectionLabel} down`}
                    onClick={() => onLayoutChange(moveDashboardSection(normalizedLayout, section.id, 'down'))}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {section.cards.map((card, cardIndex) => {
                  const cardLabel = labelForCard(card.id, tx);
                  return (
                    <div key={card.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/30 p-3">
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={card.visible}
                          disabled={disabled}
                          aria-label={cardLabel}
                          onCheckedChange={(checked) => onLayoutChange({
                            sections: normalizedLayout.sections.map((row) => row.id === section.id ? {
                              ...row,
                              cards: row.cards.map((item) => item.id === card.id ? { ...item, visible: checked } : item),
                            } : row),
                          })}
                        />
                        <Label>{cardLabel}</Label>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={disabled || cardIndex === 0}
                          aria-label={`Move ${cardLabel} up`}
                          onClick={() => onLayoutChange(moveDashboardCard(normalizedLayout, section.id, card.id, 'up'))}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={disabled || cardIndex === section.cards.length - 1}
                          aria-label={`Move ${cardLabel} down`}
                          onClick={() => onLayoutChange(moveDashboardCard(normalizedLayout, section.id, card.id, 'down'))}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="flex justify-end">
          <Button onClick={onSavePreferences} disabled={disabled}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4" />
            {tx('保存个人偏好', 'Save Personal Preferences')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
