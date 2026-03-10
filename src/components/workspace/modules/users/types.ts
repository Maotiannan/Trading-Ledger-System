import type { UserRole } from '@/lib/store';

export type ManagedUserRole = 'USER' | 'SALES' | 'ADMIN';

export type NewUserForm = {
  email: string;
  password: string;
  name: string;
  role: ManagedUserRole;
  parentId: string;
};

export type ParentOption = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  level: number;
};
