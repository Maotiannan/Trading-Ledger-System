import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { listPaymentAgents } from '@/lib/payment-agent-service';
import { getOwnerVisibleIds } from '@/lib/resource-visibility';

jest.mock('@/lib/db', () => ({
  db: {
    paymentAgent: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock('@/lib/resource-visibility', () => ({
  getOwnerVisibleIds: jest.fn(),
}));

jest.mock('@/lib/ownership', () => ({
  canAccessOwnedResourceAsync: jest.fn(),
}));

jest.mock('@/lib/uploaded-asset-service', () => ({
  attachUploadedAssetByPath: jest.fn(),
  resolveUploadedAssetAbsolutePath: jest.fn((value: string) => value),
}));

const mockDb = db as unknown as {
  paymentAgent: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
  };
};
const mockGetOwnerVisibleIds = getOwnerVisibleIds as jest.Mock;

const currentUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: UserRole.ADMIN,
  level: 1,
  parentId: null,
  createdById: null,
};

describe('payment-agent-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOwnerVisibleIds.mockResolvedValue(['admin-1']);
  });

  it('creates a default Mitty Group payment agent when none exists in the visible scope', async () => {
    mockDb.paymentAgent.findFirst.mockResolvedValueOnce(null);
    mockDb.paymentAgent.create.mockResolvedValueOnce({
      id: 'agent-default',
      companyName: 'Mitty Group',
      companyAddress: null,
      contactName: null,
      contactPhone: null,
      createdBy: 'admin-1',
    });
    mockDb.paymentAgent.findMany.mockResolvedValueOnce([{
      id: 'agent-default',
      companyName: 'Mitty Group',
      companyAddress: null,
      contactName: null,
      contactPhone: null,
      createdBy: 'admin-1',
      createdAt: new Date('2026-05-06T00:00:00.000Z'),
      updatedAt: new Date('2026-05-06T00:00:00.000Z'),
      creator: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
      files: [],
    }]);

    const agents = await listPaymentAgents(currentUser);

    expect(mockDb.paymentAgent.create).toHaveBeenCalledWith({
      data: {
        companyName: 'Mitty Group',
        companyAddress: null,
        contactName: null,
        contactPhone: null,
        createdBy: 'admin-1',
      },
    });
    expect(agents).toEqual([
      expect.objectContaining({
        id: 'agent-default',
        companyName: 'Mitty Group',
      }),
    ]);
  });
});
