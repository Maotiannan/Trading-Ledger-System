'use client';

import { useCallback } from 'react';
import { apiCall, getApiErrorMessage, getErrorMessage } from '@/components/workspace/shared';
import type { User } from '@/lib/store';
import type { ManagedUserRole, NewUserForm, ParentOption } from '../types';

export function useUserActions({
  tx,
  user,
  showCreate,
  newUser,
  creatableRoles,
  setUsers,
  setShowCreate,
  setNewUser,
  setParentOptions,
  setLoadingParents,
}: {
  tx: (zh: string, en: string) => string;
  user: User | null;
  showCreate: boolean;
  newUser: NewUserForm;
  creatableRoles: ManagedUserRole[];
  setUsers: (users: User[]) => void;
  setShowCreate: (open: boolean) => void;
  setNewUser: React.Dispatch<React.SetStateAction<NewUserForm>>;
  setParentOptions: (options: ParentOption[]) => void;
  setLoadingParents: (loading: boolean) => void;
}) {
  const loadUsers = useCallback(async () => {
    try {
      const result = await apiCall('auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'list' }),
      });
      if (result.success) {
        setUsers(result.data);
      }
    } catch {
      setUsers([]);
    }
  }, [setUsers]);

  const loadParentOptions = useCallback(async (role: ManagedUserRole) => {
    if (!showCreate) return;
    setLoadingParents(true);
    try {
      const result = await apiCall('auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'parent-options', role }),
      });
      if (!result.success || !Array.isArray(result.data)) {
        setParentOptions([]);
        return;
      }
      const options = result.data as ParentOption[];
      setParentOptions(options);
      const defaultParentId =
        options.some((option) => option.id === user?.id)
          ? user?.id || ''
          : options[0]?.id || '';
      setNewUser((prev) => ({ ...prev, parentId: defaultParentId }));
    } catch {
      setParentOptions([]);
    } finally {
      setLoadingParents(false);
    }
  }, [setLoadingParents, setNewUser, setParentOptions, showCreate, user?.id]);

  const handleCreate = useCallback(async () => {
    const targetRole = user?.role === 'SALES' ? 'USER' : newUser.role;
    try {
      const result = await apiCall('auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', ...newUser, role: targetRole, parentId: newUser.parentId || undefined }),
      });
      if (result.success) {
        setShowCreate(false);
        setNewUser({ email: '', password: '', name: '', role: creatableRoles[0] || 'USER', parentId: '' });
        setParentOptions([]);
        await loadUsers();
      }
    } catch (error) {
      alert(getApiErrorMessage(error, tx('创建失败', 'Create failed')));
    }
  }, [creatableRoles, loadUsers, newUser, setNewUser, setParentOptions, setShowCreate, user?.role]);

  const handleResetPassword = useCallback(async (userId: string) => {
    const password = window.prompt(tx('请输入新密码（至少8位）', 'Please enter a new password (at least 8 characters).'));
    if (!password) return;
    const result = await apiCall('auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'reset-password', userId, password }),
    });
    if (!result.success) {
      alert(getErrorMessage(result, tx('重置失败', 'Reset failed')));
    } else {
      alert(tx('密码已重置', 'Password has been reset.'));
    }
  }, [tx]);

  const handleDelete = useCallback(async (userId: string) => {
    if (confirm(tx('确定要删除此用户吗？', 'Delete this user?'))) {
      try {
        await apiCall('auth', {
          method: 'POST',
          body: JSON.stringify({ action: 'delete', userId }),
        });
        await loadUsers();
      } catch (error) {
        alert(getApiErrorMessage(error, tx('删除失败', 'Delete failed')));
      }
    }
  }, [loadUsers, tx]);

  const handleChangeRole = useCallback(async (userId: string, role: ManagedUserRole) => {
    const result = await apiCall('auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'update-role', userId, role }),
    });
    if (!result.success) {
      alert(getErrorMessage(result, tx('角色更新失败', 'Failed to update role')));
      return;
    }
    await loadUsers();
  }, [loadUsers, tx]);

  return {
    loadUsers,
    loadParentOptions,
    handleCreate,
    handleResetPassword,
    handleDelete,
    handleChangeRole,
  };
}
