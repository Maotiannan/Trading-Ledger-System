import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { withAuth } from '@/lib/route-auth';
import { db } from '@/lib/db';
import { editableSystemSettingKeys, getSystemSettings, invalidateSystemSettingsCache } from '@/lib/system-settings';
import { testOcrConnectivity } from '@/lib/ocr';
import { verifyPassword } from '@/lib/auth';

const settingDefaults: Record<string, string> = {
  OCR_DISABLED: process.env.OCR_DISABLED ?? 'false',
  OCR_API_BASE_URL: process.env.OCR_API_BASE_URL ?? 'https://api.openai.com/v1',
  OCR_API_KEY: process.env.OCR_API_KEY ?? '',
  OCR_MODEL: process.env.OCR_MODEL ?? 'gpt-4o-mini',
  OCR_MAX_RETRIES: process.env.OCR_MAX_RETRIES ?? '3',
  OCR_TIMEOUT_MS: process.env.OCR_TIMEOUT_MS ?? '60000',
  OCR_RETRY_BASE_DELAY_MS: process.env.OCR_RETRY_BASE_DELAY_MS ?? '1200',
  OCR_INPUT_COST_PER_1K: process.env.OCR_INPUT_COST_PER_1K ?? '0',
  OCR_OUTPUT_COST_PER_1K: process.env.OCR_OUTPUT_COST_PER_1K ?? '0',
  SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS: process.env.SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS ?? 'false',
  DETAIL_RECEIPT_MATCH_TOLERANCE: process.env.DETAIL_RECEIPT_MATCH_TOLERANCE ?? '5',
};

function isPrimaryAdmin(email: string | null | undefined): boolean {
  return String(email || '').trim().toLowerCase() === 'admin@example.com';
}

async function getBranchUserIds(rootUserId: string): Promise<string[]> {
  const users = await db.user.findMany({
    select: { id: true, parentId: true },
  });
  const children = new Map<string, string[]>();
  for (const user of users) {
    if (!user.parentId) continue;
    if (!children.has(user.parentId)) children.set(user.parentId, []);
    children.get(user.parentId)!.push(user.id);
  }

  const seen = new Set<string>([rootUserId]);
  const queue: string[] = [rootUserId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const direct = children.get(current) || [];
    for (const childId of direct) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      queue.push(childId);
    }
  }
  return Array.from(seen);
}

export const GET = withAuth(async (_request, currentUser) => {
  const keys = [...editableSystemSettingKeys];
  const overrides = await getSystemSettings(keys);
  const settings = Object.fromEntries(
    keys.map((key) => [key, overrides[key] ?? settingDefaults[key] ?? ''])
  );

  let branchPurgeAdmins: Array<{ id: string; email: string; name: string | null; level: number }> = [];
  if (currentUser.role === UserRole.ADMIN && isPrimaryAdmin(currentUser.email)) {
    const admins = await db.user.findMany({
      where: { role: UserRole.ADMIN },
      select: { id: true, email: true, name: true, level: true },
      orderBy: [{ level: 'asc' }, { createdAt: 'asc' }],
    });
    branchPurgeAdmins = admins;
  }

  return NextResponse.json({
    success: true,
    data: {
      settings,
      editableKeys: keys,
      canEdit: currentUser.role === UserRole.ADMIN,
      branchPurgeAdmins,
      canPurgeBranch: currentUser.role === UserRole.ADMIN && isPrimaryAdmin(currentUser.email),
    },
  });
});

