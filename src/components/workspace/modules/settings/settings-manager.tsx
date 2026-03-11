'use client';

import React, { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useUiText } from '@/components/workspace/shared';
import { BranchPurgeCard, PasswordSettingsCard, SettingsAuditCard, SystemConfigCard } from './components';
import { useSettingsActions, useSettingsForms } from './hooks';
import { UserManager } from '@/components/workspace/modules/users/user-manager';

export function SettingsManager() {
  const tx = useUiText();
  const { user } = useStore();
  const canManageUsers = user?.role === 'ADMIN' || user?.role === 'SALES';
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
    auditFilters: settingsAuditFilters,
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
    setSettingsAuditFilters,
    setPurgeForm,
    setPwd,
  });

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!canViewAudit) return;
    void loadSettingsAudit();
  }, [canViewAudit, loadSettingsAudit]);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">{tx('设置', 'Settings')}</h2>
      {(error || message) && (
        <Alert variant={error ? 'destructive' : 'default'}>
          <AlertDescription>{error || message}</AlertDescription>
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
        hasMore={settingsAuditHasMore}
        entries={settingsAuditEntries}
        filters={settingsAuditFilters}
        keyOptions={Object.keys(config).sort()}
        onFilterChange={setSettingsAuditFilters}
        onApplyFilters={() => { void applyAuditFilters(); }}
        onResetFilters={() => { void resetAuditFilters(); }}
        onRefresh={() => { void loadSettingsAudit({ filters: settingsAuditFilters }); }}
        onLoadMore={() => { void loadSettingsAudit({ append: true, filters: settingsAuditFilters }); }}
        onExport={() => { void exportSettingsAudit(); }}
      />
    </div>
  );
}
