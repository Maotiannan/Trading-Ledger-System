import {
  buildDetailVisibilityWhere,
  buildInvoiceVisibilityWhere,
  buildOrderVisibilityWhere,
  buildReceiptVisibilityWhere,
  buildSwiftVisibilityWhere,
} from '@/lib/resource-visibility';

describe('resource-visibility', () => {
  it('uses customer owner binding for order/invoice/receipt/detail/swift visibility', () => {
    const ownerIds = ['sales-1'];

    expect(buildOrderVisibilityWhere(ownerIds)).toEqual({
      OR: [
        { createdBy: { in: ownerIds } },
        { customer: { ownerId: { in: ownerIds } } },
      ],
    });

    expect(buildInvoiceVisibilityWhere(ownerIds)).toEqual({
      OR: [
        { createdBy: { in: ownerIds } },
        { orders: { some: { createdBy: { in: ownerIds } } } },
        { orders: { some: { customer: { ownerId: { in: ownerIds } } } } },
      ],
    });

    expect(buildReceiptVisibilityWhere(ownerIds)).toEqual({
      OR: [
        { createdBy: { in: ownerIds } },
        { customer: { ownerId: { in: ownerIds } } },
        { order: { createdBy: { in: ownerIds } } },
        { order: { customer: { ownerId: { in: ownerIds } } } },
      ],
    });

    expect(buildDetailVisibilityWhere(ownerIds)).toEqual({
      OR: [
        { createdBy: { in: ownerIds } },
        { items: { some: { receipt: { createdBy: { in: ownerIds } } } } },
        { items: { some: { receipt: { customer: { ownerId: { in: ownerIds } } } } } },
      ],
    });

    expect(buildSwiftVisibilityWhere(ownerIds)).toEqual({
      OR: [
        { createdBy: { in: ownerIds } },
        { detail: { createdBy: { in: ownerIds } } },
        { detail: { items: { some: { receipt: { createdBy: { in: ownerIds } } } } } },
        { detail: { items: { some: { receipt: { customer: { ownerId: { in: ownerIds } } } } } } },
      ],
    });
  });
});
