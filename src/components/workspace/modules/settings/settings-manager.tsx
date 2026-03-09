'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useStore } from '@/lib/store';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  CustomerCandidate,
  IMPORT_RESULT_PAGE_SIZE,
  apiCall,
  fetchCustomerCandidatesByMark,
  fetchServerDate,
  getDisplayImageUrl,
  getErrorMessage,
  initCustomerImportRowViews,
  initInvoiceImportRowViews,
  lookupCustomerByOrderNoGroup,
  mergeCustomerImportRowViews,
  mergeInvoiceImportRowViews,
  summarizeRowsForAlert,
  toCustomerImportRowResults,
  toCustomerImportRowResultsFromIssues,
  toDateInputValue,
  toInvoiceImportRowResults,
  toInvoiceImportRowResultsFromIssues,
  useUiText,
  type CustomerImportIssueRow,
  type CustomerImportRowResult,
  type CustomerImportRowView,
  type InvoiceImportIssueRow,
  type InvoiceImportRowResult,
  type InvoiceImportRowView,
} from '@/components/workspace/shared';
import {
  Loader2, LogIn, LogOut, Users, FileText, Receipt, FileSpreadsheet,
  Building2, Trash2, Plus, Upload, Check, X, AlertTriangle, Eye,
  History, ArrowRight, RefreshCw, UserPlus, Key, LayoutDashboard, Settings, Save,
  ChevronDown, ChevronRight, Pencil
} from 'lucide-react';

import { UserManager } from '@/components/workspace/modules/users/user-manager';

