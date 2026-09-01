import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import {
  ensureDefaultEmailTemplates,
  getEmailSettings,
  updateEmailSettings,
  saveEmailTemplate,
} from '@/lib/email/email-settings';

jest.mock('@/lib/db', () => ({
  db: {
    systemSetting: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    emailTemplate: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

const mockDb = db as unknown as {
  systemSetting: { findMany: jest.Mock; upsert: jest.Mock };
  emailTemplate: { findMany: jest.Mock; createMany: jest.Mock; findFirst: jest.Mock; updateMany: jest.Mock; create: jest.Mock };
  auditLog: { create: jest.Mock };
  $transaction: jest.Mock;
};

const admin = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: UserRole.ADMIN,
  level: 1,
  parentId: null,
  createdById: null,
};

describe('email settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.systemSetting.findMany.mockResolvedValue([]);
    mockDb.emailTemplate.findMany.mockResolvedValue([]);
    mockDb.emailTemplate.createMany.mockResolvedValue({ count: 6 });
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => Promise<unknown>) => callback(mockDb));
  });

  it('uses safe disabled defaults without exposing provider secrets', async () => {
    const settings = await getEmailSettings();

    expect(settings).toEqual({
      outboundEnabled: false,
      recipientMode: 'PRIMARY_CC',
      senderName: 'MU LEDGER',
      senderAddress: '',
      replyToAddress: '',
      retryLimit: 3,
      retryIntervalsSeconds: [60, 300, 1800],
      testModeEnabled: true,
      testDestination: '',
      logoUrl: 'https://muledger.dainty.vip/logo.svg',
    });
    expect(JSON.stringify(settings)).not.toMatch(/RESEND|API_KEY|WEBHOOK_SECRET/i);
  });

  it('seeds exactly six version-one templates and remains idempotent', async () => {
    await ensureDefaultEmailTemplates(mockDb as never);

    expect(mockDb.emailTemplate.createMany).toHaveBeenCalledTimes(1);
    const input = mockDb.emailTemplate.createMany.mock.calls[0][0];
    expect(input.data).toHaveLength(6);
    expect(input.data.every((item: { version: number; isActive: boolean }) => item.version === 1 && item.isActive)).toBe(true);

    mockDb.emailTemplate.findMany.mockResolvedValue(input.data);
    await ensureDefaultEmailTemplates(mockDb as never);
    expect(mockDb.emailTemplate.createMany).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe outbound activation and all provider-secret input', async () => {
    await expect(updateEmailSettings(admin, {
      outboundEnabled: true,
      recipientMode: 'PRIMARY_CC',
      senderName: 'MU LEDGER',
      senderAddress: '',
      replyToAddress: '',
      retryLimit: 3,
      retryIntervalsSeconds: [60, 300, 1800],
      testModeEnabled: true,
      testDestination: '',
      logoUrl: 'https://muledger.dainty.vip/logo.svg',
    })).rejects.toThrow(/sender|发件/i);

    await expect(updateEmailSettings(admin, {
      outboundEnabled: false,
      RESEND_API_KEY: 'must-not-be-stored',
    } as never)).rejects.toThrow(/RESEND_API_KEY|不支持|unknown/i);
    expect(mockDb.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it('denies SALES accounts even when outbound remains disabled', async () => {
    await expect(updateEmailSettings({ ...admin, role: UserRole.SALES }, {
      outboundEnabled: false,
    })).rejects.toMatchObject({ status: 403 });
  });

  it('saves template edits as a new version without rewriting old template content', async () => {
    mockDb.emailTemplate.findFirst.mockResolvedValue({ version: 4 });
    mockDb.emailTemplate.updateMany.mockResolvedValue({ count: 1 });
    mockDb.emailTemplate.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'template-5',
      ...data,
      requiredVariables: data.requiredVariables,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    }));

    const result = await saveEmailTemplate(admin, {
      type: 'PAYMENT_RECEIVED',
      language: 'ENGLISH',
      subjectTemplate: 'Receipt {{receiptNo}}',
      bodyTemplate: '{{customerName}} {{mark}} {{orderNos}} {{receiptNo}} {{amount}} {{paymentDate}}',
    });

    expect(mockDb.emailTemplate.updateMany).toHaveBeenCalledWith({
      where: { type: 'PAYMENT_RECEIVED', language: 'ENGLISH', isActive: true },
      data: { isActive: false },
    });
    expect(mockDb.emailTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ version: 5, subjectTemplate: 'Receipt {{receiptNo}}' }),
    }));
    expect(result.template.version).toBe(5);
  });
});
