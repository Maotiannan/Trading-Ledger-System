import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { withAuth } from '@/lib/route-auth';
import { getSystemSettings } from '@/lib/system-settings';
import {
  assertNoCustomerScopeConflict,
  canMutateCustomer,
  customerAccessWhere,
  mapPrismaWriteError,
  resolveCustomerOwnerId,
} from '@/lib/customer-scope';

type CustomerPayload = {
  mark?: string;
  orderName?: string;
  name?: string;
  phone?: string;
  city?: string;
  consignee?: string | null;
  companyName?: string | null;
  credit?: number | null;
  companyAddress?: string | null;
};

type ImportRow = {
  rowNo: number;
  payload: CustomerPayload;
  ownerEmail?: string | null;
};

type CustomerImportIssueRow = {
  rowNo: number;
  mark: string;
  orderName: string;
  name: string;
  phone: string;
  city: string;
  consignee: string;
  companyName: string;
  credit: string;
  companyAddress: string;
  ownerEmail: string;
  reason: string;
};

type CustomerImportProcessResult = {
  success: boolean;
  status: number;
  message: string;
  details: string[];
  issueRows: CustomerImportIssueRow[];
  createdCount: number;
  updatedCount: number;
  createdRows: string[];
  updatedRows: string[];
};

function trimStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function hasMeaningfulContent(value: string | null | undefined): boolean {
  const normalized = trimStr(value);
  if (!normalized) return false;
  return /[A-Za-z0-9\u4e00-\u9fff]/.test(normalized);
}

function isEmptyOrPlaceholder(value: string | null | undefined): boolean {
  const normalized = trimStr(value);
  if (!normalized) return true;
  return !hasMeaningfulContent(normalized);
}

function normalizeMarkForMatch(value: string | null | undefined): string {
  return trimStr(value).toLowerCase();
}

function normalizeNameForMatch(value: string | null | undefined): string {
  return trimStr(value).toLowerCase();
}

function normalizePhoneToken(value: string | null | undefined): string {
  const normalized = trimStr(value).toLowerCase();
  if (!normalized) return '';
  return normalized.replace(/[^a-z0-9]/g, '');
}

function splitPhoneCandidates(value: string | null | undefined): string[] {
  const raw = trimStr(value);
  if (!raw) return [];
  const parts = raw
    .split('/')
    .map((item) => normalizePhoneToken(item))
    .filter(Boolean);
  return Array.from(new Set(parts));
}

function formatCustomerSummary(name: string | null | undefined, mark: string | null | undefined, phone: string | null | undefined): string {
  return `${trimStr(name) || '-'} / ${trimStr(mark) || '-'} / ${trimStr(phone) || '-'}`;
}

type ImportExistingCustomer = {
  id: string;
  mark: string;
  orderName: string;
  name: string;
  phone: string;
  city: string;
  consignee: string | null;
  companyName: string | null;
  credit: unknown;
  companyAddress: string | null;
  ownerId: string;
};

function buildCustomerUpdateDataForImport(
  existing: ImportExistingCustomer,
  payload: CustomerPayload,
  showExtended: boolean,
  ownerId: string
): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};
  if (isEmptyOrPlaceholder(existing.mark) && hasMeaningfulContent(payload.mark)) updateData.mark = payload.mark;
  if (isEmptyOrPlaceholder(existing.orderName) && hasMeaningfulContent(payload.orderName)) updateData.orderName = payload.orderName;
  if (isEmptyOrPlaceholder(existing.name) && hasMeaningfulContent(payload.name)) updateData.name = payload.name;
  if (isEmptyOrPlaceholder(existing.phone) && hasMeaningfulContent(payload.phone)) updateData.phone = payload.phone;
  if (isEmptyOrPlaceholder(existing.city) && hasMeaningfulContent(payload.city)) updateData.city = payload.city;
  if (isEmptyOrPlaceholder(existing.consignee) && trimStr(payload.consignee)) updateData.consignee = payload.consignee;
  if (showExtended) {
    if (isEmptyOrPlaceholder(existing.companyName) && trimStr(payload.companyName)) updateData.companyName = payload.companyName;
    if (isEmptyOrPlaceholder(existing.companyAddress) && trimStr(payload.companyAddress)) updateData.companyAddress = payload.companyAddress;
    if ((existing.credit === null || existing.credit === undefined) && payload.credit !== null && payload.credit !== undefined) {
      updateData.credit = payload.credit;
    }
  }
  if (existing.ownerId !== ownerId) updateData.ownerId = ownerId;
  return updateData;
}

