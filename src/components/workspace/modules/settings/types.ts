import type { DashboardLayoutPreference } from '@/lib/dashboard-layout-preference';
import type { UserListPageSizePreference } from '@/lib/list-page-size-preference';

export type BranchPurgeTarget = {
  id: string;
  email: string;
  name: string | null;
  level: number;
  role: string;
  parentId: string | null;
};

export type PurgeFormState = {
  targetUserId: string;
  password: string;
  modules: string[];
};

export type PasswordFormState = {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export const USER_IMAGE_COMPRESSION_LIMITS = Object.freeze({
  qualityFloor: {
    min: 0.3,
    max: 1,
    step: 0.01,
  },
  ocrTargetMaxKb: {
    min: 50,
    max: 10_000,
    step: 1,
  },
});

export type UserImageCompressionPreference = {
  imageCompressionEnabled: boolean;
  imageCompressionQualityFloor: number;
  ocrTargetMaxKb: number;
};

export type UserPreferenceSettings = UserImageCompressionPreference & {
  dashboardLayout: DashboardLayoutPreference;
  listPageSizes: UserListPageSizePreference;
};

export type UserImageCompressionPreferenceDraft = {
  imageCompressionEnabled: boolean;
  imageCompressionQualityFloor: string;
  ocrTargetMaxKb: string;
};

export type UserPreferenceSettingsDraft = UserImageCompressionPreferenceDraft & {
  dashboardLayout: DashboardLayoutPreference;
  listPageSizes: UserListPageSizePreference;
};

export type UserImageCompressionPreferenceFieldValueMap = {
  imageCompressionEnabled: boolean;
  imageCompressionQualityFloor: string;
  ocrTargetMaxKb: string;
};

export type UserImageCompressionPreferenceField = keyof UserImageCompressionPreferenceFieldValueMap;

export type UserImageCompressionPreferenceFieldValue<
  K extends UserImageCompressionPreferenceField = UserImageCompressionPreferenceField,
> = UserImageCompressionPreferenceFieldValueMap[K];

export const defaultUserImageCompressionPreference: UserImageCompressionPreference = Object.freeze({
  imageCompressionEnabled: true,
  imageCompressionQualityFloor: 0.3,
  ocrTargetMaxKb: 500,
});

export const defaultUserImageCompressionPreferenceDraft: UserImageCompressionPreferenceDraft = Object.freeze({
  imageCompressionEnabled: defaultUserImageCompressionPreference.imageCompressionEnabled,
  imageCompressionQualityFloor: String(defaultUserImageCompressionPreference.imageCompressionQualityFloor),
  ocrTargetMaxKb: String(defaultUserImageCompressionPreference.ocrTargetMaxKb),
});

export type ExcelApiTokenSummary = {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  lastUsedAt: string | Date | null;
  lastUsedIp: string | null;
  revokedAt: string | Date | null;
  expiresAt: string | Date | null;
};

export type SettingsAuditChange = {
  key: string;
  before: string;
  after: string;
};

export type SettingsAuditEntry = {
  id: string;
  createdAt: string;
  actor: {
    id: string;
    email: string;
    name: string | null;
  } | null;
  updatedKeys: string[];
  changes: SettingsAuditChange[];
};

export type SettingsAuditExportEntry = {
  id: string;
  createdAt: string;
  actor: {
    id: string;
    email: string;
    name: string | null;
  } | null;
  rowCount: number;
  exportLimit: number;
  maxExportRows: number;
  truncated: boolean;
  filterActor: string;
  filterKey: string;
  filterDateFrom: string;
  filterDateTo: string;
  exportedKeys: string[];
};

export type SettingsAuditMeta = {
  defaultPageSize: number;
  maxPageSize: number;
  maxExportRows: number;
  pageSizeOptions: number[];
  cursorMode: 'id';
};

export type SettingsAuditFilterState = {
  actorQuery: string;
  settingKey: string;
  dateFrom: string;
  dateTo: string;
  pageSize: number;
  exportLimit: number;
};