export function SettingsManager() {
  const tx = useUiText();
  const { user } = useStore();
  const canManageUsers = user?.role === 'ADMIN' || user?.role === 'SALES';
  const [loading, setLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingConfig, setTestingConfig] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [canEditConfig, setCanEditConfig] = useState(false);
  const [canPurgeBranch, setCanPurgeBranch] = useState(false);
  const [branchPurgeTargets, setBranchPurgeTargets] = useState<Array<{ id: string; email: string; name: string | null; level: number; role: string; parentId: string | null }>>([]);
  const [purgeModuleKeys, setPurgeModuleKeys] = useState<string[]>([]);
  const [purgingBranch, setPurgingBranch] = useState(false);
  const [purgeForm, setPurgeForm] = useState<{ targetUserId: string; password: string; modules: string[] }>({
    targetUserId: '',
    password: '',
    modules: ['all'],
  });
  const [pwd, setPwd] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiCall('settings');
      if (result.success) {
        setConfig(result.data.settings || {});
        setCanEditConfig(Boolean(result.data.canEdit));
        setCanPurgeBranch(Boolean(result.data.canPurgeBranch));
        const targets = Array.isArray(result.data.branchPurgeTargets) ? result.data.branchPurgeTargets : [];
        setBranchPurgeTargets(targets);
        setPurgeModuleKeys(Array.isArray(result.data.purgeModuleKeys) ? result.data.purgeModuleKeys : []);
        setPurgeForm((prev) => ({
          ...prev,
          targetUserId: targets.some((row) => row.id === prev.targetUserId) ? prev.targetUserId : (targets[0]?.id || ''),
        }));
      }
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSaveConfig = async () => {
    if (!canEditConfig) return;
    setSavingConfig(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiCall('settings', {
        method: 'POST',
        body: JSON.stringify({ action: 'update-config', settings: config }),
      });
      if (result.success) {
        setMessage(result.message || tx('配置已保存', 'Configuration saved'));
      } else {
        setError(result.error || tx('保存失败', 'Save failed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('保存失败', 'Save failed'));
    } finally {
      setSavingConfig(false);
    }
  };

  const handleTestOcrConfig = async () => {
    if (!canEditConfig) return;
    setTestingConfig(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiCall('settings', {
        method: 'POST',
        body: JSON.stringify({ action: 'test-ocr' }),
      });
      if (result.success) {
        const detail = typeof result.detail === 'string' && result.detail ? ` | ${result.detail}` : '';
        setMessage(`${result.message || tx('OCR 测试成功', 'OCR test succeeded')}${detail}`);
      } else {
        const detail = typeof result.detail === 'string' && result.detail ? ` | ${result.detail}` : '';
        setError(`${result.error || tx('OCR 测试失败', 'OCR test failed')}${detail}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('OCR 测试失败', 'OCR test failed'));
    } finally {
      setTestingConfig(false);
    }
  };

  const handleChangePassword = async () => {
    setError(null);
    setMessage(null);
    if (!pwd.oldPassword || !pwd.newPassword || !pwd.confirmPassword) {
      setError(tx('请填写完整密码信息', 'Please complete all password fields.'));
      return;
    }
    if (pwd.newPassword !== pwd.confirmPassword) {
      setError(tx('两次输入的新密码不一致', 'The new passwords do not match.'));
      return;
    }
    setPasswordLoading(true);
    try {
      const result = await apiCall('auth', {
        method: 'POST',
        body: JSON.stringify({
          action: 'change-password',
          oldPassword: pwd.oldPassword,
          newPassword: pwd.newPassword,
        }),
      });
      if (result.success) {
        setPwd({ oldPassword: '', newPassword: '', confirmPassword: '' });
        setMessage(result.message || tx('密码修改成功', 'Password updated successfully'));
      } else {
        setError(result.error || tx('密码修改失败', 'Password update failed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('密码修改失败', 'Password update failed'));
    } finally {
      setPasswordLoading(false);
    }
  };

  const handlePurgeBranch = async () => {
    if (!canPurgeBranch) return;
    if (!purgeForm.targetUserId || !purgeForm.password) {
      setError(tx('请先选择账号并填写管理员密码', 'Please choose an account and enter admin password'));
      setMessage(null);
      return;
    }
    if (!Array.isArray(purgeForm.modules) || purgeForm.modules.length === 0) {
      setError(tx('请至少选择一个清理模块', 'Please choose at least one purge module'));
      setMessage(null);
      return;
    }
    const target = branchPurgeTargets.find((row) => row.id === purgeForm.targetUserId);
    if (!target) {
      setError(tx('目标账号不存在', 'Target account not found'));
      setMessage(null);
      return;
    }
    const moduleLabelMap: Record<string, string> = {
      invoice: 'invoice',
      receipt: 'receipt',
      detail: 'detail',
      swift: 'swift',
      customer: 'customer',
      all: 'all',
    };
    const moduleText = purgeForm.modules.map((key) => moduleLabelMap[key] || key).join(', ');
    const confirmed = window.confirm(
      tx(
        `确认清空 ${target.email} 分支数据？模块: ${moduleText}。该操作不可恢复。`,
        `Confirm purging ${target.email}'s branch data? Modules: ${moduleText}. This cannot be undone.`
      )
    );
    if (!confirmed) return;

    setPurgingBranch(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiCall('settings', {
        method: 'POST',
        body: JSON.stringify({
          action: 'purge-branch-data',
          targetUserId: purgeForm.targetUserId,
          password: purgeForm.password,
          modules: purgeForm.modules,
        }),
      });
      if (result.success) {
        setMessage(result.message || tx('分支业务数据已清空', 'Branch business data has been purged'));
        setPurgeForm((prev) => ({ ...prev, password: '' }));
      } else {
        setError(result.error || tx('清库失败', 'Purge failed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('清库失败', 'Purge failed'));
    } finally {
      setPurgingBranch(false);
    }
  };

  const updateConfigField = (key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const togglePurgeModule = (moduleKey: string, checked: boolean) => {
    setPurgeForm((prev) => {
      if (moduleKey === 'all') {
        return {
          ...prev,
          modules: checked ? ['all'] : [],
        };
      }
      const next = new Set(prev.modules.filter((row) => row !== 'all'));
      if (checked) next.add(moduleKey);
      else next.delete(moduleKey);
      return { ...prev, modules: Array.from(next) };
    });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">{tx('设置', 'Settings')}</h2>
      {(error || message) && (
        <Alert variant={error ? 'destructive' : 'default'}>
          <AlertDescription>{error || message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{tx('修改密码', 'Change Password')}</CardTitle>
          <CardDescription>{tx('当前账号：', 'Current Account: ')}{user?.email}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="password"
            placeholder={tx('旧密码', 'Current password')}
            value={pwd.oldPassword}
            onChange={(e) => setPwd((prev) => ({ ...prev, oldPassword: e.target.value }))}
          />
          <Input
            type="password"
            placeholder={tx('新密码（至少8位）', 'New password (at least 8 chars)')}
            value={pwd.newPassword}
            onChange={(e) => setPwd((prev) => ({ ...prev, newPassword: e.target.value }))}
          />
          <Input
            type="password"
            placeholder={tx('确认新密码', 'Confirm new password')}
            value={pwd.confirmPassword}
            onChange={(e) => setPwd((prev) => ({ ...prev, confirmPassword: e.target.value }))}
          />
          <div className="flex justify-end">
            <Button onClick={handleChangePassword} disabled={passwordLoading}>
              {passwordLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Key className="h-4 w-4 mr-2" />
              {tx('保存新密码', 'Save Password')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {canManageUsers && (
        <Card>
          <CardHeader>
            <CardTitle>{tx('用户管理', 'User Management')}</CardTitle>
            <CardDescription>{tx('用户管理已并入设置模块。', 'User management has been moved into Settings.')}</CardDescription>
          </CardHeader>
          <CardContent>
            <UserManager />
          </CardContent>
        </Card>
      )}

      {canPurgeBranch && (
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
                onChange={(e) => setPurgeForm((prev) => ({ ...prev, targetUserId: e.target.value }))}
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
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => togglePurgeModule(moduleKey, e.target.checked)}
                      />
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
                onChange={(e) => setPurgeForm((prev) => ({ ...prev, password: e.target.value }))}
                placeholder={tx('输入当前管理员密码', 'Enter current admin password')}
              />
            </div>
            <div className="flex justify-end">
              <Button variant="destructive" onClick={handlePurgeBranch} disabled={purgingBranch || !purgeForm.targetUserId || !purgeForm.password || purgeForm.modules.length === 0}>
                {purgingBranch && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {tx('执行分支清库', 'Run Branch Purge')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
                  <Input value={config.OCR_API_BASE_URL || ''} onChange={(e) => updateConfigField('OCR_API_BASE_URL', e.target.value)} disabled={!canEditConfig} />
                </div>
                <div>
                  <Label>OCR_MODEL</Label>
                  <Input value={config.OCR_MODEL || ''} onChange={(e) => updateConfigField('OCR_MODEL', e.target.value)} disabled={!canEditConfig} />
                </div>
                <div>
                  <Label>OCR_API_KEY</Label>
                  <Input type="password" value={config.OCR_API_KEY || ''} onChange={(e) => updateConfigField('OCR_API_KEY', e.target.value)} disabled={!canEditConfig} />
                </div>
                <div>
                  <Label>OCR_DISABLED</Label>
                  <select
                    className="w-full border rounded-md px-3 py-2 text-sm"
                    value={config.OCR_DISABLED || 'false'}
                    onChange={(e) => updateConfigField('OCR_DISABLED', e.target.value)}
                    disabled={!canEditConfig}
                  >
                    <option value="false">false</option>
                    <option value="true">true</option>
                  </select>
                </div>
                <div>
                  <Label>OCR_MAX_RETRIES</Label>
                  <Input value={config.OCR_MAX_RETRIES || ''} onChange={(e) => updateConfigField('OCR_MAX_RETRIES', e.target.value)} disabled={!canEditConfig} />
                </div>
                <div>
                  <Label>OCR_TIMEOUT_MS</Label>
                  <Input value={config.OCR_TIMEOUT_MS || ''} onChange={(e) => updateConfigField('OCR_TIMEOUT_MS', e.target.value)} disabled={!canEditConfig} />
                </div>
                <div>
                  <Label>OCR_RETRY_BASE_DELAY_MS</Label>
                  <Input value={config.OCR_RETRY_BASE_DELAY_MS || ''} onChange={(e) => updateConfigField('OCR_RETRY_BASE_DELAY_MS', e.target.value)} disabled={!canEditConfig} />
                </div>
                <div>
                  <Label>OCR_INPUT_COST_PER_1K</Label>
                  <Input value={config.OCR_INPUT_COST_PER_1K || ''} onChange={(e) => updateConfigField('OCR_INPUT_COST_PER_1K', e.target.value)} disabled={!canEditConfig} />
                </div>
                <div>
                  <Label>OCR_OUTPUT_COST_PER_1K</Label>
                  <Input value={config.OCR_OUTPUT_COST_PER_1K || ''} onChange={(e) => updateConfigField('OCR_OUTPUT_COST_PER_1K', e.target.value)} disabled={!canEditConfig} />
                </div>
                <div>
                  <Label>SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS</Label>
                  <select
                    className="w-full border rounded-md px-3 py-2 text-sm"
                    value={config.SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS || 'false'}
                    onChange={(e) => updateConfigField('SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS', e.target.value)}
                    disabled={!canEditConfig}
                  >
                    <option value="false">false</option>
                    <option value="true">true</option>
                  </select>
                </div>
                <div>
                  <Label>DETAIL_RECEIPT_MATCH_TOLERANCE</Label>
                  <Input value={config.DETAIL_RECEIPT_MATCH_TOLERANCE || '5'} onChange={(e) => updateConfigField('DETAIL_RECEIPT_MATCH_TOLERANCE', e.target.value)} disabled={!canEditConfig} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleTestOcrConfig} disabled={!canEditConfig || testingConfig}>
                  {testingConfig && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {tx('测试OCR连通', 'Test OCR Connection')}
                </Button>
                <Button onClick={handleSaveConfig} disabled={!canEditConfig || savingConfig}>
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
    </div>
  );
}

