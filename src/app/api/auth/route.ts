import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, validateUser, verifyPassword } from '@/lib/auth';
import { UserRole } from '@prisma/client';
import { getCurrentUser } from '@/lib/request-auth';
import { clearSessionCookie, createSessionToken, setSessionCookie } from '@/lib/session';

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

    // 创建用户 (管理员)
    if (action === 'create') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || currentUser.role !== UserRole.ADMIN) {
        return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
      }

      if (!email || !password) {
        return NextResponse.json({ success: false, error: '邮箱和密码不能为空' }, { status: 400 });
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
          role: UserRole.USER
        },
        select: { id: true, email: true, name: true, role: true, createdAt: true }
      });

      return NextResponse.json({ success: true, data: newUser });
    }

    // 获取用户列表 (管理员)
    if (action === 'list') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || currentUser.role !== UserRole.ADMIN) {
        return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
      }

      const users = await db.user.findMany({
        select: { id: true, email: true, name: true, role: true, createdAt: true },
        orderBy: { createdAt: 'desc' }
      });

      return NextResponse.json({ success: true, data: users });
    }

    // 删除用户 (管理员)
    if (action === 'delete') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || currentUser.role !== UserRole.ADMIN) {
        return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
      }

      if (!userId) {
        return NextResponse.json({ success: false, error: '用户ID不能为空' }, { status: 400 });
      }

      if (userId === currentUser.id) {
        return NextResponse.json({ success: false, error: '不能删除自己' }, { status: 400 });
      }

      await db.user.delete({ where: { id: userId } });
      return NextResponse.json({ success: true, message: '用户已删除' });
    }

    // 重置密码 (管理员)
    if (action === 'reset-password') {
      const currentUser = await getCurrentUser(request);
      if (!currentUser || currentUser.role !== UserRole.ADMIN) {
        return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
      }

      if (!userId || !password) {
        return NextResponse.json({ success: false, error: '用户ID和新密码不能为空' }, { status: 400 });
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
