'use client';

import { useCallback } from 'react';
import { apiCall, getApiErrorMessage } from '@/components/workspace/shared';
import type {
  BranchPurgeTarget,
  PasswordFormState,
  PurgeFormState,
  SettingsAuditEntry,
  SettingsAuditFilterState,
} from '../types';

export type SettingsActionText = (zh: string, en: string) => string;

export type SettingsActionDeps = {
  tx: SettingsActionText;
  userEmail?: string | null;
  canEditConfig: boolean;
  canPurgeBranch: boolean;
  config: Record<string, string>;
  canViewAudit: boolean;
  branchPurgeTargets: BranchPurgeTarget[];
  purgeForm: PurgeFormState;
  pwd: PasswordFormState;
  auditCursor: string | null;
  auditFilters: SettingsAuditFilterState;
  setLoading: (value: boolean) => void;
  setSavingConfig: (value: boolean) => void;
  setTestingConfig: (value: boolean) => void;
  setPasswordLoading: (value: boolean) => void;
  setAuditLoading: (value: boolean) => void;
  setAuditLoadingMore: (value: boolean) => void;
  setMessage: (value: string | null) => void;
  setError: (value: string | null) => void;
  setConfig: (value: Record<string, string>) => void;
  setCanEditConfig: (value: boolean) => void;
  setCanViewAudit: (value: boolean) => void;
  setCanPurgeBranch: (value: boolean) => void;
  setBranchPurgeTargets: (value: BranchPurgeTarget[]) => void;
  setPurgeModuleKeys: (value: string[]) => void;
  setPurgingBranch: (value: boolean) => void;
  setSettingsAuditEntries: React.Dispatch<React.SetStateAction<SettingsAuditEntry[]>>;
  setSettingsAuditCursor: (value: string | null) => void;
  setSettingsAuditHasMore: (value: boolean) => void;
  setSettingsAuditFilters: React.Dispatch<React.SetStateAction<SettingsAuditFilterState>>;
  setPurgeForm: React.Dispatch<React.SetStateAction<PurgeFormState>>;
  setPwd: (value: PasswordFormState) => void;
};

const emptyAuditFilters: SettingsAuditFilterState = {
  actorQuery: '',
  settingKey: '',
  dateFrom: '',
  dateTo: '',
};

function buildAuditQuery(filters: SettingsAuditFilterState, cursor?: string | null) {
  const query = new URLSearchParams({ view: 'audit', limit: '20' });
  if (cursor) query.set('cursor', cursor);
  if (filters.actorQuery.trim()) query.set('actor', filters.actorQuery.trim());
  if (filters.settingKey.trim()) query.set('key', filters.settingKey.trim());
  if (filters.dateFrom.trim()) query.set('dateFrom', filters.dateFrom.trim());
  if (filters.dateTo.trim()) query.set('dateTo', filters.dateTo.trim());
  return query.toString();
}

