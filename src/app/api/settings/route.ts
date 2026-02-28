import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { withAuth } from '@/lib/route-auth';
import { db } from '@/lib/db';
import { editableSystemSettingKeys, getSystemSettings, invalidateSystemSettingsCache } from '@/lib/system-settings';

const settingDefaults: Record<string, string> = {
  OCR_DISABLED: process.env.OCR_DISABLED ?? 'false',
  OCR_API_BASE_URL: process.env.OCR_API_BASE_URL ?? 'https://api.openai.com/v1',
  OCR_API_KEY: process.env.OCR_API_KEY ?? '',
  OCR_MODEL: process.env.OCR_MODEL ?? 'gpt-4o-mini',
  OCR_MAX_RETRIES: process.env.OCR_MAX_RETRIES ?? '3',
  OCR_TIMEOUT_MS: process.env.OCR_TIMEOUT_MS ?? '15000',
  OCR_RETRY_BASE_DELAY_MS: process.env.OCR_RETRY_BASE_DELAY_MS ?? '1200',
  OCR_INPUT_COST_PER_1K: process.env.OCR_INPUT_COST_PER_1K ?? '0',
  OCR_OUTPUT_COST_PER_1K: process.env.OCR_OUTPUT_COST_PER_1K ?? '0',
};

export const GET = withAuth(async (_request, currentUser) => {
  const keys = [...editableSystemSettingKeys];
  const overrides = await getSystemSettings(keys);
  const settings = Object.fromEntries(
    keys.map((key) => [key, overrides[key] ?? settingDefaults[key] ?? ''])
  );

  return NextResponse.json({
    success: true,
    data: {
      settings,
      editableKeys: keys,
      canEdit: currentUser.role === UserRole.ADMIN,
    },
  });
});

export const POST = withAuth(async (request: NextRequest, currentUser) => {
  const body = await request.json().catch(() => ({}));
  const action = typeof body?.action === 'string' ? body.action : '';

  if (action !== 'update-config') {
    return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
  }

  if (currentUser.role !== UserRole.ADMIN) {
    return NextResponse.json({ success: false, error: '只有管理员可以修改系统配置' }, { status: 403 });
  }

  const settings = body?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return NextResponse.json({ success: false, error: '配置参数无效' }, { status: 400 });
  }

  const keys = [...editableSystemSettingKeys];
  const updates = keys
    .filter((key) => Object.prototype.hasOwnProperty.call(settings, key))
    .map((key) => ({
      key,
      value: String((settings as Record<string, unknown>)[key] ?? ''),
    }));

  if (updates.length === 0) {
    return NextResponse.json({ success: true, message: '无变更' });
  }

  await db.$transaction(
    updates.map((item) =>
      db.systemSetting.upsert({
        where: { key: item.key },
        create: {
          key: item.key,
          value: item.value,
          updatedBy: currentUser.id,
        },
        update: {
          value: item.value,
          updatedBy: currentUser.id,
        },
      })
    )
  );

  invalidateSystemSettingsCache();
  return NextResponse.json({ success: true, message: '配置已更新' });
});
