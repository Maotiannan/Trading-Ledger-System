import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, validateUser, verifyPassword } from '@/lib/auth';
import { UserRole } from '@prisma/client';
import { getCurrentUser } from '@/lib/request-auth';
import { clearSessionCookie, createSessionToken, setSessionCookie } from '@/lib/session';

const roleRank: Record<UserRole, number> = {
  [UserRole.ADMIN]: 3,
  [UserRole.SALES]: 2,
  [UserRole.USER]: 1,
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
      const targetRole = currentUser.role === UserRole.SALES
        ? UserRole.USER
        : requestedRole;

      if (currentUser.role === UserRole.SALES && targetRole !== UserRole.USER) {
        return NextResponse.json({ success: false, error: '销售代表只能创建普通账户' }, { status: 403 });
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
          createdById: currentUser.id,
        },
        select: { id: true, email: true, name: true, role: true, createdAt: true, createdById: true }
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
        select: { id: true, email: true, name: true, role: true, createdById: true },
      });
      if (!target) {
        return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
      }
      if (isProtectedPrimaryAdmin(target)) {
        return NextResponse.json({ success: false, error: '唯一管理员Admin角色不可修改' }, { status: 400 });
      }

      const updated = await db.user.update({
        where: { id: userId },
        data: { role: newRole },
        select: { id: true, email: true, name: true, role: true, createdAt: true, createdById: true },
      });
      return NextResponse.json({ success: true, data: updated, message: '角色已更新' });
    }

    // 获取用户列表 (管理员/销售)
    if (action === 'list') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES)) {
        return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
      }

      const users = await db.user.findMany({
        where: currentUser.role === UserRole.ADMIN ? undefined : { createdById: currentUser.id },
        select: { id: true, email: true, name: true, role: true, createdAt: true, createdById: true },
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

      if (currentUser.role === UserRole.SALES) {
        const target = await db.user.findUnique({
          where: { id: userId },
          select: { createdById: true, role: true },
        });
        if (!target || target.createdById !== currentUser.id || target.role !== UserRole.USER) {
          return NextResponse.json({ success: false, error: '销售代表只能删除自己创建的普通用户' }, { status: 403 });
        }
      }

      await db.user.delete({ where: { id: userId } });
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

      if (currentUser.role === UserRole.SALES) {
        const target = await db.user.findUnique({
          where: { id: userId },
          select: { createdById: true, role: true },
        });
        if (!target || target.createdById !== currentUser.id || target.role !== UserRole.USER) {
          return NextResponse.json({ success: false, error: '销售代表只能重置自己创建的普通用户密码' }, { status: 403 });
        }
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
