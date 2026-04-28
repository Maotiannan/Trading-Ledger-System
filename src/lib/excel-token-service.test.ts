import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import {
  generateExcelApiToken,
  listExcelApiTokens,
  revokeExcelApiToken,
  verifyExcelApiTokenFromHeader,
} from '@/lib/excel-token-service';

jest.mock('@/lib/db', () => ({
  db: {
    excelApiToken: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
  },
}));

const mockDb = db as unknown as {
  excelApiToken: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    create: jest.Mock;
  };
};

const currentUser = {
  id: 'sales-1',
  email: 'sales@example.com',
  name: 'Sales',
  role: UserRole.SALES,
  level: 3,
  parentId: 'admin-1',
  createdById: 'admin-1',
};

function mockCreatedToken(overrides: Record<string, unknown> = {}) {
  mockDb.excelApiToken.create.mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'token-1',
    ...data,
    createdAt: new Date('2026-04-28T08:00:00.000Z'),
    updatedAt: new Date('2026-04-28T08:00:00.000Z'),
    lastUsedAt: null,
    lastUsedIp: null,
    revokedAt: null,
    expiresAt: null,
    ...overrides,
  }));
}

describe('excel-token-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.excelApiToken.updateMany.mockResolvedValue({ count: 0 });
    mockDb.excelApiToken.update.mockResolvedValue({});
    mockDb.excelApiToken.findMany.mockResolvedValue([]);
  });

  it('generates a one-time raw token and stores only its hash', async () => {
    mockCreatedToken();

    const result = await generateExcelApiToken(currentUser, 'Excel desktop');
    const createCall = mockDb.excelApiToken.create.mock.calls[0][0];

    expect(result.token).toMatch(/^ml_[A-Za-z0-9_-]{10,}_[A-Za-z0-9_-]{32,}$/);
    expect(result.tokenInfo).toEqual(expect.objectContaining({
      id: 'token-1',
      name: 'Excel desktop',
      tokenPrefix: expect.any(String),
      revokedAt: null,
    }));
    expect(createCall.data).toEqual(expect.objectContaining({
      userId: 'sales-1',
      name: 'Excel desktop',
      tokenPrefix: result.tokenInfo.tokenPrefix,
      tokenHash: expect.any(String),
    }));
    expect(createCall.data.tokenHash).not.toContain(result.token);
    expect(createCall.data.tokenHash).not.toEqual(result.token);
    expect(mockDb.excelApiToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'sales-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('lists only current user token summaries without hashes', async () => {
    mockDb.excelApiToken.findMany.mockResolvedValueOnce([
      {
        id: 'token-1',
        name: 'Excel ML',
        tokenPrefix: 'prefix123456',
        createdAt: new Date('2026-04-28T08:00:00.000Z'),
        updatedAt: new Date('2026-04-28T08:00:00.000Z'),
        lastUsedAt: null,
        lastUsedIp: null,
        revokedAt: null,
        expiresAt: null,
        tokenHash: 'secret-hash',
      },
    ]);

    const result = await listExcelApiTokens(currentUser);

    expect(mockDb.excelApiToken.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'sales-1' },
    }));
    expect(result).toEqual([
      expect.not.objectContaining({ tokenHash: expect.anything() }),
    ]);
    expect(result[0]).toEqual(expect.objectContaining({
      id: 'token-1',
      tokenPrefix: 'prefix123456',
    }));
  });

  it('verifies a bearer token and returns the token owner as CurrentUser', async () => {
    mockCreatedToken();
    const generated = await generateExcelApiToken(currentUser, 'Excel desktop');
    const createCall = mockDb.excelApiToken.create.mock.calls[0][0];

    mockDb.excelApiToken.findUnique.mockResolvedValueOnce({
      id: 'token-1',
      tokenHash: createCall.data.tokenHash,
      tokenPrefix: generated.tokenInfo.tokenPrefix,
      revokedAt: null,
      expiresAt: null,
      user: currentUser,
    });

    const auth = await verifyExcelApiTokenFromHeader(`Bearer ${generated.token}`, '127.0.0.1');

    expect(auth).toEqual({ user: currentUser, tokenId: 'token-1' });
    expect(mockDb.excelApiToken.update).toHaveBeenCalledWith({
      where: { id: 'token-1' },
      data: { lastUsedAt: expect.any(Date), lastUsedIp: '127.0.0.1' },
    });
  });

  it('rejects missing and malformed tokens with stable API errors', async () => {
    await expect(verifyExcelApiTokenFromHeader('', null)).rejects.toMatchObject({
      code: 'EXCEL_TOKEN_REQUIRED',
      status: 401,
    });
    await expect(verifyExcelApiTokenFromHeader('Bearer bad', null)).rejects.toMatchObject({
      code: 'EXCEL_TOKEN_INVALID',
      status: 401,
    });
    expect(mockDb.excelApiToken.findUnique).not.toHaveBeenCalled();
  });

  it('rejects revoked and expired tokens', async () => {
    mockCreatedToken();
    const generated = await generateExcelApiToken(currentUser, 'Excel desktop');
    const createCall = mockDb.excelApiToken.create.mock.calls[0][0];

    mockDb.excelApiToken.findUnique.mockResolvedValueOnce({
      id: 'token-1',
      tokenHash: createCall.data.tokenHash,
      tokenPrefix: generated.tokenInfo.tokenPrefix,
      revokedAt: new Date('2026-04-28T09:00:00.000Z'),
      expiresAt: null,
      user: currentUser,
    });
    await expect(verifyExcelApiTokenFromHeader(`Bearer ${generated.token}`, null)).rejects.toMatchObject({
      code: 'EXCEL_TOKEN_REVOKED',
      status: 401,
    });

    mockDb.excelApiToken.findUnique.mockResolvedValueOnce({
      id: 'token-1',
      tokenHash: createCall.data.tokenHash,
      tokenPrefix: generated.tokenInfo.tokenPrefix,
      revokedAt: null,
      expiresAt: new Date('2026-04-28T00:00:00.000Z'),
      user: currentUser,
    });
    await expect(verifyExcelApiTokenFromHeader(`Bearer ${generated.token}`, null)).rejects.toMatchObject({
      code: 'EXCEL_TOKEN_EXPIRED',
      status: 401,
    });
  });

  it('revokes only a token owned by the current user', async () => {
    mockDb.excelApiToken.updateMany.mockResolvedValueOnce({ count: 1 });

    await revokeExcelApiToken(currentUser, 'token-1');

    expect(mockDb.excelApiToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'token-1', userId: 'sales-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
