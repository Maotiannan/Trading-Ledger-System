import type {
  SettingsAuditEntry,
  SettingsAuditExportEntry,
  SettingsAuditFilterState,
  SettingsAuditMeta,
} from './types';
import { buildSettingsAuditViewModel, type SettingsAuditViewModel, type SettingsTx } from './view-model';

export type SettingsPageViewModel = {
  title: string;
  versionLabel: string;
  canManageUsers: boolean;
  alertMessage: string | null;
  alertVariant: 'default' | 'destructive';
  auditView: SettingsAuditViewModel;
};

export type BuildSettingsPageViewModelInput = {
  tx: SettingsTx;
  appVersion: string;
  userRole?: string | null;
  error?: string | null;
  message?: string | null;
  filters: SettingsAuditFilterState;
  meta: SettingsAuditMeta;
  keyOptions: string[];
  entries: SettingsAuditEntry[];
  exportHistoryEntries: SettingsAuditExportEntry[];
  hasMore: boolean;
  exportHistoryHasMore: boolean;
};

export function buildSettingsPageViewModel({
  tx,
  appVersion,
  userRole,
  error,
  message,
  filters,
  meta,
  keyOptions,
  entries,
  exportHistoryEntries,
  hasMore,
  exportHistoryHasMore,
}: BuildSettingsPageViewModelInput): SettingsPageViewModel {
  return {
    title: tx('设置', 'Settings'),
    versionLabel: appVersion,
    canManageUsers: userRole === 'ADMIN' || userRole === 'SALES',
    alertMessage: error || message || null,
    alertVariant: error ? 'destructive' : 'default',
    auditView: buildSettingsAuditViewModel({
      tx,
      filters,
      meta,
      keyOptions,
      entries,
      exportHistoryEntries,
      hasMore,
      exportHistoryHasMore,
    }),
  };
}
