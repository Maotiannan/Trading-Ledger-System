import { db } from '@/lib/db';
import { UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';
import { runInTransaction } from '@/lib/transaction';
import { isUnsafeInitialAdminPassword } from '@/lib/security-config';
import { logger } from '@/lib/logger';

// bcrypt 工作因子（cost factor），值越高越安全但越慢
const SALT_ROUNDS = 12;
const DUMMY_BCRYPT_HASH = '$2b$12$rH0I1qVK9ChrohNuFhABA.5o38Cb0QrXKIX/aM3v5IylP3qzRBgJC';

// 检查是否为旧的 SHA-256 哈希格式（64位十六进制）
function isLegacyHash(hash: string): boolean {
  return /^[a-f0-9]{64}$/.test(hash);
}

// 使用 bcrypt 哈希密码
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

// 验证密码（支持新旧格式，自动迁移旧密码）
export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  // 如果是旧的 SHA-256 格式，使用旧方法验证
  if (isLegacyHash(hashedPassword)) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + 'salt_key_for_security');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const legacyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return legacyHash === hashedPassword;
  }
  
  // bcrypt 格式，使用 bcrypt 验证
  return bcrypt.compare(password, hashedPassword);
}

// 迁移旧密码到 bcrypt
export async function migratePassword(userId: string, newPassword: string): Promise<void> {
  const hashedPassword = await hashPassword(newPassword);
  await runInTransaction((tx) => tx.user.update({
    where: { id: userId },
    data: { password: hashedPassword }
  }));
}

// 创建默认管理员账户
export async function createDefaultAdmin() {
  const adminEmail = process.env.INIT_ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.INIT_ADMIN_PASSWORD || '';
  if (!adminEmail || !adminPassword) {
    return;
  }
  if (isUnsafeInitialAdminPassword(adminPassword)) {
    throw new Error('INIT_ADMIN_PASSWORD is unsafe; configure a non-default password before creating the default admin');
  }

  const existingAdmin = await db.user.findUnique({
    where: { email: adminEmail }
  });

  if (!existingAdmin) {
    const hashedPassword = await hashPassword(adminPassword);
    await runInTransaction((tx) => tx.user.create({
      data: {
        email: adminEmail,
        password: hashedPassword,
        name: 'Admin',
        role: UserRole.ADMIN,
        level: 1,
        parentId: null,
      }
    }));
    logger.info('Default admin created');
  }
}

// 用户会话类型
export interface UserSession {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
}

// 验证用户登录（支持密码自动迁移）
export async function validateUser(email: string, password: string): Promise<UserSession | null> {
  const user = await db.user.findUnique({
    where: { email }
  });

  if (!user) {
    // 不存在用户时也执行一次 bcrypt compare，降低枚举攻击的时间差。
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
    return null;
  }

  const isValid = await verifyPassword(password, user.password);
  if (!isValid) return null;

  // 如果是旧密码格式，自动迁移到 bcrypt
  if (isLegacyHash(user.password)) {
      logger.info('Migrating legacy password hash to bcrypt');
    await migratePassword(user.id, password);
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}
