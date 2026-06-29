'use client';

import { useState } from 'react';
import { DEFAULT_DASHBOARD_LAYOUT, type DashboardLayoutPreference } from '@/lib/dashboard-layout-preference';
import { DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE } from '@/lib/list-page-size-preference';
import type {
  BranchPurgeTarget,
  PasswordFormState,
  PurgeFormState,
  SettingsAuditEntry,
  SettingsAuditExportEntry,
  SettingsAuditFilterState,
  SettingsAuditMeta,
  UserImageCompressionPreferenceField,
  UserImageCompressionPreferenceFieldValue,
  UserImageCompressionPreferenceDraft,
  UserPreferenceSettingsDraft,
} from '../types';
import { defaultUserImageCompressionPreferenceDraft } from '../types';
import { buildEmptySettingsAuditFilters, defaultSettingsAuditMeta } from '../read-model';

function assertNever(value: never): never {
  throw new Error(`Unhandled user preference field: ${String(value)}`);
}

const defaultUserPreferenceSettingsDraft: UserPreferenceSettingsDraft = {
  ...defaultUserImageCompressionPreferenceDraft,
  dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
  listPageSizes: DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE,
};

export function useSettingsForms() {
  const [loading, setLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [userPreferencesLoading, setUserPreferencesLoading] = useState(false);
  const [savingUserPreferences, setSavingUserPreferences] = useState(false);
  const [testingConfig, setTestingConfig] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [userPreferences, setUserPreferences] = useState<UserPreferenceSettingsDraft>(defaultUserPreferenceSettingsDraft);
  const [canEditConfig, setCanEditConfig] = useState(false);
  const [canViewAudit, setCanViewAudit] = useState(false);
  const [canPurgeBranch, setCanPurgeBranch] = useState(false);
  const [branchPurgeTargets, setBranchPurgeTargets] = useState<BranchPurgeTarget[]>([]);
  const [purgeModuleKeys, setPurgeModuleKeys] = useState<string[]>([]);
  const [purgingBranch, setPurgingBranch] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLoadingMore, setAuditLoadingMore] = useState(false);
  const [auditExporting, setAuditExporting] = useState(false);
  const [settingsAuditEntries, setSettingsAuditEntries] = useState<SettingsAuditEntry[]>([]);
  const [settingsAuditCursor, setSettingsAuditCursor] = useState<string | null>(null);
  const [settingsAuditHasMore, setSettingsAuditHasMore] = useState(false);
  const [settingsAuditExportHistoryEntries, setSettingsAuditExportHistoryEntries] = useState<SettingsAuditExportEntry[]>([]);
  const [settingsAuditExportHistoryCursor, setSettingsAuditExportHistoryCursor] = useState<string | null>(null);
  const [settingsAuditExportHistoryHasMore, setSettingsAuditExportHistoryHasMore] = useState(false);
  const [settingsAuditExportHistoryLoading, setSettingsAuditExportHistoryLoading] = useState(false);
  const [settingsAuditExportHistoryLoadingMore, setSettingsAuditExportHistoryLoadingMore] = useState(false);
  const [settingsAuditMeta, setSettingsAuditMeta] = useState<SettingsAuditMeta>(defaultSettingsAuditMeta);
  const [settingsAuditFilters, setSettingsAuditFilters] = useState<SettingsAuditFilterState>(
    buildEmptySettingsAuditFilters(defaultSettingsAuditMeta),
  );
  const [purgeForm, setPurgeForm] = useState<PurgeFormState>({
    targetUserId: '',
    password: '',
    modules: ['all'],
  });
  const [pwd, setPwd] = useState<PasswordFormState>({ oldPassword: '', newPassword: '', confirmPassword: '' });

  const updateConfigField = (key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const updateUserPreferenceField = <K extends UserImageCompressionPreferenceField>(
    key: K,
    value: UserImageCompressionPreferenceFieldValue<K>,
  ) => {
    setUserPreferences((prev) => {
      switch (key) {
        case 'imageCompressionEnabled':
          return {
            ...prev,
            imageCompressionEnabled: value as UserImageCompressionPreferenceDraft['imageCompressionEnabled'],
          };
        case 'imageCompressionQualityFloor':
          return {
            ...prev,
            imageCompressionQualityFloor: value as UserImageCompressionPreferenceDraft['imageCompressionQualityFloor'],
          };
        case 'ocrTargetMaxKb':
          return {
            ...prev,
            ocrTargetMaxKb: value as UserImageCompressionPreferenceDraft['ocrTargetMaxKb'],
          };
        default:
          return assertNever(key);
      }
    });
  };

  const updateDashboardLayoutPreference = (dashboardLayout: DashboardLayoutPreference) => {
    setUserPreferences((prev) => ({ ...prev, dashboardLayout }));
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

  return {
    loading,
    setLoading,
    savingConfig,
    setSavingConfig,
    userPreferencesLoading,
    setUserPreferencesLoading,
    savingUserPreferences,
    setSavingUserPreferences,
    testingConfig,
    setTestingConfig,
    passwordLoading,
    setPasswordLoading,
    message,
    setMessage,
    error,
    setError,
    config,
    setConfig,
    userPreferences,
    setUserPreferences,
    canEditConfig,
    setCanEditConfig,
    canViewAudit,
    setCanViewAudit,
    canPurgeBranch,
    setCanPurgeBranch,
    branchPurgeTargets,
    setBranchPurgeTargets,
    purgeModuleKeys,
    setPurgeModuleKeys,
    purgingBranch,
    setPurgingBranch,
    auditLoading,
    setAuditLoading,
    auditLoadingMore,
    setAuditLoadingMore,
    auditExporting,
    setAuditExporting,
    settingsAuditEntries,
    setSettingsAuditEntries,
    settingsAuditCursor,
    setSettingsAuditCursor,
    settingsAuditHasMore,
    setSettingsAuditHasMore,
    settingsAuditExportHistoryEntries,
    setSettingsAuditExportHistoryEntries,
    settingsAuditExportHistoryCursor,
    setSettingsAuditExportHistoryCursor,
    settingsAuditExportHistoryHasMore,
    setSettingsAuditExportHistoryHasMore,
    settingsAuditExportHistoryLoading,
    setSettingsAuditExportHistoryLoading,
    settingsAuditExportHistoryLoadingMore,
    setSettingsAuditExportHistoryLoadingMore,
    settingsAuditMeta,
    setSettingsAuditMeta,
    settingsAuditFilters,
    setSettingsAuditFilters,
    purgeForm,
    setPurgeForm,
    pwd,
    setPwd,
    updateConfigField,
    updateUserPreferenceField,
    updateDashboardLayoutPreference,
    togglePurgeModule,
    defaultSettingsAuditMeta,
  };
}
