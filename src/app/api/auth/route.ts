import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, validateUser, verifyPassword } from '@/lib/auth';
import { UserRole } from '@prisma/client';
import { getCurrentUser } from '@/lib/request-auth';
import { clearSessionCookie, createSessionToken, setSessionCookie } from '@/lib/session';
import { getHierarchyScope } from '@/lib/user-hierarchy';

const roleRank: Record<UserRole, number> = {
  [UserRole.ADMIN]: 4,
  [UserRole.SALES]: 3,
  [UserRole.USER]: 2,
};

const roleLevel: Record<UserRole, number> = {
  [UserRole.ADMIN]: 2,
  [UserRole.SALES]: 3,
  [UserRole.USER]: 4,
};

function parseRole(value: unknown): UserRole {
  if (value === UserRole.ADMIN || value === UserRole.SALES || value === UserRole.USER) {
    return value;
  }
  return UserRole.USER;
}

function isProtectedPrimaryAdmin(target: { role: UserRole; email: string; name: string | null; createdById: string | null }): boolean {
  if (target.role !== UserRole.ADMIN) return false;
  const email = (target.email || '').trim().toLowerCase();
  const name = (target.name || '').trim().toLowerCase();
  return email === 'admin@example.com' || (name === 'admin' && !target.createdById);
}

function canCreateRole(currentLevel: number, currentRole: UserRole, targetRole: UserRole): boolean {
  const targetLevel = roleLevel[targetRole];
  if (currentLevel >= 4 || currentRole === UserRole.USER) return false;
  if (targetLevel <= currentLevel) return false; // 不允许创建同级或上级
  if (currentLevel === 2 && targetRole === UserRole.ADMIN) return false; // 2级admin不能创建admin
  if (currentRole === UserRole.SALES && targetRole !== UserRole.USER) return false;
  return true;
}

