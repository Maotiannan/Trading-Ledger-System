'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useStore } from '@/lib/store';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  CustomerCandidate,
  IMPORT_RESULT_PAGE_SIZE,
  apiCall,
  fetchCustomerCandidatesByMark,
  fetchServerDate,
  getDisplayImageUrl,
  getErrorMessage,
  initCustomerImportRowViews,
  initInvoiceImportRowViews,
  lookupCustomerByOrderNoGroup,
  mergeCustomerImportRowViews,
  mergeInvoiceImportRowViews,
  summarizeRowsForAlert,
  toCustomerImportRowResults,
  toCustomerImportRowResultsFromIssues,
  toDateInputValue,
  toInvoiceImportRowResults,
  toInvoiceImportRowResultsFromIssues,
  useUiText,
  type CustomerImportIssueRow,
  type CustomerImportRowResult,
  type CustomerImportRowView,
  type InvoiceImportIssueRow,
  type InvoiceImportRowResult,
  type InvoiceImportRowView,
} from '@/components/workspace/shared';
import {
  Loader2, LogIn, LogOut, Users, FileText, Receipt, FileSpreadsheet,
  Building2, Trash2, Plus, Upload, Check, X, AlertTriangle, Eye,
  History, ArrowRight, RefreshCw, UserPlus, Key, LayoutDashboard, Settings, Save,
  ChevronDown, ChevronRight, Pencil
} from 'lucide-react';

