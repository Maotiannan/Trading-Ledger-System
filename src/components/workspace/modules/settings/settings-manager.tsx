'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { useStore } from '@/lib/store';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useUiText } from '@/components/workspace/shared';
import { APP_VERSION } from '@/lib/app-version';
import { BranchPurgeCard, PasswordSettingsCard, SettingsAuditCard, SystemConfigCard } from './components';
import { useSettingsActions, useSettingsForms } from './hooks';
import { UserManager } from '@/components/workspace/modules/users/user-manager';
import { buildSettingsPageViewModel } from './page-view-model';

export function SettingsManager() {
  const tx = useUiText();
  const didLoadAuditRef = useRef(false);
  const { user } = useStore();
  const {
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
    togglePurgeModule,
  } = useSettingsForms();

  const {
    loadSettings,
    loadSettingsAudit,
    loadSettingsAuditExportHistory,
    applyAuditFilters,
    resetAuditFilters,
    handleSaveConfig,
    handleTestOcrConfig,
    handleChangePassword,
    handlePurgeBranch,
    exportSettingsAudit,
  } = useSettingsActions({
    tx,
    userEmail: user?.email,
    canEditConfig,
    canViewAudit,
    canPurgeBranch,
    config,
    branchPurgeTargets,
    purgeForm,
    pwd,
    auditCursor: settingsAuditCursor,
    auditExportHistoryCursor: settingsAuditExportHistoryCursor,
    auditFilters: settingsAuditFilters,
    auditMeta: settingsAuditMeta,
    setLoading,
    setSavingConfig,
    setTestingConfig,
    setPasswordLoading,
    setAuditLoading,
    setAuditLoadingMore,
    setAuditExporting,
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
    setSettingsAuditExportHistoryEntries,
    setSettingsAuditExportHistoryCursor,
    setSettingsAuditExportHistoryHasMore,
    setSettingsAuditExportHistoryLoading,
    setSettingsAuditExportHistoryLoadingMore,
    setSettingsAuditMeta,
    setSettingsAuditFilters,
    setPurgeForm,
    setPwd,
  });

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!canViewAudit) {
      didLoadAuditRef.current = false;
      return;
    }
    if (didLoadAuditRef.current) return;
    didLoadAuditRef.current = true;
    void loadSettingsAudit({ filters: settingsAuditFilters });
    void loadSettingsAuditExportHistory({ filters: settingsAuditFilters });
  }, [canViewAudit, loadSettingsAudit, loadSettingsAuditExportHistory, settingsAuditFilters]);

  const settingsPageView = useMemo(() => buildSettingsPageViewModel({
    tx,
    appVersion: APP_VERSION,
    userRole: user?.role,
    error,
    message,
    filters: settingsAuditFilters,
    meta: settingsAuditMeta,
    keyOptions: Object.keys(config),
    entries: settingsAuditEntries,
    exportHistoryEntries: settingsAuditExportHistoryEntries,
    hasMore: settingsAuditHasMore,
    exportHistoryHasMore: settingsAuditExportHistoryHasMore,
  }), [
    config,
    error,
    message,
    settingsAuditEntries,
    settingsAuditExportHistoryEntries,
    settingsAuditExportHistoryHasMore,
    settingsAuditFilters,
    settingsAuditHasMore,
    settingsAuditMeta,
    tx,
    user?.role,
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold">{settingsPageView.title}</h2>
        <p className="text-sm text-gray-500">
          {tx('当前版本', 'Current Version')}: <span className="font-mono">{settingsPageView.versionLabel}</span>
        </p>
      </div>
      {settingsPageView.alertMessage && (
        <Alert variant={settingsPageView.alertVariant}>
          <AlertDescription>{settingsPageView.alertMessage}</AlertDescription>
        </Alert>
      )}

      <PasswordSettingsCard
        userEmail={user?.email}
        passwordLoading={passwordLoading}
        pwd={pwd}
        tx={tx}
        onPwdChange={setPwd}
        onSubmit={handleChangePassword}
      />

      {settingsPageView.canManageUsers && (
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

      <BranchPurgeCard
        canPurgeBranch={canPurgeBranch}
        branchPurgeTargets={branchPurgeTargets}
        purgeModuleKeys={purgeModuleKeys}
        purgingBranch={purgingBranch}
        purgeForm={purgeForm}
        tx={tx}
        onPurgeFormChange={setPurgeForm}
        onTogglePurgeModule={togglePurgeModule}
        onSubmit={handlePurgeBranch}
      />

      <SystemConfigCard
        loading={loading}
        savingConfig={savingConfig}
        testingConfig={testingConfig}
        canEditConfig={canEditConfig}
        config={config}
        tx={tx}
        onConfigFieldChange={updateConfigField}
        onTestOcrConfig={handleTestOcrConfig}
        onSaveConfig={handleSaveConfig}
      />

      <SettingsAuditCard
        tx={tx}
        canViewAudit={canViewAudit}
        loading={auditLoading}
        loadingMore={auditLoadingMore}
        exporting={auditExporting}
        exportHistoryLoading={settingsAuditExportHistoryLoading}
        exportHistoryLoadingMore={settingsAuditExportHistoryLoadingMore}
        viewModel={settingsPageView.auditView}
        onFilterChange={setSettingsAuditFilters}
        onApplyFilters={() => { void applyAuditFilters(); }}
        onResetFilters={() => { void resetAuditFilters(); }}
        onRefresh={() => { void loadSettingsAudit({ filters: settingsAuditFilters }); }}
        onLoadMore={() => { void loadSettingsAudit({ append: true, filters: settingsAuditFilters }); }}
        onExport={() => { void exportSettingsAudit(); }}
        onRefreshExportHistory={() => { void loadSettingsAuditExportHistory({ filters: settingsAuditFilters }); }}
        onLoadMoreExportHistory={() => { void loadSettingsAuditExportHistory({ append: true, filters: settingsAuditFilters }); }}
      />
    </div>
  );
}
