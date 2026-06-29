'use client';

import { useCallback } from 'react';
import { apiCall, getApiErrorMessage, getApiResponseErrorMessage, peekPrefetchedApiResult, rememberPrefetchedApiResult } from '@/components/workspace/shared';
import {
  normalizeDashboardLayoutPreference,
  validateDashboardLayoutPreferenceForSave,
} from '@/lib/dashboard-layout-preference';
import {
  DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE,
  normalizeListPageSizePreference,
  validateListPageSizePreference,
} from '@/lib/list-page-size-preference';
import type {
  BranchPurgeTarget,
  PasswordFormState,
  PurgeFormState,
  SettingsAuditEntry,
  SettingsAuditExportEntry,
  SettingsAuditFilterState,
  SettingsAuditMeta,
  UserImageCompressionPreference,
  UserImageCompressionPreferenceDraft,
  UserPreferenceSettings,
  UserPreferenceSettingsDraft,
} from '../types';
import {
  defaultUserImageCompressionPreference,
  defaultUserImageCompressionPreferenceDraft,
  USER_IMAGE_COMPRESSION_LIMITS,
} from '../types';
import {
  buildEmptySettingsAuditFilters,
  buildSettingsAuditQuery,
  clampSettingsAuditFilters,
  normalizeSettingsAuditExportHistoryPage,
  normalizeSettingsAuditPage,
  normalizeSettingsBootstrap,
} from '../read-model';

export type SettingsActionText = (zh: string, en: string) => string;

export type SettingsActionDeps = {
  tx: SettingsActionText;
  userEmail?: string | null;
  canEditConfig: boolean;
  canPurgeBranch: boolean;
  config: Record<string, string>;
  canViewAudit: boolean;
  userPreferences: UserPreferenceSettingsDraft;
  branchPurgeTargets: BranchPurgeTarget[];
  purgeForm: PurgeFormState;
  pwd: PasswordFormState;
  auditCursor: string | null;
  auditExportHistoryCursor: string | null;
  auditFilters: SettingsAuditFilterState;
  auditMeta: SettingsAuditMeta;
  setLoading: (value: boolean) => void;
  setSavingConfig: (value: boolean) => void;
  setUserPreferencesLoading: (value: boolean) => void;
  setSavingUserPreferences: (value: boolean) => void;
  setTestingConfig: (value: boolean) => void;
  setPasswordLoading: (value: boolean) => void;
  setAuditLoading: (value: boolean) => void;
  setAuditLoadingMore: (value: boolean) => void;
  setAuditExporting: (value: boolean) => void;
  setMessage: (value: string | null) => void;
  setError: (value: string | null) => void;
  setConfig: (value: Record<string, string>) => void;
  setUserPreferences: (value: UserPreferenceSettingsDraft) => void;
  setCanEditConfig: (value: boolean) => void;
  setCanViewAudit: (value: boolean) => void;
  setCanPurgeBranch: (value: boolean) => void;
  setBranchPurgeTargets: (value: BranchPurgeTarget[]) => void;
  setPurgeModuleKeys: (value: string[]) => void;
  setPurgingBranch: (value: boolean) => void;
  setSettingsAuditEntries: React.Dispatch<React.SetStateAction<SettingsAuditEntry[]>>;
  setSettingsAuditCursor: (value: string | null) => void;
  setSettingsAuditHasMore: (value: boolean) => void;
  setSettingsAuditExportHistoryEntries: React.Dispatch<React.SetStateAction<SettingsAuditExportEntry[]>>;
  setSettingsAuditExportHistoryCursor: (value: string | null) => void;
  setSettingsAuditExportHistoryHasMore: (value: boolean) => void;
  setSettingsAuditExportHistoryLoading: (value: boolean) => void;
  setSettingsAuditExportHistoryLoadingMore: (value: boolean) => void;
  setSettingsAuditMeta: (value: SettingsAuditMeta) => void;
  setSettingsAuditFilters: React.Dispatch<React.SetStateAction<SettingsAuditFilterState>>;
  setPurgeForm: React.Dispatch<React.SetStateAction<PurgeFormState>>;
  setPwd: (value: PasswordFormState) => void;
};

