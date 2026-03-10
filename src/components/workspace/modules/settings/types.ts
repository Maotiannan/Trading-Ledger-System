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