export function useSettingsActions({
  tx,
  canEditConfig,
  canViewAudit,
  canPurgeBranch,
  config,
  branchPurgeTargets,
  purgeForm,
  pwd,
  auditCursor,
  auditFilters,
  setLoading,
  setSavingConfig,
  setTestingConfig,
  setPasswordLoading,
  setAuditLoading,
  setAuditLoadingMore,
  setMessage,
  setError,
  setConfig,
  setCanEditConfig,
  setCanViewAudit,
  setCanPurgeBranch,
  setBranchPurgeTargets,
  setPurgeModuleKeys,
  setPurgingBranch,
  setSettingsAuditEntries,
  setSettingsAuditCursor,
  setSettingsAuditHasMore,
  setSettingsAuditFilters,
  setPurgeForm,
  setPwd,
}: SettingsActionDeps) {
  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiCall('settings');
      if (result.success) {
        setConfig(result.data.settings || {});
        setCanEditConfig(Boolean(result.data.canEdit));
        const nextCanViewAudit = Boolean(result.data.canViewAudit);
        setCanViewAudit(nextCanViewAudit);
        setCanPurgeBranch(Boolean(result.data.canPurgeBranch));
        const targets = Array.isArray(result.data.branchPurgeTargets) ? result.data.branchPurgeTargets : [];
        setBranchPurgeTargets(targets);
        setPurgeModuleKeys(Array.isArray(result.data.purgeModuleKeys) ? result.data.purgeModuleKeys : []);
        if (!nextCanViewAudit) {
          setSettingsAuditEntries([]);
          setSettingsAuditCursor(null);
          setSettingsAuditHasMore(false);
        }
        setPurgeForm((prev) => ({
          ...prev,
          targetUserId: targets.some((row) => row.id === prev.targetUserId) ? prev.targetUserId : (targets[0]?.id || ''),
        }));
      }
    } catch (err) {
      setError(getApiErrorMessage(err, tx('加载设置失败', 'Failed to load settings')));
    } finally {
      setLoading(false);
    }
  }, [setBranchPurgeTargets, setCanEditConfig, setCanPurgeBranch, setCanViewAudit, setConfig, setError, setLoading, setPurgeForm, setPurgeModuleKeys, setSettingsAuditCursor, setSettingsAuditEntries, setSettingsAuditHasMore, tx]);

  const loadSettingsAudit = useCallback(async (options: { append?: boolean; filters?: SettingsAuditFilterState } = {}) => {
    if (!canViewAudit) {
      setSettingsAuditEntries([]);
      setSettingsAuditCursor(null);
      setSettingsAuditHasMore(false);
      return;
    }

    const append = Boolean(options.append);
    const filters = options.filters || emptyAuditFilters;
    const cursor = append ? auditCursor : null;
    if (append) setAuditLoadingMore(true);
    else setAuditLoading(true);

    try {
      const result = await apiCall(`settings?${buildAuditQuery(filters, cursor)}`);
      if (result.success) {
        const items = Array.isArray(result.data?.items) ? result.data.items : [];
        setSettingsAuditEntries((prev) => (append ? [...prev, ...items] : items));
        setSettingsAuditCursor(typeof result.data?.nextCursor === 'string' && result.data.nextCursor ? result.data.nextCursor : null);
        setSettingsAuditHasMore(Boolean(result.data?.nextCursor));
      }
    } catch (err) {
      setError(getApiErrorMessage(err, tx('加载配置审计失败', 'Failed to load configuration audit')));
    } finally {
      if (append) setAuditLoadingMore(false);
      else setAuditLoading(false);
    }
  }, [
    auditCursor,
    canViewAudit,
    setAuditLoading,
    setAuditLoadingMore,
    setError,
    setSettingsAuditCursor,
    setSettingsAuditEntries,
    setSettingsAuditHasMore,
    tx,
  ]);

  const applyAuditFilters = useCallback(async () => {
    await loadSettingsAudit({ filters: auditFilters });
  }, [auditFilters, loadSettingsAudit]);

  const resetAuditFilters = useCallback(async () => {
    setSettingsAuditFilters(emptyAuditFilters);
    await loadSettingsAudit({ filters: emptyAuditFilters });
  }, [loadSettingsAudit, setSettingsAuditFilters]);

  const handleSaveConfig = useCallback(async () => {
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
        await loadSettingsAudit({ filters: auditFilters });
      } else {
        setError(getApiErrorMessage(result, tx('保存失败', 'Save failed')));
      }
    } catch (err) {
      setError(getApiErrorMessage(err, tx('保存失败', 'Save failed')));
    } finally {
      setSavingConfig(false);
    }
  }, [auditFilters, canEditConfig, config, loadSettingsAudit, setError, setMessage, setSavingConfig, tx]);

  const handleTestOcrConfig = useCallback(async () => {
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
        setError(getApiErrorMessage(result, tx('OCR 测试失败', 'OCR test failed'), { appendDetail: true }));
      }
    } catch (err) {
      setError(getApiErrorMessage(err, tx('OCR 测试失败', 'OCR test failed'), { appendDetail: true }));
    } finally {
      setTestingConfig(false);
    }
  }, [canEditConfig, setError, setMessage, setTestingConfig, tx]);

  const handleChangePassword = useCallback(async () => {
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
        setError(getApiErrorMessage(result, tx('密码修改失败', 'Password update failed')));
      }
    } catch (err) {
      setError(getApiErrorMessage(err, tx('密码修改失败', 'Password update failed')));
    } finally {
      setPasswordLoading(false);
    }
  }, [pwd, setError, setMessage, setPasswordLoading, setPwd, tx]);

  const handlePurgeBranch = useCallback(async () => {
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
        `Confirm purging ${target.email}'s branch data? Modules: ${moduleText}. This cannot be undone.`,
      ),
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
        setError(getApiErrorMessage(result, tx('清库失败', 'Purge failed')));
      }
    } catch (err) {
      setError(getApiErrorMessage(err, tx('清库失败', 'Purge failed')));
    } finally {
      setPurgingBranch(false);
    }
  }, [branchPurgeTargets, canPurgeBranch, purgeForm, setError, setMessage, setPurgeForm, setPurgingBranch, tx]);

  return {
    loadSettings,
    handleSaveConfig,
    handleTestOcrConfig,
    handleChangePassword,
    handlePurgeBranch,
    loadSettingsAudit,
    applyAuditFilters,
    resetAuditFilters,
  };
}