export const POST = withAuth(async (request: NextRequest, currentUser) => {
  const body = await request.json().catch(() => ({}));
  const action = typeof body?.action === 'string' ? body.action : '';

  if (action === 'test-ocr') {
    if (currentUser.role !== UserRole.ADMIN) {
      return NextResponse.json({ success: false, error: '只有管理员可以测试OCR配置' }, { status: 403 });
    }
    const result = await testOcrConnectivity();
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.message, detail: result.detail || '' },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: true, message: result.message, detail: result.detail || '' });
  }

  if (action === 'purge-business-data') {
    if (currentUser.role !== UserRole.ADMIN) {
      return NextResponse.json({ success: false, error: '只有管理员可以清空业务数据' }, { status: 403 });
    }
    await db.$transaction(async (tx) => {
      await tx.detailItem.deleteMany({});
      await tx.receiptHistory.deleteMany({});
      await tx.detailHistory.deleteMany({});
      await tx.balanceTransfer.deleteMany({});
      await tx.swift.deleteMany({});
      await tx.receipt.deleteMany({});
      await tx.detail.deleteMany({});
      await tx.order.deleteMany({});
      await tx.invoice.deleteMany({});
      await tx.customer.deleteMany({});
      await tx.deletionRequest.deleteMany({});
      await tx.auditLog.deleteMany({});
      await tx.systemSetting.deleteMany({});
    });
    invalidateSystemSettingsCache();
    return NextResponse.json({ success: true, message: '业务数据已清空（用户数据保留）' });
  }

  if (action === 'purge-branch-data') {
    if (currentUser.role !== UserRole.ADMIN || !isPrimaryAdmin(currentUser.email)) {
      return NextResponse.json({ success: false, error: '只有主管理员可执行分支清库' }, { status: 403 });
    }

    const targetAdminId = typeof body?.targetAdminId === 'string' ? body.targetAdminId.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!targetAdminId || !password) {
      return NextResponse.json({ success: false, error: '缺少目标管理员或密码' }, { status: 400 });
    }

    const currentWithPassword = await db.user.findUnique({
      where: { id: currentUser.id },
      select: { id: true, password: true },
    });
    if (!currentWithPassword || !(await verifyPassword(password, currentWithPassword.password))) {
      return NextResponse.json({ success: false, error: '密码错误' }, { status: 400 });
    }

    const targetAdmin = await db.user.findUnique({
      where: { id: targetAdminId },
      select: { id: true, role: true, email: true, name: true },
    });
    if (!targetAdmin || targetAdmin.role !== UserRole.ADMIN) {
      return NextResponse.json({ success: false, error: '目标账户不是管理员' }, { status: 400 });
    }

    const branchUserIds = await getBranchUserIds(targetAdmin.id);

    const [orders, receipts, details, swifts, customers] = await Promise.all([
      db.order.findMany({
        where: { createdBy: { in: branchUserIds } },
        select: { id: true, invoiceId: true },
      }),
      db.receipt.findMany({
        where: { createdBy: { in: branchUserIds } },
        select: { id: true },
      }),
      db.detail.findMany({
        where: { createdBy: { in: branchUserIds } },
        select: { id: true },
      }),
      db.swift.findMany({
        where: { createdBy: { in: branchUserIds } },
        select: { id: true },
      }),
      db.customer.findMany({
        where: { createdBy: { in: branchUserIds } },
        select: { id: true },
      }),
    ]);

    const orderIds = orders.map((row) => row.id);
    const receiptIds = receipts.map((row) => row.id);
    const detailIds = details.map((row) => row.id);
    const swiftIds = swifts.map((row) => row.id);
    const customerIds = customers.map((row) => row.id);
    const touchedInvoiceIds = Array.from(new Set(orders.map((row) => row.invoiceId)));

    await db.$transaction(async (tx) => {
      if (receiptIds.length > 0) {
        await tx.detailItem.updateMany({
          where: { receiptId: { in: receiptIds } },
          data: { receiptId: null },
        });
      }

      if (orderIds.length > 0) {
        await tx.balanceTransfer.deleteMany({
          where: {
            OR: [
              { fromOrderId: { in: orderIds } },
              { toOrderId: { in: orderIds } },
            ],
          },
        });
      }

      if (detailIds.length > 0) {
        await tx.detailHistory.deleteMany({
          where: {
            OR: [
              { createdBy: { in: branchUserIds } },
              { detailId: { in: detailIds } },
            ],
          },
        });
      }

      if (receiptIds.length > 0) {
        await tx.receiptHistory.deleteMany({
          where: {
            OR: [
              { createdBy: { in: branchUserIds } },
              { receiptId: { in: receiptIds } },
            ],
          },
        });
      }

      await tx.swift.deleteMany({ where: { createdBy: { in: branchUserIds } } });
      await tx.detail.deleteMany({ where: { createdBy: { in: branchUserIds } } });
      await tx.receipt.deleteMany({ where: { createdBy: { in: branchUserIds } } });
      await tx.order.deleteMany({ where: { createdBy: { in: branchUserIds } } });
      await tx.customer.deleteMany({ where: { createdBy: { in: branchUserIds } } });

      if (touchedInvoiceIds.length > 0) {
        await tx.invoice.deleteMany({
          where: {
            id: { in: touchedInvoiceIds },
            orders: { none: {} },
          },
        });
      }

      await tx.deletionRequest.deleteMany({
        where: {
          OR: [
            { requestedBy: { in: branchUserIds } },
            { approvedBy: { in: branchUserIds } },
            ...(receiptIds.length > 0 ? [{ targetType: 'RECEIPT', targetId: { in: receiptIds } }] : []),
            ...(detailIds.length > 0 ? [{ targetType: 'DETAIL', targetId: { in: detailIds } }] : []),
            ...(swiftIds.length > 0 ? [{ targetType: 'SWIFT', targetId: { in: swiftIds } }] : []),
          ],
        },
      });

      await tx.auditLog.deleteMany({
        where: { actorId: { in: branchUserIds } },
      });
    });

    return NextResponse.json({
      success: true,
      message: `已清空管理员 ${targetAdmin.email} 分支业务数据（用户/系统配置保留）`,
      data: {
        branchUsers: branchUserIds.length,
        deletedOrders: orderIds.length,
        deletedReceipts: receiptIds.length,
        deletedDetails: detailIds.length,
        deletedSwifts: swiftIds.length,
        deletedCustomers: customerIds.length,
      },
    });
  }

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
