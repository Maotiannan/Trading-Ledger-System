import {
  CustomerEmailLanguage,
  EmailNotificationType,
  EmailRecipientMode,
  Prisma,
  UserRole,
} from '@prisma/client';
import { recordAuditEventInTransaction } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { apiErrorCodes, createApiError } from '@/lib/api-error';
import { db } from '@/lib/db';
import { parseOptionalNotificationEmail } from '@/lib/email/email-address';
import {
  EMAIL_TEMPLATE_DEFINITIONS,
  getEmailTemplatePreviewContext,
} from '@/lib/email/email-template-catalog';
import { renderEmailTemplate, validateEmailTemplate } from '@/lib/email/email-template-renderer';
import { DEFAULT_EMAIL_SETTINGS } from '@/lib/email/email-types';
import type {
  CustomerEmailLanguageValue,
  EmailNotificationTypeValue,
  EmailSettings,
} from '@/lib/email/email-types';
import type { CurrentUser } from '@/lib/request-auth';
import {
  emailSystemSettingDefaults,
  emailSystemSettingKeys,
  invalidateSystemSettingsCache,
} from '@/lib/system-settings';
import { runInTransaction, type DbTransactionClient } from '@/lib/transaction';

type EmailSettingsClient = Pick<DbTransactionClient, 'systemSetting' | 'emailTemplate' | 'auditLog'>;
type EmailTemplateClient = Pick<DbTransactionClient, 'emailTemplate'>;

const SETTING_FIELDS = [
  'outboundEnabled',
  'recipientMode',
  'senderName',
  'senderAddress',
  'replyToAddress',
  'retryLimit',
  'retryIntervalsSeconds',
  'testModeEnabled',
  'testDestination',
  'logoUrl',
] as const satisfies readonly (keyof EmailSettings)[];

function assertAdmin(currentUser: CurrentUser): void {
  if (currentUser.role !== UserRole.ADMIN) {
    throw createApiError({
      code: apiErrorCodes.FORBIDDEN,
      status: 403,
      message: '只有管理员可以管理邮件通知',
    });
  }
}

function boolValue(value: string, fallback: boolean): boolean {
  return value === 'true' ? true : value === 'false' ? false : fallback;
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function retryIntervals(value: string): number[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [...DEFAULT_EMAIL_SETTINGS.retryIntervalsSeconds];
    const intervals = parsed.map(Number);
    return intervals.length > 0 && intervals.every((item) => Number.isInteger(item) && item > 0)
      ? intervals
      : [...DEFAULT_EMAIL_SETTINGS.retryIntervalsSeconds];
  } catch {
    return [...DEFAULT_EMAIL_SETTINGS.retryIntervalsSeconds];
  }
}

function settingsFromRows(rows: Array<{ key: string; value: string }>): EmailSettings {
  const values = { ...emailSystemSettingDefaults };
  for (const row of rows) {
    if ((emailSystemSettingKeys as readonly string[]).includes(row.key)) {
      values[row.key as keyof typeof values] = row.value;
    }
  }
  return {
    outboundEnabled: boolValue(values['email.outboundEnabled'], false),
    recipientMode: values['email.recipientMode'] === EmailRecipientMode.SEPARATE ? 'SEPARATE' : 'PRIMARY_CC',
    senderName: values['email.senderName'],
    senderAddress: values['email.senderAddress'],
    replyToAddress: values['email.replyToAddress'],
    retryLimit: positiveInteger(values['email.retryLimit'], 3),
    retryIntervalsSeconds: retryIntervals(values['email.retryIntervalsSeconds']),
    testModeEnabled: boolValue(values['email.testModeEnabled'], true),
    testDestination: values['email.testDestination'],
    logoUrl: values['email.logoUrl'],
  };
}

function settingRows(settings: EmailSettings): Array<{ key: string; value: string }> {
  return [
    { key: 'email.outboundEnabled', value: String(settings.outboundEnabled) },
    { key: 'email.recipientMode', value: settings.recipientMode },
    { key: 'email.senderName', value: settings.senderName },
    { key: 'email.senderAddress', value: settings.senderAddress },
    { key: 'email.replyToAddress', value: settings.replyToAddress },
    { key: 'email.retryLimit', value: String(settings.retryLimit) },
    { key: 'email.retryIntervalsSeconds', value: JSON.stringify(settings.retryIntervalsSeconds) },
    { key: 'email.testModeEnabled', value: String(settings.testModeEnabled) },
    { key: 'email.testDestination', value: settings.testDestination },
    { key: 'email.logoUrl', value: settings.logoUrl },
  ];
}

function inputObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createApiError({ code: apiErrorCodes.BAD_REQUEST, status: 400, message: `${label}格式无效` });
  }
  return value as Record<string, unknown>;
}

function textValue(value: unknown, maxLength: number, label: string): string {
  const text = String(value ?? '').trim();
  if (text.length > maxLength) {
    throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: `${label}过长` });
  }
  return text;
}

function validLogoUrl(value: unknown): string {
  const logoUrl = textValue(value, 2_000, 'Logo URL');
  try {
    if (new URL(logoUrl).protocol !== 'https:') throw new Error('protocol');
  } catch {
    throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: 'Logo URL 必须是有效的 HTTPS 地址' });
  }
  return logoUrl;
}

function mergeAndValidateSettings(current: EmailSettings, input: unknown): EmailSettings {
  const raw = inputObject(input, '邮件设置');
  const unknownKeys = Object.keys(raw).filter((key) => !(SETTING_FIELDS as readonly string[]).includes(key));
  if (unknownKeys.length > 0) {
    throw createApiError({
      code: apiErrorCodes.VALIDATION_ERROR,
      status: 400,
      message: `不支持的邮件设置：${unknownKeys.join(', ')}`,
      detail: { unknownKeys },
    });
  }
  const merged = { ...current };
  if ('outboundEnabled' in raw) {
    if (typeof raw.outboundEnabled !== 'boolean') {
      throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: '外发邮件开关必须是布尔值' });
    }
    merged.outboundEnabled = raw.outboundEnabled;
  }
  if ('testModeEnabled' in raw) {
    if (typeof raw.testModeEnabled !== 'boolean') {
      throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: '测试模式开关必须是布尔值' });
    }
    merged.testModeEnabled = raw.testModeEnabled;
  }
  if ('recipientMode' in raw) {
    const mode = String(raw.recipientMode || '').toUpperCase();
    if (mode !== EmailRecipientMode.PRIMARY_CC && mode !== EmailRecipientMode.SEPARATE) {
      throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: '收件人模式无效' });
    }
    merged.recipientMode = mode;
  }
  if ('senderName' in raw) merged.senderName = textValue(raw.senderName, 200, '发件人名称');
  if ('senderAddress' in raw) merged.senderAddress = parseOptionalNotificationEmail(raw.senderAddress)?.email || '';
  if ('replyToAddress' in raw) merged.replyToAddress = parseOptionalNotificationEmail(raw.replyToAddress)?.email || '';
  if ('testDestination' in raw) merged.testDestination = parseOptionalNotificationEmail(raw.testDestination)?.email || '';
  if ('logoUrl' in raw) merged.logoUrl = validLogoUrl(raw.logoUrl);
  if ('retryLimit' in raw) {
    const limit = Number(raw.retryLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
      throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: '重试次数必须是 1 至 10 的整数' });
    }
    merged.retryLimit = limit;
  }
  if ('retryIntervalsSeconds' in raw) {
    if (!Array.isArray(raw.retryIntervalsSeconds)) {
      throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: '重试间隔格式无效' });
    }
    const intervals = raw.retryIntervalsSeconds.map(Number);
    if (intervals.length === 0 || intervals.length > 10 || intervals.some((item) => !Number.isInteger(item) || item < 1 || item > 86_400)) {
      throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: '重试间隔必须是 1 至 86400 秒的整数列表' });
    }
    merged.retryIntervalsSeconds = intervals;
  }
  if (merged.retryIntervalsSeconds.length < merged.retryLimit) {
    throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: '重试间隔数量不能少于重试次数' });
  }
  merged.logoUrl = validLogoUrl(merged.logoUrl);
  if (merged.outboundEnabled) {
    if (!merged.senderName) {
      throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: '启用邮件发送前必须填写发件人名称' });
    }
    if (!merged.senderAddress) {
      throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: '启用邮件发送前必须填写 sender address（发件邮箱）' });
    }
    if (merged.testModeEnabled && !merged.testDestination) {
      throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: '测试模式启用时必须填写测试收件邮箱' });
    }
  }
  return merged;
}

