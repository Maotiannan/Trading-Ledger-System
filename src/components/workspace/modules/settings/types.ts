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
