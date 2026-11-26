import {
  buildCustomerVisibilityWhere,
  buildDetailVisibilityWhere,
  buildInvoiceVisibilityWhere,
  buildOrderVisibilityWhere,
  buildReceiptVisibilityWhere,
  buildSwiftVisibilityWhere,
} from '@/lib/resource-visibility';

describe('resource-visibility', () => {
  it('uses customer owner binding for order/invoice/receipt/detail/swift visibility', () => {
    const ownerIds = ['sales-1'];

    expect(buildCustomerVisibilityWhere(ownerIds)).toEqual({
      OR: [
        { ownerId: { in: ownerIds } },
        { orders: { some: { OR: [{ managedById: { in: ownerIds } }, { managedById: null, createdBy: { in: ownerIds } }] } } },
        { receipts: { some: { OR: [{ managedById: { in: ownerIds } }, { managedById: null, createdBy: { in: ownerIds } }] } } },
      ],
    });

    expect(buildOrderVisibilityWhere(ownerIds)).toEqual({
      canceledAt: null,
      OR: [
        { OR: [{ managedById: { in: ownerIds } }, { managedById: null, createdBy: { in: ownerIds } }] },
        { customer: { ownerId: { in: ownerIds } } },
      ],
    });

    expect(buildInvoiceVisibilityWhere(ownerIds)).toEqual({
      canceledAt: null,
      OR: [
        { OR: [{ managedById: { in: ownerIds } }, { managedById: null, createdBy: { in: ownerIds } }] },
        { orders: { some: { OR: [{ managedById: { in: ownerIds } }, { managedById: null, createdBy: { in: ownerIds } }] } } },
        { orders: { some: { customer: { ownerId: { in: ownerIds } } } } },
      ],
    });

    expect(buildReceiptVisibilityWhere(ownerIds)).toEqual({
      OR: [
        { OR: [{ managedById: { in: ownerIds } }, { managedById: null, createdBy: { in: ownerIds } }] },
        { customer: { ownerId: { in: ownerIds } } },
        { order: { OR: [{ managedById: { in: ownerIds } }, { managedById: null, createdBy: { in: ownerIds } }] } },
        { order: { customer: { ownerId: { in: ownerIds } } } },
      ],
    });

    expect(buildDetailVisibilityWhere(ownerIds)).toEqual({
      OR: [
        { OR: [{ managedById: { in: ownerIds } }, { managedById: null, createdBy: { in: ownerIds } }] },
        { items: { some: { receipt: { OR: [{ managedById: { in: ownerIds } }, { managedById: null, createdBy: { in: ownerIds } }] } } } },
        { items: { some: { receipt: { customer: { ownerId: { in: ownerIds } } } } } },
      ],
    });

    expect(buildSwiftVisibilityWhere(ownerIds)).toEqual({
      OR: [
        { OR: [{ managedById: { in: ownerIds } }, { managedById: null, createdBy: { in: ownerIds } }] },
        { detail: { OR: [{ managedById: { in: ownerIds } }, { managedById: null, createdBy: { in: ownerIds } }] } },
        { detail: { items: { some: { receipt: { OR: [{ managedById: { in: ownerIds } }, { managedById: null, createdBy: { in: ownerIds } }] } } } } },
        { detail: { items: { some: { receipt: { customer: { ownerId: { in: ownerIds } } } } } } },
      ],
    });
  });

  it('retains owner scope when reading canceled order and invoice history', () => {
    for (const build of [buildOrderVisibilityWhere, buildInvoiceVisibilityWhere]) {
      const { canceledAt, ...scope } = build(['sales-1']);
      expect(canceledAt).toBeNull();
      expect(build(['sales-1'], true)).toEqual(scope);
      expect(build([], true).OR).not.toHaveLength(0);
    }
  });
});