function managerOnly(userRole: UserRole): NextResponse | null {
  if (userRole === UserRole.ADMIN || userRole === UserRole.SALES) return null;
  return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
}

function parsePayload(body: Record<string, unknown>): CustomerPayload {
  return {
    mark: trimStr(body.mark),
    orderName: trimStr(body.orderName),
    name: trimStr(body.name),
    phone: trimStr(body.phone),
    city: trimStr(body.city),
    consignee: trimStr(body.consignee) || null,
    companyName: trimStr(body.companyName) || null,
    companyAddress: trimStr(body.companyAddress) || null,
    credit: body.credit === null || body.credit === undefined || body.credit === '' ? null : Number(body.credit),
  };
}

async function canSalesEditExtendedFields(): Promise<boolean> {
  const settings = await getSystemSettings(['SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS']);
  return (settings.SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS || 'false').toLowerCase() === 'true';
}

function validateRequired(payload: CustomerPayload): string | null {
  if (!payload.mark) return 'MARK不能为空';
  if (!payload.orderName) return 'ORDER_NAME不能为空';
  if (!payload.name) return 'NAME不能为空';
  if (!payload.phone) return 'PHONE不能为空';
  if (!payload.city) return 'CITY不能为空';
  if ((payload.mark?.length || 0) > 191) return 'MARK长度不能超过191';
  if ((payload.orderName?.length || 0) > 191) return 'ORDER_NAME长度不能超过191';
  if ((payload.phone?.length || 0) > 191) return 'PHONE长度不能超过191';
  if ((payload.city?.length || 0) > 191) return 'CITY长度不能超过191';
  if (payload.credit !== null && payload.credit !== undefined) {
    if (!Number.isFinite(payload.credit) || payload.credit < 0) return 'CREDIT必须为大于等于0的数字';
  }
  return null;
}

function toSalesView<T extends Record<string, unknown>>(row: T, showExtended: boolean): T {
  if (showExtended) return row;
  return {
    ...row,
    companyName: null,
    companyAddress: null,
    credit: null,
  };
}

