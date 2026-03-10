'use client';

import { useCallback, useMemo, useState } from 'react';
import type { User } from '@/lib/store';
import type { ManagedUserRole, NewUserForm, ParentOption } from '../types';

export function useUserForms(user: User | null, users: User[]) {
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState<NewUserForm>({ email: '', password: '', name: '', role: 'USER', parentId: '' });
  const [parentOptions, setParentOptions] = useState<ParentOption[]>([]);
  const [loadingParents, setLoadingParents] = useState(false);

  const currentLevel =
    typeof user?.level === 'number'
      ? user.level
      : user?.role === 'ADMIN'
        ? 1
        : user?.role === 'SALES'
          ? 3
          : 4;

  const creatableRoles: ManagedUserRole[] =
    user?.role === 'SALES'
      ? ['USER']
      : currentLevel === 1
        ? ['ADMIN', 'SALES', 'USER']
        : currentLevel === 2
          ? ['SALES', 'USER']
          : ['USER'];

  const usersById = useMemo(() => new Map(users.map((row) => [row.id, row])), [users]);

  const openCreateDialog = useCallback(() => {
    const defaultRole = creatableRoles[0] || 'USER';
    setNewUser({ email: '', password: '', name: '', role: defaultRole, parentId: user?.id || '' });
    setShowCreate(true);
  }, [creatableRoles, user?.id]);

  const closeCreateDialog = useCallback((open: boolean) => {
    setShowCreate(open);
  }, []);

  return {
    showCreate,
    setShowCreate,
    newUser,
    setNewUser,
    parentOptions,
    setParentOptions,
    loadingParents,
    setLoadingParents,
    currentLevel,
    creatableRoles,
    usersById,
    openCreateDialog,
    closeCreateDialog,
  };
}