function serializeTemplate(row: {
  id: string;
  type: EmailNotificationType;
  language: CustomerEmailLanguage;
  version: number;
  subjectTemplate: string;
  bodyTemplate: string;
  requiredVariables: Prisma.JsonValue;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    type: row.type,
    language: row.language,
    version: row.version,
    subjectTemplate: row.subjectTemplate,
    bodyTemplate: row.bodyTemplate,
    requiredVariables: Array.isArray(row.requiredVariables)
      ? row.requiredVariables.map(String)
      : [],
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseTemplateType(value: unknown): EmailNotificationTypeValue {
  const type = String(value || '').toUpperCase();
  if (type === 'PAYMENT_RECEIVED' || type === 'SHIPMENT' || type === 'RELEASE') return type;
  throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: '邮件类型无效' });
}

function parseTemplateLanguage(value: unknown): CustomerEmailLanguageValue {
  const language = String(value || '').toUpperCase();
  if (language === 'ENGLISH' || language === 'FRENCH') return language;
  throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: '邮件语言无效' });
}

export async function getEmailSettings(client: Pick<EmailSettingsClient, 'systemSetting'> = db): Promise<EmailSettings> {
  const rows = await client.systemSetting.findMany({
    where: { key: { in: [...emailSystemSettingKeys] } },
    select: { key: true, value: true },
  });
  return settingsFromRows(rows);
}

async function seedDefaultTemplates(client: EmailTemplateClient): Promise<void> {
  const existing = await client.emailTemplate.findMany({
    select: { type: true, language: true, version: true, isActive: true },
  });
  const active = new Set(existing.filter((row) => row.isActive).map((row) => `${row.type}:${row.language}`));
  const rows = EMAIL_TEMPLATE_DEFINITIONS.flatMap((definition) => {
    const key = `${definition.type}:${definition.language}`;
    if (active.has(key)) return [];
    const maxVersion = existing.reduce((max, row) => (
      row.type === definition.type && row.language === definition.language ? Math.max(max, row.version) : max
    ), 0);
    return [{
      type: definition.type,
      language: definition.language,
      version: maxVersion + 1,
      subjectTemplate: definition.subjectTemplate,
      bodyTemplate: definition.bodyTemplate,
      requiredVariables: definition.requiredVariables,
      isActive: true,
    }];
  });
  if (rows.length > 0) {
    await client.emailTemplate.createMany({ data: rows, skipDuplicates: true });
  }
}

export async function ensureDefaultEmailTemplates(client?: EmailTemplateClient): Promise<void> {
  if (client) {
    await seedDefaultTemplates(client);
    return;
  }
  await runInTransaction(async (tx) => seedDefaultTemplates(tx));
}

export async function listActiveEmailTemplates(client: EmailTemplateClient = db) {
  const rows = await client.emailTemplate.findMany({
    where: { isActive: true },
    orderBy: [{ type: 'asc' }, { language: 'asc' }],
  });
  return rows.map(serializeTemplate);
}