async function listCustomerOwnerOptions(currentUser: { id: string; role: UserRole }) {
  if (currentUser.role === UserRole.ADMIN) {
    const rows = await db.user.findMany({
      where: {
        OR: [
          { id: currentUser.id },
          { role: UserRole.SALES },
        ],
      },
      select: { id: true, email: true, name: true, role: true, level: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    return rows;
  }

  const self = await db.user.findUnique({
    where: { id: currentUser.id },
    select: { id: true, email: true, name: true, role: true, level: true },
  });
  return self ? [self] : [];
}

function toCustomerImportIssueRow(row: ImportRow, reason: string): CustomerImportIssueRow {
  const payload = row.payload;
  return {
    rowNo: row.rowNo,
    mark: trimStr(payload.mark),
    orderName: trimStr(payload.orderName),
    name: trimStr(payload.name),
    phone: trimStr(payload.phone),
    city: trimStr(payload.city),
    consignee: trimStr(payload.consignee),
    companyName: trimStr(payload.companyName),
    credit: payload.credit === null || payload.credit === undefined || Number.isNaN(payload.credit) ? '' : String(payload.credit),
    companyAddress: trimStr(payload.companyAddress),
    ownerEmail: trimStr(row.ownerEmail || ''),
    reason,
  };
}

async function processCustomerImportRows(
  rows: ImportRow[],
  currentUser: { id: string; role: UserRole },
  ownerIdFallback: string,
  showExtended: boolean
): Promise<CustomerImportProcessResult> {
  const issueRows: CustomerImportIssueRow[] = [];
  if (rows.length === 0) {
    return {
      success: false,
      status: 400,
      message: '没有可导入的数据行',
      details: [],
      issueRows: [],
      createdCount: 0,
      updatedCount: 0,
      createdRows: [],
      updatedRows: [],
    };
  }

  const ownerEmailToId = new Map<string, string>();
  if (currentUser.role === UserRole.ADMIN && rows.some((row) => !!row.ownerEmail)) {
    const ownerEmails = Array.from(new Set(rows.map((row) => (row.ownerEmail || '').trim().toLowerCase()).filter(Boolean)));
    const ownerUsers = await db.user.findMany({
      where: {
        role: UserRole.SALES,
        email: { in: ownerEmails },
      },
      select: { id: true, email: true },
    });
    for (const owner of ownerUsers) ownerEmailToId.set(owner.email.toLowerCase(), owner.id);
  }

  const ownerCustomerCache = new Map<string, ImportExistingCustomer[]>();
  const loadOwnerCustomers = async (ownerId: string): Promise<ImportExistingCustomer[]> => {
    if (!ownerCustomerCache.has(ownerId)) {
      const ownerCustomers = await db.customer.findMany({
        where: { ownerId },
        select: {
          id: true,
          mark: true,
          orderName: true,
          name: true,
          phone: true,
          city: true,
          consignee: true,
          companyName: true,
          credit: true,
          companyAddress: true,
          ownerId: true,
        },
      });
      ownerCustomerCache.set(ownerId, ownerCustomers);
    }
    return ownerCustomerCache.get(ownerId)!;
  };

  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  const createdRows: string[] = [];
  const updatedRows: string[] = [];

  for (const row of rows) {
    const payload = row.payload;
    const requiredError = validateRequired(payload);
    if (requiredError) {
      issueRows.push(toCustomerImportIssueRow(row, requiredError));
      continue;
    }

    const rowOwnerId = row.ownerEmail
      ? ownerEmailToId.get((row.ownerEmail || '').toLowerCase()) || null
      : ownerIdFallback;

    if (row.ownerEmail && currentUser.role === UserRole.ADMIN && !rowOwnerId) {
      issueRows.push(toCustomerImportIssueRow(row, `SALES_EMAIL不存在或不是销售账号: ${row.ownerEmail}`));
      continue;
    }

    const effectiveOwnerId = rowOwnerId || ownerIdFallback;

    try {
      const ownerCustomers = await loadOwnerCustomers(effectiveOwnerId);
      const phoneTokens = splitPhoneCandidates(payload.phone || '');
      const inputMark = normalizeMarkForMatch(payload.mark || '');
      const inputName = normalizeNameForMatch(payload.name || '');
      const inputOrderName = trimStr(payload.orderName).toLowerCase();
      const canUseMarkName = hasMeaningfulContent(payload.mark) && hasMeaningfulContent(payload.name);

      const markNameMatchedIds = new Set<string>();
      for (const existing of ownerCustomers) {
        if (canUseMarkName) {
          const existingMark = normalizeMarkForMatch(existing.mark || '');
          const existingName = normalizeNameForMatch(existing.name || '');
          if (hasMeaningfulContent(existing.mark) && hasMeaningfulContent(existing.name) && existingMark === inputMark && existingName === inputName) {
            markNameMatchedIds.add(existing.id);
          }
        }
      }

      if (markNameMatchedIds.size > 1) {
        issueRows.push(toCustomerImportIssueRow(row, '同一行命中多条客户（MARK+NAME），请人工处理后重试'));
        continue;
      }

      let targetId: string | null = markNameMatchedIds.size === 1 ? Array.from(markNameMatchedIds)[0] : null;
      if (!targetId) {
        const phoneMatchedIds = new Set<string>();
        for (const existing of ownerCustomers) {
          if (phoneTokens.length === 0) continue;
          const existingPhoneTokens = splitPhoneCandidates(existing.phone || '');
          if (!existingPhoneTokens.some((token) => phoneTokens.includes(token))) continue;
          if (!canUseMarkName) {
            phoneMatchedIds.add(existing.id);
            continue;
          }
          const existingMark = normalizeMarkForMatch(existing.mark || '');
          const existingName = normalizeNameForMatch(existing.name || '');
          const existingOrderName = trimStr(existing.orderName).toLowerCase();
          const existingHasMeaningful = hasMeaningfulContent(existing.mark) && hasMeaningfulContent(existing.name);
          const sameMarkName = existingHasMeaningful && existingMark === inputMark && existingName === inputName;
          const sameOrderName = !!inputOrderName && inputOrderName === existingOrderName;
          const existingIsPlaceholder = !existingHasMeaningful;
          if (sameMarkName || sameOrderName || existingIsPlaceholder) {
            phoneMatchedIds.add(existing.id);
          }
        }
        if (phoneMatchedIds.size > 1) {
          issueRows.push(toCustomerImportIssueRow(row, '同一行命中多条客户（PHONE），请人工处理后重试'));
          continue;
        }
        targetId = phoneMatchedIds.size === 1 ? Array.from(phoneMatchedIds)[0] : null;
      }

      if (targetId) {
        const target = ownerCustomers.find((item) => item.id === targetId);
        if (!target) {
          issueRows.push(toCustomerImportIssueRow(row, '命中客户后读取失败，请重试'));
          continue;
        }
        await assertNoCustomerScopeConflict(
          effectiveOwnerId,
          {
            orderName: payload.orderName!,
            phone: payload.phone!,
            companyName: showExtended ? payload.companyName || null : null,
          },
          targetId
        );
        const updateData = buildCustomerUpdateDataForImport(target, payload, showExtended, effectiveOwnerId);
        if (Object.keys(updateData).length > 0) {
          await db.customer.update({
            where: { id: targetId },
            data: updateData,
          });
          const updatedRowIndex = ownerCustomers.findIndex((item) => item.id === targetId);
          if (updatedRowIndex >= 0) {
            ownerCustomers[updatedRowIndex] = {
              ...ownerCustomers[updatedRowIndex],
              ...updateData,
            };
          }
          updatedCount++;
          updatedRows.push(formatCustomerSummary(payload.name, payload.mark, payload.phone));
        } else {
          unchangedCount++;
        }
        continue;
      }

      await assertNoCustomerScopeConflict(effectiveOwnerId, {
        orderName: payload.orderName!,
        phone: payload.phone!,
        companyName: showExtended ? payload.companyName || null : null,
      });

      await db.customer.create({
        data: {
          mark: payload.mark!,
          orderName: payload.orderName!,
          name: payload.name!,
          phone: payload.phone!,
          city: payload.city!,
          consignee: payload.consignee || null,
          companyName: showExtended ? payload.companyName || null : null,
          companyAddress: showExtended ? payload.companyAddress || null : null,
          credit: showExtended ? payload.credit ?? null : null,
          createdBy: currentUser.id,
          ownerId: effectiveOwnerId,
        },
      });
      ownerCustomerCache.delete(effectiveOwnerId);
      createdCount++;
      createdRows.push(formatCustomerSummary(payload.name, payload.mark, payload.phone));
    } catch (error) {
      issueRows.push(toCustomerImportIssueRow(row, mapPrismaWriteError(error)));
    }
  }

  const totalSuccess = createdCount + updatedCount;
  if (totalSuccess === 0 && issueRows.length > 0) {
    return {
      success: false,
      status: 400,
      message: '导入失败：所有行均未成功',
      details: issueRows.map((row) => `第${row.rowNo}行(NAME=${row.name || '-'})：${row.reason}`),
      issueRows,
      createdCount,
      updatedCount,
      createdRows,
      updatedRows,
    };
  }

  return {
    success: true,
    status: 200,
    message: `导入完成：新增 ${createdCount}，更新 ${updatedCount}，无变更 ${unchangedCount}，失败 ${issueRows.length}`,
    details: issueRows.map((row) => `第${row.rowNo}行(NAME=${row.name || '-'})：${row.reason}`),
    issueRows,
    createdCount,
    updatedCount,
    createdRows,
    updatedRows,
  };
}

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  const denied = managerOnly(currentUser.role as UserRole);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const action = trimStr(searchParams.get('action'));
  const mark = trimStr(searchParams.get('mark'));
  const search = trimStr(searchParams.get('search'));

  if (action === 'owner-options') {
    const options = await listCustomerOwnerOptions({ id: currentUser.id, role: currentUser.role as UserRole });
    return NextResponse.json({ success: true, data: options });
  }

  if (action === 'import-template') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('customer_import');
    sheet.columns = [
      { header: 'MARK', key: 'mark', width: 18 },
      { header: 'ORDER_NAME', key: 'orderName', width: 22 },
      { header: 'NAME', key: 'name', width: 22 },
      { header: 'PHONE', key: 'phone', width: 18 },
      { header: 'CITY', key: 'city', width: 18 },
      { header: 'CONSIGNEE', key: 'consignee', width: 20 },
      { header: 'COMPANY_NAME', key: 'companyName', width: 24 },
      { header: 'CREDIT', key: 'credit', width: 12 },
      { header: 'COMPANY_ADDRESS', key: 'companyAddress', width: 30 },
      { header: 'SALES_EMAIL', key: 'salesEmail', width: 28 },
    ];
    sheet.addRow({
      mark: 'MAB-1',
      orderName: 'MAB-1',
      name: 'MAB TRADING',
      phone: '622443103',
      city: 'Conakry',
      consignee: 'Ahmadou Diallo',
      companyName: 'MAB Co.,Ltd',
      credit: 30000,
      companyAddress: 'Conakry, Guinea',
      salesEmail: '',
    });
    sheet.getRow(1).font = { bold: true };
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(Buffer.from(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="customer-import-template.xlsx"',
      },
    });
  }

  const where: Record<string, unknown> = {
    ...customerAccessWhere(currentUser),
  };
  if (mark) {
    where.mark = { equals: mark };
  } else if (search) {
    where.OR = [
      { mark: { contains: search } },
      { orderName: { contains: search } },
      { name: { contains: search } },
      { phone: { contains: search } },
      { city: { contains: search } },
      { consignee: { contains: search } },
    ];
  }

  const rows = await db.customer.findMany({
    where,
    include: {
      owner: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          level: true,
        },
      },
    },
    orderBy: [{ mark: 'asc' }, { createdAt: 'desc' }],
  });

  if (currentUser.role === UserRole.ADMIN) {
    return NextResponse.json({ success: true, data: rows });
  }

  const showExtended = await canSalesEditExtendedFields();
  return NextResponse.json({ success: true, data: rows.map((row) => toSalesView(row as Record<string, unknown>, showExtended)) });
});