export function UserManager() {
  const tx = useUiText();
  const { users, setUsers, user } = useStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', name: '', role: 'USER' as 'USER' | 'ADMIN' | 'SALES', parentId: '' });
  const [parentOptions, setParentOptions] = useState<Array<{ id: string; email: string; name: string | null; role: 'ADMIN' | 'SALES' | 'USER'; level: number }>>([]);
  const [loadingParents, setLoadingParents] = useState(false);
  const isAdmin = user?.role === 'ADMIN';
  const currentLevel =
    typeof user?.level === 'number'
      ? user.level
      : user?.role === 'ADMIN'
        ? 1
        : user?.role === 'SALES'
          ? 3
          : 4;
  const creatableRoles: Array<'USER' | 'SALES' | 'ADMIN'> =
    user?.role === 'SALES'
      ? ['USER']
      : currentLevel === 1
        ? ['ADMIN', 'SALES', 'USER']
        : currentLevel === 2
          ? ['SALES', 'USER']
          : ['USER'];
  const usersById = useMemo(() => new Map(users.map((row) => [row.id, row])), [users]);

  const isProtectedPrimaryAdmin = (target: { role: 'ADMIN' | 'SALES' | 'USER'; email: string; name: string | null; createdById?: string | null }) => {
    if (target.role !== 'ADMIN') return false;
    const email = (target.email || '').trim().toLowerCase();
    const name = (target.name || '').trim().toLowerCase();
    return email === 'admin@example.com' || (name === 'admin' && !target.createdById);
  };

  const loadUsers = useCallback(async () => {
    const result = await apiCall('auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'list' }),
    });
    if (result.success) {
      setUsers(result.data);
    }
  }, [setUsers]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const loadParentOptions = useCallback(async (role: 'USER' | 'SALES' | 'ADMIN') => {
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
      const options = result.data as Array<{ id: string; email: string; name: string | null; role: 'ADMIN' | 'SALES' | 'USER'; level: number }>;
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
  }, [showCreate, user?.id]);

  useEffect(() => {
    if (!creatableRoles.includes(newUser.role)) {
      setNewUser((prev) => ({ ...prev, role: creatableRoles[0] || 'USER' }));
    }
  }, [creatableRoles, newUser.role]);

  useEffect(() => {
    if (!showCreate) return;
    void loadParentOptions(user?.role === 'SALES' ? 'USER' : newUser.role);
  }, [showCreate, newUser.role, user?.role, loadParentOptions]);

  const handleCreate = async () => {
    const targetRole = user?.role === 'SALES' ? 'USER' : newUser.role;
    const result = await apiCall('auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', ...newUser, role: targetRole, parentId: newUser.parentId || undefined }),
    });
    if (result.success) {
      setShowCreate(false);
      setNewUser({ email: '', password: '', name: '', role: creatableRoles[0] || 'USER', parentId: '' });
      setParentOptions([]);
      loadUsers();
    }
  };

  const handleResetPassword = async (userId: string) => {
    const password = window.prompt(tx('请输入新密码（至少8位）', 'Please enter a new password (at least 8 characters).'));
    if (!password) return;
    const result = await apiCall('auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'reset-password', userId, password }),
    });
    if (!result.success) {
      alert(result.error || tx('重置失败', 'Reset failed'));
    } else {
      alert(tx('密码已重置', 'Password has been reset.'));
    }
  };

  const handleDelete = async (userId: string) => {
    if (confirm(tx('确定要删除此用户吗？', 'Delete this user?'))) {
      await apiCall('auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete', userId }),
      });
      loadUsers();
    }
  };

  const handleChangeRole = async (userId: string, role: 'USER' | 'SALES' | 'ADMIN') => {
    const result = await apiCall('auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'update-role', userId, role }),
    });
    if (!result.success) {
      alert(result.error || tx('角色更新失败', 'Failed to update role'));
      return;
    }
    loadUsers();
  };

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
        <Button onClick={() => {
          const defaultRole = creatableRoles[0] || 'USER';
          setNewUser({ email: '', password: '', name: '', role: defaultRole, parentId: user?.id || '' });
          setShowCreate(true);
        }}>
          <UserPlus className="h-4 w-4 mr-2" />
          {tx('创建用户', 'Create User')}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tx('邮箱', 'Email')}</TableHead>
                <TableHead>{tx('姓名', 'Name')}</TableHead>
                <TableHead>{tx('角色', 'Role')}</TableHead>
                <TableHead>{tx('层级', 'Level')}</TableHead>
                <TableHead>{tx('上级', 'Parent')}</TableHead>
                <TableHead>{tx('创建时间', 'Created At')}</TableHead>
                <TableHead>{tx('操作', 'Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.email}</TableCell>
                  <TableCell>{row.name || '-'}</TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <select
                        className="border rounded-md px-2 py-1 text-sm"
                        value={row.role}
                        disabled={isProtectedPrimaryAdmin(row) || !canManageTarget(row)}
                        onChange={(e) => {
                          void handleChangeRole(row.id, e.target.value as 'USER' | 'SALES' | 'ADMIN');
                        }}
                      >
                        <option value="ADMIN">ADMIN</option>
                        <option value="SALES">SALES</option>
                        <option value="USER">USER</option>
                      </select>
                    ) : (
                      <Badge variant={row.role === 'ADMIN' ? 'default' : (row.role === 'SALES' ? 'outline' : 'secondary')}>
                        {row.role === 'ADMIN' ? tx('管理员', 'Admin') : row.role === 'SALES' ? tx('销售代表', 'Sales') : tx('用户', 'User')}
                      </Badge>
                    )}
                    {isAdmin && isProtectedPrimaryAdmin(row) && (
                      <div className="text-xs text-gray-500 mt-1">{tx('唯一管理员不可修改', 'Primary admin role cannot be changed')}</div>
                    )}
                  </TableCell>
                  <TableCell>{row.level ?? '-'}</TableCell>
                  <TableCell>{row.parentId ? (usersById.get(row.parentId)?.email || row.parentId) : '-'}</TableCell>
                  <TableCell>{row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '-'}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => handleResetPassword(row.id)} title={tx('重置密码', 'Reset password')} disabled={!canManageTarget(row)}>
                      <Key className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(row.id)} disabled={!canManageTarget(row)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tx('创建用户', 'Create User')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>{tx('邮箱', 'Email')}</Label>
              <Input 
                value={newUser.email} 
                onChange={(e) => setNewUser({...newUser, email: e.target.value})}
              />
            </div>
            <div>
              <Label>{tx('姓名', 'Name')}</Label>
              <Input 
                value={newUser.name} 
                onChange={(e) => setNewUser({...newUser, name: e.target.value})}
              />
            </div>
            <div>
              <Label>{tx('密码', 'Password')}</Label>
              <Input 
                type="password"
                value={newUser.password} 
                onChange={(e) => setNewUser({...newUser, password: e.target.value})}
              />
            </div>
            <div>
              <Label>{tx('角色', 'Role')}</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value as 'USER' | 'ADMIN' | 'SALES' })}
              >
                {creatableRoles.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>{tx('上级账户', 'Parent Account')}</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={newUser.parentId}
                onChange={(e) => setNewUser({ ...newUser, parentId: e.target.value })}
                disabled={loadingParents}
              >
                {parentOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {`${option.email} (${option.role}-L${option.level})`}
                  </option>
                ))}
              </select>
            </div>
            {parentOptions.length === 0 && (
              <div>
                <p className="text-xs text-red-500">{tx('当前角色下无可用上级，请先检查层级关系', 'No available parent for this role. Please verify hierarchy.')}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{tx('取消', 'Cancel')}</Button>
            <Button onClick={handleCreate} disabled={!newUser.parentId}>{tx('创建', 'Create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