// 登录
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, email, password, name, userId } = body;

    // 登录
    if (action === 'login') {
      if (!email || !password) {
        return NextResponse.json({ success: false, error: '邮箱和密码不能为空' }, { status: 400 });
      }

      const user = await validateUser(email, password);
      if (!user) {
        return NextResponse.json({ success: false, error: '邮箱或密码错误' }, { status: 401 });
      }

      const response = NextResponse.json({ success: true, data: user });
      const token = createSessionToken(user.id);
      setSessionCookie(response, token);
      return response;
    }

    if (action === 'logout') {
      const response = NextResponse.json({ success: true, message: '已退出登录' });
      clearSessionCookie(response);
      return response;
    }

    // 获取当前用户
    if (action === 'me') {
      const user = await getCurrentUser(request);
      if (!user) {
        return NextResponse.json({ success: false, error: '未登录' });
      }
      return NextResponse.json({ success: true, data: user });
    }

    // 创建用户 (管理员/销售)
    if (action === 'create') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES)) {
        return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
      }

      if (!email || !password) {
        return NextResponse.json({ success: false, error: '邮箱和密码不能为空' }, { status: 400 });
      }

      const requestedRole = parseRole(body.role);
      const targetRole = requestedRole;
      if (!canCreateRole(currentUser.level, currentUser.role, targetRole)) {
        return NextResponse.json({ success: false, error: '当前账户无权创建该角色' }, { status: 403 });
      }

      const targetLevel = roleLevel[targetRole];
      const requestedParentId = typeof body.parentId === 'string' && body.parentId.trim() ? body.parentId.trim() : currentUser.id;
      const scope = await getHierarchyScope(currentUser);
      const parent = await db.user.findUnique({
        where: { id: requestedParentId },
        select: { id: true, level: true, role: true },
      });
      if (!parent) {
        return NextResponse.json({ success: false, error: '指定上级不存在' }, { status: 400 });
      }

      const isVisibleParent = scope.visibleIds.has(parent.id) || parent.id === currentUser.id;
      if (!isVisibleParent) {
        return NextResponse.json({ success: false, error: '无权指定该上级账户' }, { status: 403 });
      }

      if (targetRole === UserRole.SALES) {
        if (parent.role !== UserRole.ADMIN || (parent.level !== 1 && parent.level !== 2)) {
          return NextResponse.json({ success: false, error: 'SALES 上级必须为 1/2 级 ADMIN' }, { status: 400 });
        }
      } else if (targetRole === UserRole.USER) {
        const parentAllowed = (parent.role === UserRole.SALES && parent.level === 3) ||
          (parent.role === UserRole.ADMIN && (parent.level === 1 || parent.level === 2));
        if (!parentAllowed) {
          return NextResponse.json({ success: false, error: 'USER 上级必须为 1/2 级 ADMIN 或 3 级 SALES' }, { status: 400 });
        }
      } else if (targetRole === UserRole.ADMIN) {
        if (parent.level !== 1 || parent.role !== UserRole.ADMIN) {
          return NextResponse.json({ success: false, error: '2级 ADMIN 只能由 1级 ADMIN 创建' }, { status: 400 });
        }
      }

      const existing = await db.user.findUnique({ where: { email } });
      if (existing) {
        return NextResponse.json({ success: false, error: '邮箱已存在' }, { status: 400 });
      }

      const hashedPassword = await hashPassword(password);
      const newUser = await db.user.create({
        data: {
          email,
          password: hashedPassword,
          name: name || null,
          role: targetRole,
          level: targetLevel,
          parentId: parent.id,
          createdById: currentUser.id,
        },
        select: { id: true, email: true, name: true, role: true, level: true, parentId: true, createdAt: true, createdById: true }
      });

      return NextResponse.json({ success: true, data: newUser });
    }

    // 更新用户角色（仅管理员）
    if (action === 'update-role') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || currentUser.role !== UserRole.ADMIN) {
        return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
      }

      if (!userId) {
        return NextResponse.json({ success: false, error: '用户ID不能为空' }, { status: 400 });
      }
      const newRole = parseRole(body.role);
      if (roleRank[newRole] > roleRank[currentUser.role]) {
        return NextResponse.json({ success: false, error: '不能设置高于自己的角色' }, { status: 400 });
      }

      const target = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, role: true, level: true, createdById: true },
      });
      if (!target) {
        return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
      }
      const scope = await getHierarchyScope(currentUser);
      if (!scope.descendantIds.has(target.id)) {
        return NextResponse.json({ success: false, error: '只能管理下级用户' }, { status: 403 });
      }
      if (target.level === currentUser.level) {
        return NextResponse.json({ success: false, error: '同级用户不可管理' }, { status: 403 });
      }
      if (isProtectedPrimaryAdmin(target)) {
        return NextResponse.json({ success: false, error: '唯一管理员Admin角色不可修改' }, { status: 400 });
      }
      if (!canCreateRole(currentUser.level, currentUser.role, newRole)) {
        return NextResponse.json({ success: false, error: '当前账户无权设置该角色' }, { status: 403 });
      }

      const updated = await db.user.update({
        where: { id: userId },
        data: { role: newRole, level: roleLevel[newRole] },
        select: { id: true, email: true, name: true, role: true, level: true, parentId: true, createdAt: true, createdById: true },
      });
      return NextResponse.json({ success: true, data: updated, message: '角色已更新' });
    }

    // 创建用户时可选的上级列表
    if (action === 'parent-options') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES)) {
        return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
      }

      const targetRole = parseRole(body.role);
      if (!canCreateRole(currentUser.level, currentUser.role, targetRole)) {
        return NextResponse.json({ success: false, error: '当前账户无权创建该角色' }, { status: 403 });
      }

      const scope = await getHierarchyScope(currentUser);
      const visibleIds = Array.from(scope.visibleIds);
      const candidates = await db.user.findMany({
        where: { id: { in: visibleIds } },
        select: { id: true, email: true, name: true, role: true, level: true },
        orderBy: [{ level: 'asc' }, { createdAt: 'asc' }],
      });

      const filtered = candidates.filter((candidate) => {
        if (targetRole === UserRole.ADMIN) {
          return candidate.role === UserRole.ADMIN && candidate.level === 1;
        }
        if (targetRole === UserRole.SALES) {
          return candidate.role === UserRole.ADMIN && (candidate.level === 1 || candidate.level === 2);
        }
        return (
          (candidate.role === UserRole.ADMIN && (candidate.level === 1 || candidate.level === 2)) ||
          (candidate.role === UserRole.SALES && candidate.level === 3)
        );
      });

      return NextResponse.json({ success: true, data: filtered });
    }

    // 获取用户列表 (管理员/销售)
    if (action === 'list') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES)) {
        return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
      }

      const scope = await getHierarchyScope(currentUser);

      const users = await db.user.findMany({
        where: {
          OR: [
            { id: { in: Array.from(scope.visibleIds) } },
            { level: currentUser.level },
          ],
        },
        select: { id: true, email: true, name: true, role: true, level: true, parentId: true, createdAt: true, createdById: true },
        orderBy: { createdAt: 'desc' }
      });

      return NextResponse.json({ success: true, data: users });
    }

    // 删除用户 (管理员/销售)
    if (action === 'delete') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES)) {
        return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
      }

      if (!userId) {
        return NextResponse.json({ success: false, error: '用户ID不能为空' }, { status: 400 });
      }

      if (userId === currentUser.id) {
        return NextResponse.json({ success: false, error: '不能删除自己' }, { status: 400 });
      }

      const target = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, level: true },
      });
      if (!target) {
        return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
      }
      const scope = await getHierarchyScope(currentUser);
      if (!scope.descendantIds.has(target.id) || target.level <= currentUser.level) {
        return NextResponse.json({ success: false, error: '仅可删除下级用户' }, { status: 403 });
      }

      await db.$transaction(async (tx) => {
        // Reassign creator ownership to current operator before deleting user
        // to avoid foreign key violations on createdBy fields.
        await tx.invoice.updateMany({ where: { createdBy: userId }, data: { createdBy: currentUser.id } });
        await tx.order.updateMany({ where: { createdBy: userId }, data: { createdBy: currentUser.id } });
        await tx.receipt.updateMany({ where: { createdBy: userId }, data: { createdBy: currentUser.id } });
        await tx.receiptHistory.updateMany({ where: { createdBy: userId }, data: { createdBy: currentUser.id } });
        await tx.detail.updateMany({ where: { createdBy: userId }, data: { createdBy: currentUser.id } });
        await tx.detailHistory.updateMany({ where: { createdBy: userId }, data: { createdBy: currentUser.id } });
        await tx.swift.updateMany({ where: { createdBy: userId }, data: { createdBy: currentUser.id } });
        await tx.customer.updateMany({ where: { createdBy: userId }, data: { createdBy: currentUser.id } });
        await tx.deletionRequest.updateMany({ where: { requestedBy: userId }, data: { requestedBy: currentUser.id } });
        await tx.auditLog.updateMany({ where: { actorId: userId }, data: { actorId: currentUser.id } });
        await tx.user.delete({ where: { id: userId } });
      });
      return NextResponse.json({ success: true, message: '用户已删除' });
    }

    // 重置密码 (管理员/销售)
    if (action === 'reset-password') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES)) {
        return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
      }

      if (!userId || !password) {
        return NextResponse.json({ success: false, error: '用户ID和新密码不能为空' }, { status: 400 });
      }
      const target = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, level: true },
      });
      if (!target) {
        return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
      }
      const scope = await getHierarchyScope(currentUser);
      if (!scope.descendantIds.has(target.id) || target.level <= currentUser.level) {
        return NextResponse.json({ success: false, error: '仅可重置下级用户密码' }, { status: 403 });
      }

      const hashedPassword = await hashPassword(password);
      await db.user.update({
        where: { id: userId },
        data: { password: hashedPassword }
      });

      return NextResponse.json({ success: true, message: '密码已重置' });
    }

    // 修改自己密码
    if (action === 'change-password') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser) {
        return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
      }

      const oldPassword = typeof body.oldPassword === 'string' ? body.oldPassword : '';
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

      if (!oldPassword || !newPassword) {
        return NextResponse.json({ success: false, error: '旧密码和新密码不能为空' }, { status: 400 });
      }
      if (newPassword.length < 8) {
        return NextResponse.json({ success: false, error: '新密码至少8位' }, { status: 400 });
      }

      const userWithPassword = await db.user.findUnique({
        where: { id: currentUser.id },
        select: { id: true, password: true },
      });
      if (!userWithPassword) {
        return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
      }

      const oldValid = await verifyPassword(oldPassword, userWithPassword.password);
      if (!oldValid) {
        return NextResponse.json({ success: false, error: '旧密码错误' }, { status: 400 });
      }

      const hashedPassword = await hashPassword(newPassword);
      await db.user.update({
        where: { id: currentUser.id },
        data: { password: hashedPassword },
      });
      return NextResponse.json({ success: true, message: '密码修改成功' });
    }

    return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
  } catch (error) {
    console.error('Auth API error:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
