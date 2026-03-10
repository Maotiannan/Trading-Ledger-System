'use client';

import { useCallback } from 'react';
import { apiCall } from '@/components/workspace/shared';
import type { BranchPurgeTarget, PasswordFormState, PurgeFormState } from '../types';

export type SettingsActionText = (zh: string, en: string) => string;

export type SettingsActionDeps = {
  tx: SettingsActionText;
  userEmail?: string | null;
  canEditConfig: boolean;
  canPurgeBranch: boolean;
  config: Record<string, string>;
  branchPurgeTargets: BranchPurgeTarget[];
  purgeForm: PurgeFormState;
  pwd: PasswordFormState;
  setLoading: (value: boolean) => void;
  setSavingConfig: (value: boolean) => void;
  setTestingConfig: (value: boolean) => void;
  setPasswordLoading: (value: boolean) => void;
  setMessage: (value: string | null) => void;
  setError: (value: string | null) => void;
  setConfig: (value: Record<string, string>) => void;
  setCanEditConfig: (value: boolean) => void;
  setCanPurgeBranch: (value: boolean) => void;
  setBranchPurgeTargets: (value: BranchPurgeTarget[]) => void;
  setPurgeModuleKeys: (value: string[]) => void;
  setPurgingBranch: (value: boolean) => void;
  setPurgeForm: React.Dispatch<React.SetStateAction<PurgeFormState>>;
  setPwd: (value: PasswordFormState) => void;
};

export function useSettingsActions({
  tx,
  canEditConfig,
  canPurgeBranch,
  config,
  branchPurgeTargets,
  purgeForm,
  pwd,
  setLoading,
  setSavingConfig,
  setTestingConfig,
  setPasswordLoading,
  setMessage,
  setError,
  setConfig,
  setCanEditConfig,
  setCanPurgeBranch,
  setBranchPurgeTargets,
  setPurgeModuleKeys,
  setPurgingBranch,
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
  }, [setBranchPurgeTargets, setCanEditConfig, setCanPurgeBranch, setConfig, setError, setLoading, setPurgeForm, setPurgeModuleKeys]);

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
      } else {
        setError(result.error || tx('保存失败', 'Save failed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('保存失败', 'Save failed'));
    } finally {
      setSavingConfig(false);
    }
  }, [canEditConfig, config, setError, setMessage, setSavingConfig, tx]);

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
        const detail = typeof result.detail === 'string' && result.detail ? ` | ${result.detail}` : '';
        setError(`${result.error || tx('OCR 测试失败', 'OCR test failed')}${detail}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('OCR 测试失败', 'OCR test failed'));
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
        setError(result.error || tx('密码修改失败', 'Password update failed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('密码修改失败', 'Password update failed'));
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
        setError(result.error || tx('清库失败', 'Purge failed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('清库失败', 'Purge failed'));
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
  };
}
