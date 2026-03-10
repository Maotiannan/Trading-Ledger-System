'use client';

import React, { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useUiText } from '@/components/workspace/shared';
import { BranchPurgeCard, PasswordSettingsCard, SystemConfigCard } from './components';
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
    canPurgeBranch,
    setCanPurgeBranch,
    branchPurgeTargets,
    setBranchPurgeTargets,
    purgeModuleKeys,
    setPurgeModuleKeys,
    purgingBranch,
    setPurgingBranch,
    purgeForm,
    setPurgeForm,
    pwd,
    setPwd,
    updateConfigField,
    togglePurgeModule,
  } = useSettingsForms();

  const {
    loadSettings,
    handleSaveConfig,
    handleTestOcrConfig,
    handleChangePassword,
    handlePurgeBranch,
  } = useSettingsActions({
    tx,
    userEmail: user?.email,
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
  });

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

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
    </div>
  );
}
