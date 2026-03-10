'use client';

import type { User } from '@/lib/store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Key, Trash2 } from 'lucide-react';

export type UserListProps = {
  users: User[];
  isAdmin: boolean;
  usersById: Map<string, User>;
  tx: (zh: string, en: string) => string;
  canManageTarget: (target: { id: string; level?: number }) => boolean;
  isProtectedPrimaryAdmin: (target: { role: 'ADMIN' | 'SALES' | 'USER'; email: string; name: string | null; createdById?: string | null }) => boolean;
  onChangeRole: (userId: string, role: 'USER' | 'SALES' | 'ADMIN') => void;
  onResetPassword: (userId: string) => void;
  onDelete: (userId: string) => void;
};

export function UserList({
  users,
  isAdmin,
  usersById,
  tx,
  canManageTarget,
  isProtectedPrimaryAdmin,
  onChangeRole,
  onResetPassword,
  onDelete,
}: UserListProps) {
  return (
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
                      onChange={(e) => onChangeRole(row.id, e.target.value as 'USER' | 'SALES' | 'ADMIN')}
                    >
                      <option value="ADMIN">ADMIN</option>
                      <option value="SALES">SALES</option>
                      <option value="USER">USER</option>
                    </select>
                  ) : (
                    <Badge variant={row.role === 'ADMIN' ? 'default' : row.role === 'SALES' ? 'outline' : 'secondary'}>
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
                  <Button size="sm" variant="ghost" onClick={() => onResetPassword(row.id)} title={tx('重置密码', 'Reset password')} disabled={!canManageTarget(row)}>
                    <Key className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDelete(row.id)} disabled={!canManageTarget(row)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
