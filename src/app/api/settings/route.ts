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

const purgeModuleKeys = ['invoice', 'receipt', 'detail', 'swift', 'customer', 'all'] as const;
type PurgeModuleKey = typeof purgeModuleKeys[number];

function normalizePurgeModules(value: unknown): Set<Exclude<PurgeModuleKey, 'all'>> {
  const raw = Array.isArray(value) ? value : [];
  const normalized = new Set<PurgeModuleKey>();
  for (const item of raw) {
    const v = String(item || '').trim().toLowerCase() as PurgeModuleKey;
    if (purgeModuleKeys.includes(v)) normalized.add(v);
  }
  if (normalized.has('all')) {
    return new Set<Exclude<PurgeModuleKey, 'all'>>(['invoice', 'receipt', 'detail', 'swift', 'customer']);
  }
  return new Set(Array.from(normalized).filter((key): key is Exclude<PurgeModuleKey, 'all'> => key !== 'all'));
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

  let branchPurgeTargets: Array<{ id: string; email: string; name: string | null; level: number; role: UserRole; parentId: string | null }> = [];
  if (currentUser.role === UserRole.ADMIN) {
    branchPurgeTargets = await db.user.findMany({
      select: { id: true, email: true, name: true, level: true, role: true, parentId: true },
      orderBy: [{ level: 'asc' }, { role: 'asc' }, { createdAt: 'asc' }],
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      settings,
      editableKeys: keys,
      canEdit: currentUser.role === UserRole.ADMIN,
      branchPurgeTargets,
      canPurgeBranch: currentUser.role === UserRole.ADMIN,
      purgeModuleKeys,
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
    if (currentUser.role !== UserRole.ADMIN) {
      return NextResponse.json({ success: false, error: '只有管理员可执行分支清库' }, { status: 403 });
    }

    const targetUserId = typeof body?.targetUserId === 'string'
      ? body.targetUserId.trim()
      : (typeof body?.targetAdminId === 'string' ? body.targetAdminId.trim() : '');
    const password = typeof body?.password === 'string' ? body.password : '';
    const selectedModules = normalizePurgeModules(body?.modules);
    if (!targetUserId || !password) {
      return NextResponse.json({ success: false, error: '缺少目标账号或密码' }, { status: 400 });
    }
    if (selectedModules.size === 0) {
      return NextResponse.json({ success: false, error: '至少选择一个清理模块' }, { status: 400 });
    }

    const currentWithPassword = await db.user.findUnique({
      where: { id: currentUser.id },
      select: { id: true, password: true },
    });
    if (!currentWithPassword || !(await verifyPassword(password, currentWithPassword.password))) {
      return NextResponse.json({ success: false, error: '密码错误' }, { status: 400 });
    }

    const targetUser = await db.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, email: true, name: true, level: true },
    });
    if (!targetUser) {
      return NextResponse.json({ success: false, error: '目标账户不存在' }, { status: 400 });
    }

    const branchUserIds = await getBranchUserIds(targetUser.id);

    const [orders, invoices, receipts, details, swifts, customers] = await Promise.all([
      db.order.findMany({
        where: { createdBy: { in: branchUserIds } },
        select: { id: true, invoiceId: true },
      }),
      db.invoice.findMany({
        where: { createdBy: { in: branchUserIds } },
        select: { id: true },
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
        where: {
          OR: [
            { createdBy: { in: branchUserIds } },
            { ownerId: { in: branchUserIds } },
          ],
        },
        select: { id: true },
      }),
    ]);

    const orderIds = orders.map((row) => row.id);
    const receiptIds = receipts.map((row) => row.id);
    const detailIds = details.map((row) => row.id);
    const swiftIdsCreatedByBranch = swifts.map((row) => row.id);
    const customerIds = customers.map((row) => row.id);

    const modules = {
      invoice: selectedModules.has('invoice'),
      receipt: selectedModules.has('receipt'),
      detail: selectedModules.has('detail'),
      swift: selectedModules.has('swift'),
      customer: selectedModules.has('customer'),
    };

    const selectedOrderIds = modules.invoice ? orderIds : [];
    const selectedReceiptIds = modules.receipt ? receiptIds : [];
    const selectedDetailIds = modules.detail ? detailIds : [];
    const selectedDetailIdSet = new Set(selectedDetailIds);
    const selectedSwiftIds = Array.from(new Set([
      ...(modules.swift ? swiftIdsCreatedByBranch : []),
      ...(modules.detail ? swifts.filter((row) => selectedDetailIdSet.has(row.detailId)).map((row) => row.id) : []),
    ]));
    const selectedCustomerIds = modules.customer ? customerIds : [];
    const selectedInvoiceIds = modules.invoice
      ? Array.from(new Set([...invoices.map((row) => row.id), ...orders.map((row) => row.invoiceId)]))
      : [];

    try {
      await db.$transaction(async (tx) => {
        if (selectedReceiptIds.length > 0) {
          await tx.detailItem.updateMany({
            where: { receiptId: { in: selectedReceiptIds } },
            data: { receiptId: null },
          });
        }

        if (selectedOrderIds.length > 0) {
          await tx.receipt.updateMany({
            where: { orderId: { in: selectedOrderIds } },
            data: { orderId: null },
          });
          await tx.balanceTransfer.deleteMany({
            where: {
              OR: [
                { fromOrderId: { in: selectedOrderIds } },
                { toOrderId: { in: selectedOrderIds } },
              ],
            },
          });
        }

        if (selectedDetailIds.length > 0) {
          await tx.detailHistory.deleteMany({
            where: { detailId: { in: selectedDetailIds } },
          });
        }

        if (selectedReceiptIds.length > 0) {
          await tx.receiptHistory.deleteMany({
            where: { receiptId: { in: selectedReceiptIds } },
          });
        }

        if (selectedSwiftIds.length > 0) {
          await tx.swift.deleteMany({ where: { id: { in: selectedSwiftIds } } });
        }
        if (selectedDetailIds.length > 0) {
          await tx.detail.deleteMany({ where: { id: { in: selectedDetailIds } } });
        }
        if (selectedReceiptIds.length > 0) {
          await tx.receipt.deleteMany({ where: { id: { in: selectedReceiptIds } } });
        }
        if (selectedOrderIds.length > 0) {
          await tx.order.deleteMany({ where: { id: { in: selectedOrderIds } } });
        }
        if (selectedInvoiceIds.length > 0) {
          await tx.invoice.deleteMany({
            where: {
              id: { in: selectedInvoiceIds },
              orders: { none: {} },
            },
          });
        }
        if (selectedCustomerIds.length > 0) {
          await tx.customer.deleteMany({ where: { id: { in: selectedCustomerIds } } });
        }

        await tx.deletionRequest.deleteMany({
          where: {
            OR: [
              { requestedBy: { in: branchUserIds } },
              { approvedBy: { in: branchUserIds } },
              ...(selectedReceiptIds.length > 0 ? [{ targetType: 'RECEIPT', targetId: { in: selectedReceiptIds } }] : []),
              ...(selectedDetailIds.length > 0 ? [{ targetType: 'DETAIL', targetId: { in: selectedDetailIds } }] : []),
              ...(selectedSwiftIds.length > 0 ? [{ targetType: 'SWIFT', targetId: { in: selectedSwiftIds } }] : []),
            ],
          },
        });

        await tx.auditLog.deleteMany({
          where: { actorId: { in: branchUserIds } },
        });
      });
    } catch (error) {
      console.error('[purge-branch-data] failed', {
        targetUserId: targetUser.id,
        targetEmail: targetUser.email,
        modules: Array.from(selectedModules),
        error,
      });
      const message = error instanceof Error ? error.message : '未知错误';
      return NextResponse.json({ success: false, error: `分支清库失败：${message}` }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `已清空账号 ${targetUser.email} 分支业务数据（系统配置/用户配置保留）`,
      data: {
        targetUser: targetUser.email,
        targetRole: targetUser.role,
        branchUsers: branchUserIds.length,
        modules: Array.from(selectedModules),
        deletedOrders: selectedOrderIds.length,
        deletedInvoices: selectedInvoiceIds.length,
        deletedReceipts: selectedReceiptIds.length,
        deletedDetails: selectedDetailIds.length,
        deletedSwifts: selectedSwiftIds.length,
        deletedCustomers: selectedCustomerIds.length,
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