export async function updateEmailSettings(currentUser: CurrentUser, input: unknown) {
  assertAdmin(currentUser);
  const raw = inputObject(input, '邮件设置');
  const unknownKeys = Object.keys(raw).filter((key) => !(SETTING_FIELDS as readonly string[]).includes(key));
  if (unknownKeys.length > 0) {
    throw createApiError({
      code: apiErrorCodes.VALIDATION_ERROR,
      status: 400,
      message: `不支持的邮件设置：${unknownKeys.join(', ')}`,
    });
  }
  const result = await runInTransaction(async (tx) => {
    const current = await getEmailSettings(tx);
    const settings = mergeAndValidateSettings(current, raw);
    if (settings.outboundEnabled) {
      await seedDefaultTemplates(tx);
      const templates = await tx.emailTemplate.findMany({ where: { isActive: true } });
      const activeTemplateKeys = new Set(templates.map((template) => `${template.type}:${template.language}`));
      const requiredTemplateKeys = new Set(EMAIL_TEMPLATE_DEFINITIONS.map((template) => `${template.type}:${template.language}`));
      if (
        templates.length !== EMAIL_TEMPLATE_DEFINITIONS.length
        || activeTemplateKeys.size !== requiredTemplateKeys.size
        || [...requiredTemplateKeys].some((key) => !activeTemplateKeys.has(key))
      ) {
        throw createApiError({ code: apiErrorCodes.CONFLICT, status: 409, message: '六套邮件模板尚未准备完整' });
      }
      for (const template of templates) {
        validateEmailTemplate({
          type: template.type,
          language: template.language,
          subjectTemplate: template.subjectTemplate,
          bodyTemplate: template.bodyTemplate,
        });
      }
    }
    const beforeRows = settingRows(current);
    const afterRows = settingRows(settings);
    const before = new Map(beforeRows.map((item) => [item.key, item.value]));
    const changes = afterRows.filter((item) => before.get(item.key) !== item.value);
    for (const item of changes) {
      await tx.systemSetting.upsert({
        where: { key: item.key },
        create: { key: item.key, value: item.value, updatedBy: currentUser.id },
        update: { value: item.value, updatedBy: currentUser.id },
      });
    }
    if (changes.length > 0) {
      await recordAuditEventInTransaction(tx, {
        action: auditActions.EMAIL_SETTINGS_UPDATE,
        actorId: currentUser.id,
        targetType: auditTargetTypes.SYSTEM_SETTING,
        metadata: {
          updatedKeys: changes.map((item) => item.key),
          changes: changes.map((item) => ({ key: item.key, before: before.get(item.key) || '', after: item.value })),
        },
      });
    }
    return settings;
  });
  invalidateSystemSettingsCache();
  return { settings: result, message: '邮件通知设置已保存' };
}

export async function saveEmailTemplate(currentUser: CurrentUser, input: unknown) {
  assertAdmin(currentUser);
  const raw = inputObject(input, '邮件模板');
  const type = parseTemplateType(raw.type);
  const language = parseTemplateLanguage(raw.language);
  const subjectTemplate = textValue(raw.subjectTemplate, 500, '邮件主题');
  const bodyTemplate = textValue(raw.bodyTemplate, 50_000, '邮件正文');
  const validation = validateEmailTemplate({ type, language, subjectTemplate, bodyTemplate });
  const created = await runInTransaction(async (tx) => {
    const latest = await tx.emailTemplate.findFirst({
      where: { type, language },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    await tx.emailTemplate.updateMany({
      where: { type, language, isActive: true },
      data: { isActive: false },
    });
    const template = await tx.emailTemplate.create({
      data: {
        type,
        language,
        version: (latest?.version || 0) + 1,
        subjectTemplate,
        bodyTemplate,
        requiredVariables: validation.requiredVariables,
        isActive: true,
        createdBy: currentUser.id,
      },
    });
    await recordAuditEventInTransaction(tx, {
      action: auditActions.EMAIL_TEMPLATE_UPDATE,
      actorId: currentUser.id,
      targetType: auditTargetTypes.EMAIL_TEMPLATE,
      targetId: template.id,
      metadata: { type, language, version: template.version },
    });
    return template;
  });
  return { template: serializeTemplate(created), message: '邮件模板已保存为新版本' };
}

export async function previewEmailTemplate(currentUser: CurrentUser, input: unknown) {
  assertAdmin(currentUser);
  const raw = inputObject(input, '邮件模板');
  const type = parseTemplateType(raw.type);
  const language = parseTemplateLanguage(raw.language);
  const subjectTemplate = textValue(raw.subjectTemplate, 500, '邮件主题');
  const bodyTemplate = textValue(raw.bodyTemplate, 50_000, '邮件正文');
  const version = Number.isInteger(Number(raw.version)) && Number(raw.version) > 0 ? Number(raw.version) : 1;
  const settings = await getEmailSettings();
  const preview = renderEmailTemplate({ type, language, version, subjectTemplate, bodyTemplate }, getEmailTemplatePreviewContext(type), {
    logoUrl: settings.logoUrl,
  });
  return { preview, message: '邮件模板预览已生成' };
}
