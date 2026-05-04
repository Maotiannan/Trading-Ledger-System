'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, Save } from 'lucide-react';
import type {
  UserImageCompressionPreferenceDraft,
  UserImageCompressionPreferenceField,
  UserImageCompressionPreferenceFieldValue,
} from '../types';

export type UserImageCompressionCardProps = {
  loading: boolean;
  saving: boolean;
  preferences: UserImageCompressionPreferenceDraft;
  tx: (zh: string, en: string) => string;
  onPreferenceFieldChange: <K extends UserImageCompressionPreferenceField>(
    key: K,
    value: UserImageCompressionPreferenceFieldValue<K>,
  ) => void;
  onSavePreferences: () => void;
};

export function UserImageCompressionCard({
  loading,
  saving,
  preferences,
  tx,
  onPreferenceFieldChange,
  onSavePreferences,
}: UserImageCompressionCardProps) {
  const disabled = loading || saving;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx('图片压缩偏好', 'Image Compression Preferences')}</CardTitle>
        <CardDescription>
          {tx('仅影响当前账号上传图片时的压缩策略，不影响管理员系统配置。', 'These settings apply only to the current user and do not change admin system configuration.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <Label htmlFor="user-image-compression-enabled">{tx('启用图片压缩', 'Enable image compression')}</Label>
            <p className="text-sm text-muted-foreground">
              {tx('上传前按个人偏好压缩图片，减少 OCR 前置体积。', 'Compress images before upload based on your personal preference to reduce OCR payload size.')}
            </p>
          </div>
          <Switch
            id="user-image-compression-enabled"
            checked={preferences.imageCompressionEnabled}
            disabled={disabled}
            onCheckedChange={(checked) => onPreferenceFieldChange('imageCompressionEnabled', checked)}
            aria-label={tx('启用图片压缩', 'Enable image compression')}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="user-image-compression-quality-floor">{tx('压缩质量下限', 'Compression quality floor')}</Label>
            <Input
              id="user-image-compression-quality-floor"
              type="text"
              inputMode="decimal"
              value={preferences.imageCompressionQualityFloor}
              disabled={disabled}
              onChange={(event) => onPreferenceFieldChange('imageCompressionQualityFloor', event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-ocr-target-max-kb">{tx('OCR 目标大小（KB）', 'OCR target max size (KB)')}</Label>
            <Input
              id="user-ocr-target-max-kb"
              type="text"
              inputMode="numeric"
              value={preferences.ocrTargetMaxKb}
              disabled={disabled}
              onChange={(event) => onPreferenceFieldChange('ocrTargetMaxKb', event.target.value)}
            />
          </div>
        </div>

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
