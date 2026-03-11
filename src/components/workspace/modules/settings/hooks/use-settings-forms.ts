'use client';

import { useState } from 'react';
import type {
  BranchPurgeTarget,
  PasswordFormState,
  PurgeFormState,
  SettingsAuditEntry,
  SettingsAuditFilterState,
  SettingsAuditMeta,
} from '../types';

const emptySettingsAuditFilters: SettingsAuditFilterState = {
  actorQuery: '',
  settingKey: '',
  dateFrom: '',
  dateTo: '',
  pageSize: 20,
  exportLimit: 5000,
};

const defaultSettingsAuditMeta: SettingsAuditMeta = {
  defaultPageSize: 20,
  maxPageSize: 100,
  maxExportRows: 5000,
  pageSizeOptions: [20, 50, 100],
  cursorMode: 'id',
};

export function useSettingsForms() {
  const [loading, setLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingConfig, setTestingConfig] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, string>>({});
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
  const [settingsAuditMeta, setSettingsAuditMeta] = useState<SettingsAuditMeta>(defaultSettingsAuditMeta);
  const [settingsAuditFilters, setSettingsAuditFilters] = useState<SettingsAuditFilterState>(emptySettingsAuditFilters);
  const [purgeForm, setPurgeForm] = useState<PurgeFormState>({
    targetUserId: '',
    password: '',
    modules: ['all'],
  });
  const [pwd, setPwd] = useState<PasswordFormState>({ oldPassword: '', newPassword: '', confirmPassword: '' });

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

  return {
    loading,
    setLoading,
    savingConfig,
    setSavingConfig,
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
    settingsAuditMeta,
    setSettingsAuditMeta,
    settingsAuditFilters,
    setSettingsAuditFilters,
    purgeForm,
    setPurgeForm,
    pwd,
    setPwd,
    updateConfigField,
    togglePurgeModule,
    emptySettingsAuditFilters,
    defaultSettingsAuditMeta,
  };
}