export const POST = withAuth(async (request: NextRequest, currentUser) => {
  const denied = managerOnly(currentUser.role as UserRole);
  if (denied) return denied;

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const action = trimStr(formData.get('action'));
    if (action !== 'import-excel') {
      return NextResponse.json({ success: false, error: '未知上传操作' }, { status: 400 });
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: '请上传Excel文件' }, { status: 400 });
    }

    let ownerId: string;
    try {
      ownerId = await resolveCustomerOwnerId(currentUser, trimStr(formData.get('ownerId')) || null);
    } catch (error) {
      return NextResponse.json({ success: false, error: mapPrismaWriteError(error) }, { status: 400 });
    }

    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = await file.arrayBuffer();
    await workbook.xlsx.load(Buffer.from(arrayBuffer));
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return NextResponse.json({ success: false, error: 'Excel为空' }, { status: 400 });
    }

    const headerRow = sheet.getRow(1);
    const headerMap = new Map<string, number>();
    for (let i = 1; i <= sheet.columnCount; i++) {
      const key = trimStr(headerRow.getCell(i).value).toUpperCase();
      if (key) headerMap.set(key, i);
    }
    const requiredHeaders = ['MARK', 'ORDER_NAME', 'NAME', 'PHONE', 'CITY', 'CONSIGNEE'];
    const missing = requiredHeaders.filter((h) => !headerMap.has(h));
    if (missing.length > 0) {
      return NextResponse.json({ success: false, error: `模板缺少列: ${missing.join(', ')}` }, { status: 400 });
    }

    const rows: ImportRow[] = [];
    for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo++) {
      const row = sheet.getRow(rowNo);
      const payload: CustomerPayload = {
        mark: trimStr(row.getCell(headerMap.get('MARK')!).value),
        orderName: trimStr(row.getCell(headerMap.get('ORDER_NAME')!).value),
        name: trimStr(row.getCell(headerMap.get('NAME')!).value),
        phone: trimStr(row.getCell(headerMap.get('PHONE')!).value),
        city: trimStr(row.getCell(headerMap.get('CITY')!).value),
        consignee: trimStr(row.getCell(headerMap.get('CONSIGNEE')!).value) || null,
        companyName: headerMap.has('COMPANY_NAME') ? trimStr(row.getCell(headerMap.get('COMPANY_NAME')!).value) || null : null,
        companyAddress: headerMap.has('COMPANY_ADDRESS') ? trimStr(row.getCell(headerMap.get('COMPANY_ADDRESS')!).value) || null : null,
        credit: headerMap.has('CREDIT')
          ? (() => {
              const raw = trimStr(row.getCell(headerMap.get('CREDIT')!).value);
              if (!raw) return null;
              const num = Number(raw);
              return Number.isFinite(num) ? num : Number.NaN;
            })()
          : null,
      };

      if (!payload.mark && !payload.orderName && !payload.name && !payload.phone && !payload.city && !payload.consignee) continue;
      rows.push({
        rowNo,
        payload,
        ownerEmail: headerMap.has('SALES_EMAIL') ? trimStr(row.getCell(headerMap.get('SALES_EMAIL')!).value).toLowerCase() || null : null,
      });
    }

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: '没有可导入的数据行' }, { status: 400 });
    }

    const showExtended = currentUser.role === UserRole.ADMIN || (await canSalesEditExtendedFields());
    const processed = await processCustomerImportRows(rows, currentUser as { id: string; role: UserRole }, ownerId, showExtended);
    return NextResponse.json(
      {
        success: processed.success,
        message: processed.message,
        error: processed.success ? undefined : processed.message,
        details: processed.details.slice(0, 200),
        issueRows: processed.issueRows.slice(0, 200),
        data: {
          createdCount: processed.createdCount,
          updatedCount: processed.updatedCount,
          failedCount: processed.issueRows.length,
          createdRows: processed.createdRows.slice(0, 500),
          updatedRows: processed.updatedRows.slice(0, 500),
        },
      },
      { status: processed.status }
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = trimStr(body.action);

  if (action === 'import-rows') {
    const rowsInput = Array.isArray(body.rows) ? body.rows : [];
    const rows: ImportRow[] = rowsInput.map((raw, index) => {
      const row = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
      const creditRaw = trimStr(row.credit);
      const credit = creditRaw === '' ? null : Number(creditRaw);
      return {
        rowNo: Number(row.rowNo) || index + 1,
        ownerEmail: trimStr(row.ownerEmail).toLowerCase() || null,
        payload: {
          mark: trimStr(row.mark),
          orderName: trimStr(row.orderName),
          name: trimStr(row.name),
          phone: trimStr(row.phone),
          city: trimStr(row.city),
          consignee: trimStr(row.consignee) || null,
          companyName: trimStr(row.companyName) || null,
          companyAddress: trimStr(row.companyAddress) || null,
          credit: creditRaw === '' ? null : (Number.isFinite(credit) ? credit : Number.NaN),
        },
      };
    });
    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: '没有可导入的数据行' }, { status: 400 });
    }

    let ownerId: string;
    try {
      ownerId = await resolveCustomerOwnerId(currentUser, trimStr(body.ownerId) || null);
    } catch (innerError) {
      return NextResponse.json({ success: false, error: mapPrismaWriteError(innerError) }, { status: 400 });
    }
    const showExtended = currentUser.role === UserRole.ADMIN || (await canSalesEditExtendedFields());
    const processed = await processCustomerImportRows(rows, currentUser as { id: string; role: UserRole }, ownerId, showExtended);
    return NextResponse.json(
      {
        success: processed.success,
        message: processed.message,
        error: processed.success ? undefined : processed.message,
        details: processed.details.slice(0, 200),
        issueRows: processed.issueRows.slice(0, 200),
        data: {
          createdCount: processed.createdCount,
          updatedCount: processed.updatedCount,
          failedCount: processed.issueRows.length,
          createdRows: processed.createdRows.slice(0, 500),
          updatedRows: processed.updatedRows.slice(0, 500),
        },
      },
      { status: processed.status }
    );
  }

  if (action === 'create') {
    const payload = parsePayload(body);
    const error = validateRequired(payload);
    if (error) return NextResponse.json({ success: false, error }, { status: 400 });

    const showExtended = currentUser.role === UserRole.ADMIN || (await canSalesEditExtendedFields());

    let ownerId: string;
    try {
      ownerId = await resolveCustomerOwnerId(currentUser, trimStr(body.ownerId) || null);
      await assertNoCustomerScopeConflict(ownerId, {
        orderName: payload.orderName!,
        phone: payload.phone!,
        companyName: showExtended ? payload.companyName || null : null,
      });
    } catch (innerError) {
      return NextResponse.json({ success: false, error: mapPrismaWriteError(innerError) }, { status: 400 });
    }

    try {
      const created = await db.customer.create({
        data: {
          mark: payload.mark!,
          orderName: payload.orderName!,
          name: payload.name!,
          phone: payload.phone!,
          city: payload.city!,
          consignee: payload.consignee || null,
          companyName: showExtended ? payload.companyName : null,
          companyAddress: showExtended ? payload.companyAddress : null,
          credit: showExtended ? payload.credit : null,
          createdBy: currentUser.id,
          ownerId,
        },
      });

      if (currentUser.role === UserRole.ADMIN) {
        return NextResponse.json({ success: true, data: created });
      }
      return NextResponse.json({ success: true, data: toSalesView(created as Record<string, unknown>, showExtended) });
    } catch (createError) {
      return NextResponse.json({ success: false, error: mapPrismaWriteError(createError) }, { status: 400 });
    }
  }

  if (action === 'update') {
    const id = trimStr(body.id);
    if (!id) return NextResponse.json({ success: false, error: '客户ID不能为空' }, { status: 400 });

    const existing = await db.customer.findUnique({
      where: { id },
      select: { id: true, ownerId: true },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: '客户不存在' }, { status: 404 });
    }
    if (!canMutateCustomer(currentUser, existing.ownerId)) {
      return NextResponse.json({ success: false, error: '无权修改该客户' }, { status: 403 });
    }

    const payload = parsePayload(body);
    const error = validateRequired(payload);
    if (error) return NextResponse.json({ success: false, error }, { status: 400 });

    const showExtended = currentUser.role === UserRole.ADMIN || (await canSalesEditExtendedFields());

    let ownerId = existing.ownerId;
    try {
      ownerId = await resolveCustomerOwnerId(currentUser, trimStr(body.ownerId) || existing.ownerId);
      await assertNoCustomerScopeConflict(
        ownerId,
        {
          orderName: payload.orderName!,
          phone: payload.phone!,
          companyName: showExtended ? payload.companyName || null : null,
        },
        id
      );
    } catch (innerError) {
      return NextResponse.json({ success: false, error: mapPrismaWriteError(innerError) }, { status: 400 });
    }

    try {
      const updated = await db.customer.update({
        where: { id },
        data: {
          mark: payload.mark!,
          orderName: payload.orderName!,
          name: payload.name!,
          phone: payload.phone!,
          city: payload.city!,
          consignee: payload.consignee || null,
          ownerId,
          ...(showExtended
            ? {
                companyName: payload.companyName,
                companyAddress: payload.companyAddress,
                credit: payload.credit,
              }
            : {}),
        },
      });

      if (currentUser.role === UserRole.ADMIN) {
        return NextResponse.json({ success: true, data: updated });
      }
      return NextResponse.json({ success: true, data: toSalesView(updated as Record<string, unknown>, showExtended) });
    } catch (updateError) {
      return NextResponse.json({ success: false, error: mapPrismaWriteError(updateError) }, { status: 400 });
    }
  }

  if (action === 'delete') {
    if (currentUser.role !== UserRole.ADMIN) {
      return NextResponse.json({ success: false, error: '只有管理员可删除客户' }, { status: 403 });
    }
    const id = trimStr(body.id);
    if (!id) return NextResponse.json({ success: false, error: '客户ID不能为空' }, { status: 400 });

    const existing = await db.customer.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ success: false, error: '客户不存在' }, { status: 404 });
    }

    await db.customer.delete({ where: { id } });
    return NextResponse.json({ success: true, message: '客户已删除' });
  }

  return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
});
