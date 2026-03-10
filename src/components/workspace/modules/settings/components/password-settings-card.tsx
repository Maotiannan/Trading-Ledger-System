'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Key, Loader2 } from 'lucide-react';
import type { PasswordFormState } from '../types';

export type PasswordSettingsCardProps = {
  userEmail?: string | null;
  passwordLoading: boolean;
  pwd: PasswordFormState;
  tx: (zh: string, en: string) => string;
  onPwdChange: (updater: (prev: PasswordFormState) => PasswordFormState) => void;
  onSubmit: () => void;
};

export function PasswordSettingsCard({ userEmail, passwordLoading, pwd, tx, onPwdChange, onSubmit }: PasswordSettingsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx('修改密码', 'Change Password')}</CardTitle>
        <CardDescription>{tx('当前账号：', 'Current Account: ')}{userEmail}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          type="password"
          placeholder={tx('旧密码', 'Current password')}
          value={pwd.oldPassword}
          onChange={(e) => onPwdChange((prev) => ({ ...prev, oldPassword: e.target.value }))}
        />
        <Input
          type="password"
          placeholder={tx('新密码（至少8位）', 'New password (at least 8 chars)')}
          value={pwd.newPassword}
          onChange={(e) => onPwdChange((prev) => ({ ...prev, newPassword: e.target.value }))}
        />
        <Input
          type="password"
          placeholder={tx('确认新密码', 'Confirm new password')}
          value={pwd.confirmPassword}
          onChange={(e) => onPwdChange((prev) => ({ ...prev, confirmPassword: e.target.value }))}
        />
        <div className="flex justify-end">
          <Button onClick={onSubmit} disabled={passwordLoading}>
            {passwordLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Key className="h-4 w-4 mr-2" />
            {tx('保存新密码', 'Save Password')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
