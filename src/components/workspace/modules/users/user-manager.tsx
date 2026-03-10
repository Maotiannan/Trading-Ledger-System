'use client';

import React, { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { useUiText } from '@/components/workspace/shared';
import { UserPlus } from 'lucide-react';
import { CreateUserDialog, UserList } from './components';
import { useUserActions, useUserForms } from './hooks';

export function UserManager() {
  const tx = useUiText();
  const { users, setUsers, user } = useStore();
  const isAdmin = user?.role === 'ADMIN';
  const {
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
  } = useUserForms(user, users);
  const {
    loadUsers,
    loadParentOptions,
    handleCreate,
    handleResetPassword,
    handleDelete,
    handleChangeRole,
  } = useUserActions({
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
  });

  const isProtectedPrimaryAdmin = (target: { role: 'ADMIN' | 'SALES' | 'USER'; email: string; name: string | null; createdById?: string | null }) => {
    if (target.role !== 'ADMIN') return false;
    const email = (target.email || '').trim().toLowerCase();
    const name = (target.name || '').trim().toLowerCase();
    return email === 'admin@example.com' || (name === 'admin' && !target.createdById);
  };

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (!showCreate) return;
    void loadParentOptions(user?.role === 'SALES' ? 'USER' : newUser.role);
  }, [showCreate, newUser.role, user?.role, loadParentOptions]);

  const canManageTarget = (target: { id: string; level?: number }) => {
    if (!user) return false;
    if (target.id === user.id) return false;
    const targetLevel = typeof target.level === 'number' ? target.level : 4;
    return targetLevel > currentLevel;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">{tx('用户管理', 'User Management')}</h2>
        <Button onClick={openCreateDialog}>
          <UserPlus className="h-4 w-4 mr-2" />
          {tx('创建用户', 'Create User')}
        </Button>
      </div>

      <UserList
        users={users}
        isAdmin={isAdmin}
        usersById={usersById}
        tx={tx}
        canManageTarget={canManageTarget}
        isProtectedPrimaryAdmin={isProtectedPrimaryAdmin}
        onChangeRole={(userId, role) => { void handleChangeRole(userId, role); }}
        onResetPassword={(userId) => { void handleResetPassword(userId); }}
        onDelete={(userId) => { void handleDelete(userId); }}
      />

      <CreateUserDialog
        open={showCreate}
        newUser={newUser}
        creatableRoles={creatableRoles}
        parentOptions={parentOptions}
        loadingParents={loadingParents}
        tx={tx}
        onOpenChange={setShowCreate}
        onNewUserChange={setNewUser}
        onSubmit={() => { void handleCreate(); }}
      />
    </div>
  );
}
