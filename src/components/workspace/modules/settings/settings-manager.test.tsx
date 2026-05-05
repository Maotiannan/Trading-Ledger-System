import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsManager } from './settings-manager';
import { useStore } from '@/lib/store';
import { useUiText } from '@/components/workspace/shared';
import { useExcelTokenSettings, useSettingsActions, useSettingsForms } from './hooks';

jest.mock('@/lib/store', () => ({
  useStore: jest.fn(),
}));

jest.mock('@/components/workspace/shared', () => ({
  useUiText: jest.fn(),
}));

jest.mock('./hooks', () => ({
  useExcelTokenSettings: jest.fn(),
  useSettingsActions: jest.fn(),
  useSettingsForms: jest.fn(),
}));

jest.mock('@/components/workspace/modules/users/user-manager', () => ({
  UserManager: () => <div>UserManagerBody</div>,
}));

jest.mock('./components', () => {
  const actual = jest.requireActual('./components');
  return {
    ...actual,
    BranchPurgeCard: () => <div>BranchPurgeBody</div>,
    ExcelTokenCard: () => <div>ExcelTokenBody</div>,
    PasswordSettingsCard: () => <div>PasswordSettingsBody</div>,
    SettingsAuditCard: () => <div>SettingsAuditBody</div>,
    SystemConfigCard: () => <div>SystemConfigBody</div>,
    UserImageCompressionCard: () => <div>UserImageCompressionBody</div>,
  };
});

jest.mock('@/lib/app-version', () => ({
  APP_VERSION: '1.0.116',
}));

const mockUseStore = useStore as unknown as jest.Mock;
const mockUseUiText = useUiText as jest.Mock;
const mockUseExcelTokenSettings = useExcelTokenSettings as jest.Mock;
const mockUseSettingsActions = useSettingsActions as jest.Mock;
const mockUseSettingsForms = useSettingsForms as jest.Mock;

describe('SettingsManager', () => {
  beforeEach(() => {
    mockUseStore.mockReturnValue({ user: { email: 'admin@example.com', role: 'ADMIN' } });
    mockUseUiText.mockReturnValue((zh: string, en: string) => en);
    mockUseExcelTokenSettings.mockReturnValue({
      excelTokens: [],
      oneTimeExcelToken: null,
      excelTokenLoading: false,
      excelTokenSaving: false,
      excelTokenMessage: null,
      excelTokenError: null,
      loadExcelTokens: jest.fn(),
      generateExcelToken: jest.fn(),
      revokeExcelToken: jest.fn(),
    });
    mockUseSettingsForms.mockReturnValue({
      loading: false,
      setLoading: jest.fn(),
      savingConfig: false,
      setSavingConfig: jest.fn(),
      userPreferencesLoading: false,
      setUserPreferencesLoading: jest.fn(),
      savingUserPreferences: false,
      setSavingUserPreferences: jest.fn(),
      testingConfig: false,
      setTestingConfig: jest.fn(),
      passwordLoading: false,
      setPasswordLoading: jest.fn(),
      message: null,
      setMessage: jest.fn(),
      error: null,
      setError: jest.fn(),
      config: {},
      setConfig: jest.fn(),
      userPreferences: { imageCompressionEnabled: true, imageCompressionQualityFloor: 0.3, imageCompressionTargetMaxKb: 500 },
      setUserPreferences: jest.fn(),
      canEditConfig: true,
      setCanEditConfig: jest.fn(),
      canViewAudit: true,
      setCanViewAudit: jest.fn(),
      canPurgeBranch: true,
      setCanPurgeBranch: jest.fn(),
      branchPurgeTargets: [],
      setBranchPurgeTargets: jest.fn(),
      purgeModuleKeys: [],
      setPurgeModuleKeys: jest.fn(),
      purgingBranch: false,
      setPurgingBranch: jest.fn(),
      auditLoading: false,
      setAuditLoading: jest.fn(),
      auditLoadingMore: false,
      setAuditLoadingMore: jest.fn(),
      auditExporting: false,
      setAuditExporting: jest.fn(),
      settingsAuditEntries: [],
      setSettingsAuditEntries: jest.fn(),
      settingsAuditCursor: null,
      setSettingsAuditCursor: jest.fn(),
      settingsAuditHasMore: false,
      setSettingsAuditHasMore: jest.fn(),
      settingsAuditExportHistoryEntries: [],
      setSettingsAuditExportHistoryEntries: jest.fn(),
      settingsAuditExportHistoryCursor: null,
      setSettingsAuditExportHistoryCursor: jest.fn(),
      settingsAuditExportHistoryHasMore: false,
      setSettingsAuditExportHistoryHasMore: jest.fn(),
      settingsAuditExportHistoryLoading: false,
      setSettingsAuditExportHistoryLoading: jest.fn(),
      settingsAuditExportHistoryLoadingMore: false,
      setSettingsAuditExportHistoryLoadingMore: jest.fn(),
      settingsAuditMeta: { defaultPageSize: 20, maxPageSize: 100, maxExportRows: 5000, pageSizeOptions: [20, 50, 100], cursorMode: 'id' },
      setSettingsAuditMeta: jest.fn(),
      settingsAuditFilters: { actorQuery: '', settingKey: '', dateFrom: '', dateTo: '', pageSize: 20, exportLimit: 5000 },
      setSettingsAuditFilters: jest.fn(),
      purgeForm: { accountId: '', password: '', confirmText: '' },
      setPurgeForm: jest.fn(),
      pwd: { oldPassword: '', newPassword: '', confirmPassword: '' },
      setPwd: jest.fn(),
      updateConfigField: jest.fn(),
      updateUserPreferenceField: jest.fn(),
      togglePurgeModule: jest.fn(),
    });
    mockUseSettingsActions.mockReturnValue({
      loadSettings: jest.fn(),
      loadSettingsAudit: jest.fn(),
      loadSettingsAuditExportHistory: jest.fn(),
      applyAuditFilters: jest.fn(),
      resetAuditFilters: jest.fn(),
      handleSaveConfig: jest.fn(),
      loadUserPreferences: jest.fn(),
      handleSaveUserPreferences: jest.fn(),
      handleTestOcrConfig: jest.fn(),
      handleChangePassword: jest.fn(),
      handlePurgeBranch: jest.fn(),
      exportSettingsAudit: jest.fn(),
    });
  });

  it('renders collapsible sections and hides non-default bodies until expanded', () => {
    render(<SettingsManager />);

    expect(screen.getByText('PasswordSettingsBody')).toBeInTheDocument();
    expect(screen.queryByText('UserManagerBody')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /User Management/i }));

    expect(screen.getByText('UserManagerBody')).toBeInTheDocument();
  });
});
