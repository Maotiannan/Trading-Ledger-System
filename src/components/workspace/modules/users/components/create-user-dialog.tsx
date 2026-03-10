'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ManagedUserRole, NewUserForm, ParentOption } from '../types';

export type CreateUserDialogProps = {
  open: boolean;
  newUser: NewUserForm;
  creatableRoles: ManagedUserRole[];
  parentOptions: ParentOption[];
  loadingParents: boolean;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onNewUserChange: (updater: (prev: NewUserForm) => NewUserForm) => void;
  onSubmit: () => void;
};

export function CreateUserDialog({
  open,
  newUser,
  creatableRoles,
  parentOptions,
  loadingParents,
  tx,
  onOpenChange,
  onNewUserChange,
  onSubmit,
}: CreateUserDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tx('创建用户', 'Create User')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label>{tx('邮箱', 'Email')}</Label>
            <Input value={newUser.email} onChange={(e) => onNewUserChange((prev) => ({ ...prev, email: e.target.value }))} />
          </div>
          <div>
            <Label>{tx('姓名', 'Name')}</Label>
            <Input value={newUser.name} onChange={(e) => onNewUserChange((prev) => ({ ...prev, name: e.target.value }))} />
          </div>
          <div>
            <Label>{tx('密码', 'Password')}</Label>
            <Input type="password" value={newUser.password} onChange={(e) => onNewUserChange((prev) => ({ ...prev, password: e.target.value }))} />
          </div>
          <div>
            <Label>{tx('角色', 'Role')}</Label>
            <select
              className="w-full border rounded-md px-3 py-2 text-sm"
              value={newUser.role}
              onChange={(e) => onNewUserChange((prev) => ({ ...prev, role: e.target.value as ManagedUserRole }))}
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
              onChange={(e) => onNewUserChange((prev) => ({ ...prev, parentId: e.target.value }))}
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tx('取消', 'Cancel')}</Button>
          <Button onClick={onSubmit} disabled={!newUser.parentId}>{tx('创建', 'Create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
