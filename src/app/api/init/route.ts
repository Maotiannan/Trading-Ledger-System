import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { UserRole } from '@prisma/client';

// 初始化默认管理员账户
export async function POST() {
  try {
    const existingAdmin = await db.user.findUnique({
      where: { email: 'admin@example.com' }
    });

    if (!existingAdmin) {
      const hashedPassword = await hashPassword('admin123');
      await db.user.create({
        data: {
          email: 'admin@example.com',
          password: hashedPassword,
          name: 'Admin',
          role: UserRole.ADMIN,
        }
      });
      return NextResponse.json({ 
        success: true, 
        message: 'Default admin created: admin@example.com / admin123' 
      });
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Admin already exists' 
    });
  } catch (error) {
    console.error('Init error:', error);
    return NextResponse.json({ success: false, error: 'Init failed' }, { status: 500 });
  }
}
