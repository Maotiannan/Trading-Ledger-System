'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { useStore } from '@/lib/store';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useUiText } from '@/components/workspace/shared';
import { APP_VERSION } from '@/lib/app-version';
import {
  BranchPurgeCard,
  CollapsibleSettingsSection,
  CustomerAnalyticsSettingsCard,
  DashboardSettingsCard,
  ExcelTokenCard,
  PasswordSettingsCard,
  SettingsAuditCard,
  SystemConfigCard,
  UserImageCompressionCard,
} from './components';
import { useExcelTokenSettings, useSettingsActions, useSettingsForms } from './hooks';
import { UserManager } from '@/components/workspace/modules/users/user-manager';
import { buildSettingsPageViewModel } from './page-view-model';

export function SettingsManager() {
  const tx = useUiText();
  const didLoadAuditRef = useRef(false);
  const { user } = useStore();
  const excelTokenSettings = useExcelTokenSettings(tx);
  const {
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
  } = useSettingsForms();

  const {
    loadSettings,
    loadSettingsAudit,
    loadSettingsAuditExportHistory,
    applyAuditFilters,
    resetAuditFilters,
    handleSaveConfig,
    loadUserPreferences,
    handleSaveUserPreferences,
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
    userPreferences,
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
  });

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    void loadUserPreferences();
  }, [loadUserPreferences]);

  useEffect(() => {
    void excelTokenSettings.loadExcelTokens();
  }, [excelTokenSettings.loadExcelTokens]);

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

      <CollapsibleSettingsSection title={tx('修改密码', 'Change Password')} defaultOpen>
        <PasswordSettingsCard
          userEmail={user?.email}
          passwordLoading={passwordLoading}
          pwd={pwd}
          tx={tx}
          onPwdChange={setPwd}
          onSubmit={handleChangePassword}
        />
      </CollapsibleSettingsSection>

      <CollapsibleSettingsSection title={tx('Excel令牌', 'Excel Token')}>
        <ExcelTokenCard
          tokens={excelTokenSettings.excelTokens}
          oneTimeToken={excelTokenSettings.oneTimeExcelToken}
          loading={excelTokenSettings.excelTokenLoading}
          saving={excelTokenSettings.excelTokenSaving}
          message={excelTokenSettings.excelTokenMessage}
          error={excelTokenSettings.excelTokenError}
          tx={tx}
          onRefresh={() => { void excelTokenSettings.loadExcelTokens(); }}
          onGenerate={() => { void excelTokenSettings.generateExcelToken(); }}
          onRevoke={(tokenId) => { void excelTokenSettings.revokeExcelToken(tokenId); }}
        />
      </CollapsibleSettingsSection>

      <CollapsibleSettingsSection title={tx('图片压缩设置', 'Image Compression')}>
        <UserImageCompressionCard
          loading={userPreferencesLoading}
          saving={savingUserPreferences}
          preferences={userPreferences}
          tx={tx}
          onPreferenceFieldChange={updateUserPreferenceField}
          onSavePreferences={handleSaveUserPreferences}
        />
      </CollapsibleSettingsSection>

      <CollapsibleSettingsSection title={tx('Dashboard 设置', 'Dashboard Settings')}>
        <DashboardSettingsCard
          loading={userPreferencesLoading}
          saving={savingUserPreferences}
          layout={userPreferences.dashboardLayout}
          tx={tx}
          onLayoutChange={updateDashboardLayoutPreference}
          onSavePreferences={handleSaveUserPreferences}
        />
      </CollapsibleSettingsSection>

      {settingsPageView.canManageUsers && (
        <CollapsibleSettingsSection
          title={tx('用户管理', 'User Management')}
          description={tx('用户管理已并入设置模块。', 'User management has been moved into Settings.')}
        >
          <UserManager />
        </CollapsibleSettingsSection>
      )}

      <CollapsibleSettingsSection title={tx('分支清理', 'Branch Purge')}>
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
      </CollapsibleSettingsSection>

      <CollapsibleSettingsSection title={tx('客户分析设置', 'Customer Analytics Settings')}>
        <CustomerAnalyticsSettingsCard
          loading={loading}
          saving={savingConfig}
          canEdit={canEditConfig}
          config={config}
          tx={tx}
          onFieldChange={updateConfigField}
          onSave={handleSaveConfig}
        />
      </CollapsibleSettingsSection>

      <CollapsibleSettingsSection title={tx('系统配置', 'System Configuration')}>
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
      </CollapsibleSettingsSection>

      <CollapsibleSettingsSection title={tx('设置审计', 'Settings Audit')}>
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
      </CollapsibleSettingsSection>
    </div>
  );
}