export function useSettingsActions({
  tx,
  canEditConfig,
  canViewAudit,
  canPurgeBranch,
  config,
  branchPurgeTargets,
  userPreferences,
  purgeForm,
  pwd,
  auditCursor,
  auditExportHistoryCursor,
  auditFilters,
  auditMeta,
  setLoading,
  setSavingConfig,
  setUserPreferencesLoading,
  setSavingUserPreferences,
  setTestingConfig,
  setPasswordLoading,
  setAuditLoading,
  setAuditLoadingMore,
  setAuditExporting,
  setMessage,
  setError,
  setConfig,
  setUserPreferences,
  setCanEditConfig,
  setCanViewAudit,
  setCanPurgeBranch,
  setBranchPurgeTargets,
  setPurgeModuleKeys,
  setPurgingBranch,
  setSettingsAuditEntries,
  setSettingsAuditCursor,
  setSettingsAuditHasMore,
  setSettingsAuditExportHistoryEntries,
  setSettingsAuditExportHistoryCursor,
  setSettingsAuditExportHistoryHasMore,
  setSettingsAuditExportHistoryLoading,
  setSettingsAuditExportHistoryLoadingMore,
  setSettingsAuditMeta,
  setSettingsAuditFilters,
  setPurgeForm,
  setPwd,
}: SettingsActionDeps) {
  const normalizeUserPreferences = useCallback((payload: unknown): UserPreferenceSettingsDraft => {
    if (!payload || typeof payload !== 'object') {
      return {
        ...defaultUserImageCompressionPreferenceDraft,
        dashboardLayout: normalizeDashboardLayoutPreference(null),
        listPageSizes: DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE,
      };
    }

    const source = payload as Partial<UserPreferenceSettings>;
    return {
      imageCompressionEnabled: typeof source.imageCompressionEnabled === 'boolean'
        ? source.imageCompressionEnabled
        : defaultUserImageCompressionPreference.imageCompressionEnabled,
      imageCompressionQualityFloor: Number.isFinite(source.imageCompressionQualityFloor)
        ? String(Number(source.imageCompressionQualityFloor))
        : defaultUserImageCompressionPreferenceDraft.imageCompressionQualityFloor,
      ocrTargetMaxKb: Number.isFinite(source.ocrTargetMaxKb)
        ? String(Number(source.ocrTargetMaxKb))
        : defaultUserImageCompressionPreferenceDraft.ocrTargetMaxKb,
      dashboardLayout: normalizeDashboardLayoutPreference(source.dashboardLayout),
      listPageSizes: normalizeListPageSizePreference(source.listPageSizes),
    };
  }, []);

  const validateUserPreferences = useCallback((
    preferences: UserPreferenceSettingsDraft,
  ): { ok: true; value: UserPreferenceSettings } | { ok: false; error: string } => {
    const qualityFloorText = preferences.imageCompressionQualityFloor.trim();
    const qualityFloor = qualityFloorText === '' ? Number.NaN : Number(qualityFloorText);
    if (
      !Number.isFinite(qualityFloor)
      || qualityFloor < USER_IMAGE_COMPRESSION_LIMITS.qualityFloor.min
    ) {
      return {
        ok: false,
        error: tx(
          `图片压缩质量下限不能低于 ${USER_IMAGE_COMPRESSION_LIMITS.qualityFloor.min.toFixed(2)}`,
          `Image compression quality floor must not be lower than ${USER_IMAGE_COMPRESSION_LIMITS.qualityFloor.min.toFixed(2)}`,
        ),
      };
    }
    if (qualityFloor > USER_IMAGE_COMPRESSION_LIMITS.qualityFloor.max) {
      return {
        ok: false,
        error: tx(
          `图片压缩质量下限不能高于 ${USER_IMAGE_COMPRESSION_LIMITS.qualityFloor.max.toFixed(2)}`,
          `Image compression quality floor must not be higher than ${USER_IMAGE_COMPRESSION_LIMITS.qualityFloor.max.toFixed(2)}`,
        ),
      };
    }

    const ocrTargetMaxKbText = preferences.ocrTargetMaxKb.trim();
    const ocrTargetMaxKb = ocrTargetMaxKbText === '' ? Number.NaN : Number(ocrTargetMaxKbText);
    if (
      !Number.isInteger(ocrTargetMaxKb)
      || ocrTargetMaxKb < USER_IMAGE_COMPRESSION_LIMITS.ocrTargetMaxKb.min
      || ocrTargetMaxKb > USER_IMAGE_COMPRESSION_LIMITS.ocrTargetMaxKb.max
    ) {
      return {
        ok: false,
        error: tx(
          `OCR 目标大小必须为 ${USER_IMAGE_COMPRESSION_LIMITS.ocrTargetMaxKb.min}-${USER_IMAGE_COMPRESSION_LIMITS.ocrTargetMaxKb.max} KB 的整数`,
          `OCR target max size must be an integer between ${USER_IMAGE_COMPRESSION_LIMITS.ocrTargetMaxKb.min} and ${USER_IMAGE_COMPRESSION_LIMITS.ocrTargetMaxKb.max} KB`,
        ),
      };
    }

    let dashboardLayout;
    try {
      dashboardLayout = validateDashboardLayoutPreferenceForSave(preferences.dashboardLayout);
    } catch {
      return {
        ok: false,
        error: tx('Dashboard 设置格式错误', 'Dashboard settings are invalid'),
      };
    }

    let listPageSizes;
    try {
      listPageSizes = validateListPageSizePreference(preferences.listPageSizes);
    } catch {
      return {
        ok: false,
        error: tx('列表分页设置格式错误', 'List page size settings are invalid'),
      };
    }

    return {
      ok: true,
      value: {
        imageCompressionEnabled: preferences.imageCompressionEnabled,
        imageCompressionQualityFloor: Number(qualityFloor.toFixed(2)),
        ocrTargetMaxKb,
        dashboardLayout,
        listPageSizes,
      },
    };
  }, [tx]);

  const applySettingsBootstrap = useCallback((payload: unknown) => {
    const nextState = normalizeSettingsBootstrap(payload);
    setConfig(nextState.config);
    setSettingsAuditMeta(nextState.auditMeta);
    setSettingsAuditFilters((prev) => clampSettingsAuditFilters(prev, nextState.auditMeta));
    setCanEditConfig(nextState.canEditConfig);
    const nextCanViewAudit = nextState.canViewAudit;
    setCanViewAudit(nextCanViewAudit);
    setCanPurgeBranch(nextState.canPurgeBranch);
    const targets = nextState.branchPurgeTargets;
    setBranchPurgeTargets(targets);
    setPurgeModuleKeys(nextState.purgeModuleKeys);
    if (!nextCanViewAudit) {
      setSettingsAuditEntries([]);
      setSettingsAuditCursor(null);
      setSettingsAuditHasMore(false);
      setSettingsAuditExportHistoryEntries([]);
      setSettingsAuditExportHistoryCursor(null);
      setSettingsAuditExportHistoryHasMore(false);
    }
    setPurgeForm((prev) => ({
      ...prev,
      targetUserId: targets.some((row) => row.id === prev.targetUserId) ? prev.targetUserId : (targets[0]?.id || ''),
    }));
  }, [setBranchPurgeTargets, setCanEditConfig, setCanPurgeBranch, setCanViewAudit, setConfig, setPurgeForm, setPurgeModuleKeys, setSettingsAuditCursor, setSettingsAuditEntries, setSettingsAuditExportHistoryCursor, setSettingsAuditExportHistoryEntries, setSettingsAuditExportHistoryHasMore, setSettingsAuditFilters, setSettingsAuditHasMore, setSettingsAuditMeta]);

  const loadUserPreferences = useCallback(async () => {
    setUserPreferencesLoading(true);
    setError(null);
    try {
      const result = await apiCall('settings?view=user-preferences');
      if (result.success) {
        setUserPreferences(normalizeUserPreferences(result.data));
      }
    } catch (err) {
      setError(getApiErrorMessage(err, tx('加载个人图片压缩偏好失败', 'Failed to load personal image compression preferences')));
    } finally {
      setUserPreferencesLoading(false);
    }
  }, [normalizeUserPreferences, setError, setUserPreferences, setUserPreferencesLoading, tx]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    const endpoint = 'settings';
    const cachedResult = peekPrefetchedApiResult<{ success?: boolean; data?: unknown }>(endpoint);
    if (cachedResult?.success) {
      applySettingsBootstrap(cachedResult.data);
      setLoading(false);
    }
    try {
      const result = await apiCall(endpoint);
      if (result.success) {
        applySettingsBootstrap(result.data);
        rememberPrefetchedApiResult(endpoint, result);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, tx('加载设置失败', 'Failed to load settings')));
    } finally {
      setLoading(false);
    }
  }, [applySettingsBootstrap, setError, setLoading, tx]);

  const loadSettingsAudit = useCallback(async (options: { append?: boolean; filters?: SettingsAuditFilterState } = {}) => {
    if (!canViewAudit) {
      setSettingsAuditEntries([]);
      setSettingsAuditCursor(null);
      setSettingsAuditHasMore(false);
      return;
    }

    const append = Boolean(options.append);
    const filters = clampSettingsAuditFilters(options.filters || auditFilters || buildEmptySettingsAuditFilters(auditMeta), auditMeta);
    const cursor = append ? auditCursor : null;
    if (append) setAuditLoadingMore(true);
    else setAuditLoading(true);

    try {
      const result = await apiCall(`settings?${buildSettingsAuditQuery('audit', filters, cursor)}`);
      if (result.success) {
        const nextPage = normalizeSettingsAuditPage(result.data, auditMeta);
        setSettingsAuditMeta(nextPage.meta);
        setSettingsAuditEntries((prev) => (append ? [...prev, ...nextPage.items] : nextPage.items));
        setSettingsAuditCursor(nextPage.nextCursor);
        setSettingsAuditHasMore(Boolean(nextPage.nextCursor));
      }
    } catch (err) {
      setError(getApiErrorMessage(err, tx('加载配置审计失败', 'Failed to load configuration audit')));
    } finally {
      if (append) setAuditLoadingMore(false);
      else setAuditLoading(false);
    }
  }, [
    auditCursor,
    auditMeta,
    canViewAudit,
    setAuditLoading,
    setAuditLoadingMore,
    setError,
    setSettingsAuditCursor,
    setSettingsAuditEntries,
    setSettingsAuditHasMore,
    setSettingsAuditMeta,
    tx,
  ]);

  const loadSettingsAuditExportHistory = useCallback(async (options: { append?: boolean; filters?: SettingsAuditFilterState } = {}) => {
    if (!canViewAudit) {
      setSettingsAuditExportHistoryEntries([]);
      setSettingsAuditExportHistoryCursor(null);
      setSettingsAuditExportHistoryHasMore(false);
      return;
    }

    const append = Boolean(options.append);
    const filters = clampSettingsAuditFilters(options.filters || auditFilters || buildEmptySettingsAuditFilters(auditMeta), auditMeta);
    const cursor = append ? auditExportHistoryCursor : null;
    if (append) setSettingsAuditExportHistoryLoadingMore(true);
    else setSettingsAuditExportHistoryLoading(true);

    try {
      const result = await apiCall(`settings?${buildSettingsAuditQuery('audit-export-history', filters, cursor)}`);
      if (result.success) {
        const nextPage = normalizeSettingsAuditExportHistoryPage(result.data, auditMeta);
        setSettingsAuditMeta(nextPage.meta);
        setSettingsAuditExportHistoryEntries((prev) => (append ? [...prev, ...nextPage.items] : nextPage.items));
        setSettingsAuditExportHistoryCursor(nextPage.nextCursor);
        setSettingsAuditExportHistoryHasMore(Boolean(nextPage.nextCursor));
      }
    } catch (err) {
      setError(getApiErrorMessage(err, tx('加载导出历史失败', 'Failed to load export history')));
    } finally {
      if (append) setSettingsAuditExportHistoryLoadingMore(false);
      else setSettingsAuditExportHistoryLoading(false);
    }
  }, [
    auditExportHistoryCursor,
    auditMeta,
    auditFilters,
    canViewAudit,
    setError,
    setSettingsAuditExportHistoryCursor,
    setSettingsAuditExportHistoryEntries,
    setSettingsAuditExportHistoryHasMore,
    setSettingsAuditExportHistoryLoading,
    setSettingsAuditExportHistoryLoadingMore,
    setSettingsAuditMeta,
    tx,
  ]);

  const applyAuditFilters = useCallback(async () => {
    await loadSettingsAudit({ filters: auditFilters });
    await loadSettingsAuditExportHistory({ filters: auditFilters });
  }, [auditFilters, loadSettingsAudit, loadSettingsAuditExportHistory]);

  const resetAuditFilters = useCallback(async () => {
    const nextFilters = buildEmptySettingsAuditFilters(auditMeta);
    setSettingsAuditFilters(nextFilters);
    await loadSettingsAudit({ filters: nextFilters });
    await loadSettingsAuditExportHistory({ filters: nextFilters });
  }, [auditMeta, loadSettingsAudit, loadSettingsAuditExportHistory, setSettingsAuditFilters]);

  const exportSettingsAudit = useCallback(async () => {
    if (!canViewAudit) return;
    setAuditExporting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/settings?${buildSettingsAuditQuery('audit', auditFilters, null, { format: 'csv', includeLimit: false })}`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(await getApiResponseErrorMessage(response, tx('导出配置审计失败', 'Failed to export configuration audit')));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const contentDisposition = response.headers.get('content-disposition') || '';
      const fileName = /filename="([^"]+)"/.exec(contentDisposition)?.[1] || 'settings-audit.csv';
      const exportCount = Number(response.headers.get('x-export-row-count') || 0);
      const exportLimit = Number(response.headers.get('x-export-limit-applied') || auditFilters.exportLimit || 0);
      const maxExportRows = Number(response.headers.get('x-export-limit-max') || auditMeta.maxExportRows || 0);
      const truncated = response.headers.get('x-export-truncated') === 'true';
      const exportSummary = response.headers.get('x-export-summary');
      let decodedExportSummary: string | null = null;
      if (exportSummary) {
        try {
          decodedExportSummary = decodeURIComponent(exportSummary);
        } catch {
          decodedExportSummary = exportSummary;
        }
      }
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      setMessage(
        decodedExportSummary || tx(
          `配置审计导出完成：已导出 ${exportCount} 条（服务端上限 ${maxExportRows || exportLimit}${truncated ? '，结果已截断' : ''}）`,
          `Configuration audit export completed: exported ${exportCount} rows (server cap ${maxExportRows || exportLimit}${truncated ? ', truncated' : ''})`,
        ),
      );
      await loadSettingsAuditExportHistory({ filters: auditFilters });
    } catch (err) {
      setError(getApiErrorMessage(err, tx('导出配置审计失败', 'Failed to export configuration audit')));
    } finally {
      setAuditExporting(false);
    }
  }, [auditFilters, auditMeta.maxExportRows, canViewAudit, loadSettingsAuditExportHistory, setAuditExporting, setError, setMessage, tx]);

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
        await loadSettings();
        await loadSettingsAudit({ filters: clampSettingsAuditFilters(auditFilters, auditMeta) });
      } else {
        setError(getApiErrorMessage(result, tx('保存失败', 'Save failed')));
      }
    } catch (err) {
      setError(getApiErrorMessage(err, tx('保存失败', 'Save failed')));
    } finally {
      setSavingConfig(false);
    }
  }, [auditFilters, auditMeta, canEditConfig, config, loadSettings, loadSettingsAudit, setError, setMessage, setSavingConfig, tx]);

  const handleSaveUserPreferences = useCallback(async () => {
    setSavingUserPreferences(true);
    setError(null);
    setMessage(null);
    const validatedPreferences = validateUserPreferences(userPreferences);
    if (!validatedPreferences.ok) {
      setError(validatedPreferences.error);
      setSavingUserPreferences(false);
      return;
    }
    try {
      const result = await apiCall('settings', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update-user-preferences',
          preferences: validatedPreferences.value,
        }),
      });
      if (result.success) {
        setUserPreferences(result.data ? normalizeUserPreferences(result.data) : normalizeUserPreferences(validatedPreferences.value));
        setMessage(result.message || tx('个人偏好已保存', 'Personal preferences saved'));
      } else {
        setError(getApiErrorMessage(result, tx('保存个人偏好失败', 'Failed to save personal preferences')));
      }
    } catch (err) {
      setError(getApiErrorMessage(err, tx('保存个人偏好失败', 'Failed to save personal preferences')));
    } finally {
      setSavingUserPreferences(false);
    }
  }, [normalizeUserPreferences, setError, setMessage, setSavingUserPreferences, setUserPreferences, tx, userPreferences, validateUserPreferences]);

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
    loadUserPreferences,
    handleSaveConfig,
    handleSaveUserPreferences,
    handleTestOcrConfig,
    handleChangePassword,
    handlePurgeBranch,
    loadSettingsAudit,
    loadSettingsAuditExportHistory,
    applyAuditFilters,
    resetAuditFilters,
    exportSettingsAudit,
  };
}
