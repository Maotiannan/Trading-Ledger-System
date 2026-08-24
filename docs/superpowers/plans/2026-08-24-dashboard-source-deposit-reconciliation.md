# Dashboard Customer Detail, MU Contract Source Recovery, and Deposit Pool Reconciliation Implementation Plan

> **Status:** `ARCHIVED_COMPLETED` on 2026-08-24. The original checkboxes below are preserved as execution history; actual commits and verification evidence are recorded in `ENGINEERING_LOG.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both Dashboard customer entry points open one complete customer detail dialog, let recreated MU Contract PIs replace inactive sources safely, and move matched `DEPOSIT_POOL` orders into formal invoices during writes or explicit Rematch repair.

**Architecture:** Extract Dashboard outstanding aggregation into a pure shared service and compose one Dashboard customer-detail dialog from the existing history tables. Add a transaction-aware system-pool reconciliation module used by manual invoice creation, bulk import, and Rematch. Change MU Contract source occupancy from a binary collision check to an active/inactive claim decision while preserving all source history.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 6/MySQL, Jest and Testing Library, existing transaction/audit/visibility/matching services.

## Global Constraints

- Do not use subagents unless the user explicitly requests them.
- Do not run Docker rebuilds or touch the existing business data service during implementation.
- All financial balances use `computeOrderBalanceFromReceipts` and `updateOrderBalance`; do not add another formula.
- All ORDER NO lookups use the existing alias/composite matcher; do not use fuzzy customer or invoice guesses.
- `DEPOSIT_POOL` and `Un_Associated` are system pools and must never win over a formal invoice during duplicate cleanup.
- Manual historical repair is ADMIN-only, visibility-scoped, explicit, transactional, and audited.
- No database migration, media-path change, or backup-scope change is required.
- Bump the single package version from `1.0.210` to `1.0.211` only after all targeted tests pass.
- Before any final PR/push/rebuild step, fetch and reconcile the latest `main`; if GitHub remains unavailable, stop and report rather than claiming synchronization.

---

### Task 1: Shared Dashboard outstanding snapshot

**Files:**
- Create: `src/lib/dashboard-customer-outstanding.ts`
- Create: `src/lib/dashboard-customer-outstanding.test.ts`
- Modify: `src/lib/dashboard-summary-service.ts`
- Modify: `src/lib/dashboard-customer-history-service.ts`
- Modify: `src/lib/dashboard-customer-history-service.test.ts`
- Modify: `src/app/api/dashboard/customer-history-search/route.test.ts`

**Interfaces:**
- Produces: `buildDashboardOutstandingSnapshot(invoices, nowMs)` returning `{ orderBalances, unpaidTotal, releasedInvoices, customerOutstanding }`.
- Produces: `dashboardOutstandingInvoiceSelect(orderWhere)` returning the shared Prisma invoice selection used by summary and customer detail reads.
- Produces: `DashboardCustomerOutstanding` with explicit `customerId: string | null`.
- Extends: Dashboard history API data with `outstanding: DashboardCustomerOutstanding | null`.
- Consumes: `computeOrderBalanceFromReceipts`, `formatOrderNameDisplay`, and existing visibility filters.

- [ ] **Step 1: Write failing pure aggregation tests**

Add fixtures proving one customer is grouped into Released and In Transit, balances exclude `SIGNING_PENDING`, and unbound rows retain `customerId: null`:

```ts
const receipt = (usd: number, status: string) => ({ usd, status });
const order = (
  id: string,
  orderNo: string,
  customerId: string | null,
  amount: number,
  receipts: Array<{ usd: number; status: string }>,
) => ({
  id,
  orderNo,
  customerId,
  customerName: customerId ? 'Alpha Buyer' : null,
  customerMark: customerId ? 'AB' : null,
  amount,
  receipts,
});
const invoice = (
  id: string,
  releaseDate: string | null,
  orders: ReturnType<typeof order>[],
) => ({
  id,
  invNo: id,
  releaseDate: releaseDate ? new Date(releaseDate) : null,
  orders,
});

const snapshot = buildDashboardOutstandingSnapshot([
  invoice('INV-1', '2026-08-01', [
    order('order-1', 'AB-01', 'customer-1', 1000, [receipt(250, 'RECEIVED')]),
  ]),
  invoice('INV-2', null, [
    order('order-2', 'AB-02', 'customer-1', 500, [receipt(100, 'SIGNING_PENDING')]),
  ]),
], Date.parse('2026-08-24T00:00:00.000Z'));

expect(snapshot.unpaidTotal).toBe(1250);
expect(snapshot.customerOutstanding[0]).toMatchObject({
  customerId: 'customer-1',
  totalOutstanding: 1250,
  statusSubtotals: { released: 750, inTransit: 500 },
});
```

- [ ] **Step 2: Run the pure test and verify the missing-module failure**

Run:

```bash
npm test -- --runInBand src/lib/dashboard-customer-outstanding.test.ts
```

Expected: FAIL because `dashboard-customer-outstanding.ts` does not exist.

- [ ] **Step 3: Implement the pure snapshot builder**

Create serializable output types plus an internal balance map:

```ts
export type DashboardCustomerOutstanding = {
  customerId: string | null;
  customerKey: string;
  customerLabel: string;
  totalOutstanding: number;
  statusSubtotals: { inTransit: number; released: number };
  orders: DashboardCustomerOutstandingOrder[];
};

export function buildDashboardOutstandingSnapshot(
  invoices: DashboardOutstandingInvoiceInput[],
  nowMs = Date.now(),
): DashboardOutstandingSnapshot {
  const orderBalances = new Map<string, number>();
  for (const invoice of invoices) {
    for (const order of invoice.orders) {
      orderBalances.set(order.id, computeOrderBalanceFromReceipts({
        amount: order.amount,
        receipts: order.receipts,
      }));
    }
  }
  return buildGroupedSnapshotFromBalances(invoices, orderBalances, nowMs);
}

export const dashboardOutstandingInvoiceSelect = (
  orderWhere: Prisma.OrderWhereInput,
) => ({
  id: true,
  invNo: true,
  releaseDate: true,
  orders: {
    where: orderWhere,
    select: {
      id: true,
      orderNo: true,
      customerId: true,
      customerName: true,
      customerMark: true,
      amount: true,
      orderBalance: true,
      receipts: { select: { usd: true, status: true } },
    },
  },
}) satisfies Prisma.InvoiceSelect;
```

Define private `buildGroupedSnapshotFromBalances(invoices, orderBalances, nowMs)` in the same file. Move the current Dashboard summary loops that calculate `unpaidTotal`, `releasedInvoices`, and `customerOutstanding` into it verbatim, then add `customerId` to each customer result. Do not change released/in-transit order, rounding, or released-invoice sorting.

- [ ] **Step 4: Make Dashboard summary consume the shared snapshot**

Replace its local maps and grouping loops with:

```ts
const outstandingSnapshot = buildDashboardOutstandingSnapshot(visibleInvoices);

for (const invoice of visibleInvoices) {
  for (const order of invoice.orders) {
    const computed = outstandingSnapshot.orderBalances.get(order.id) ?? 0;
    const comparison = compareStoredOrderBalance({ stored: order.orderBalance, computed });
    if (!comparison.matches) {
      balanceRepairTasks.push(repairOrderBalanceCacheIfNeeded(order, db, {
        actorId: currentUser.id,
        source: 'dashboard-summary',
      }));
    }
  }
}
```

Return `outstandingSnapshot.unpaidTotal`, `.releasedInvoices`, and `.customerOutstanding` so all Dashboard figures stay on one formula.

- [ ] **Step 5: Add the selected customer's outstanding snapshot to history reads**

After `readCustomerHistory` validates the visible customer, query visible non-system invoices once with that customer ID and pass them through the shared builder:

```ts
const history = await readCustomerHistory({ ...input, orderName: null, customerWhere, orderWhere, receiptWhere });
const visibleInvoices = await db.invoice.findMany({
  where: {
    invNo: { notIn: ['Un_Associated', 'DEPOSIT_POOL'] },
    orders: { some: { AND: [orderWhere, { customerId: history.data.customer.id }] } },
  },
  select: dashboardOutstandingInvoiceSelect({
    AND: [orderWhere, { customerId: history.data.customer.id }],
  }),
});
const snapshot = buildDashboardOutstandingSnapshot(visibleInvoices);
return {
  data: {
    ...history.data,
    outstanding: snapshot.customerOutstanding.find(
      (row) => row.customerId === history.data.customer.id,
    ) ?? null,
  },
};
```

Keep the reusable Prisma selection in `dashboard-customer-outstanding.ts` so summary and history select the same fields.

- [ ] **Step 6: Extend service and route tests**

Assert that history returns the same computed total and status rows, respects `orderWhere`, and the route forwards the extended response:

```ts
expect(result.data.outstanding).toMatchObject({
  customerId: 'customer-1',
  totalOutstanding: 750,
});
expect(json.data.outstanding.statusSubtotals.released).toBe(750);
```

- [ ] **Step 7: Run the Dashboard service tests**

Run:

```bash
npm test -- --runInBand \
  src/lib/dashboard-customer-outstanding.test.ts \
  src/lib/dashboard-summary-service.test.ts \
  src/lib/dashboard-customer-history-service.test.ts \
  src/app/api/dashboard/customer-history-search/route.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the shared Dashboard calculation**

```bash
git add src/lib/dashboard-customer-outstanding.ts \
  src/lib/dashboard-customer-outstanding.test.ts \
  src/lib/dashboard-summary-service.ts \
  src/lib/dashboard-customer-history-service.ts \
  src/lib/dashboard-customer-history-service.test.ts \
  src/app/api/dashboard/customer-history-search/route.test.ts
git commit -m "refactor: share dashboard customer outstanding snapshot"
```

### Task 2: One Dashboard customer detail dialog

**Files:**
- Create: `src/components/workspace/modules/customers/components/customer-order-history-content.tsx`
- Create: `src/components/workspace/modules/dashboard/components/dashboard-customer-detail-dialog.tsx`
- Create: `src/components/workspace/modules/dashboard/components/dashboard-customer-detail-dialog.test.tsx`
- Modify: `src/components/workspace/modules/customers/components/customer-order-history-dialog.tsx`
- Modify: `src/components/workspace/modules/customers/components/customer-order-history-dialog.test.tsx`
- Modify: `src/components/workspace/modules/customers/components/index.ts`
- Modify: `src/components/workspace/modules/dashboard/dashboard-view.tsx`
- Modify: `src/components/workspace/modules/dashboard/dashboard-view.test.tsx`

**Interfaces:**
- Consumes: `DashboardCustomerOutstanding` and existing `CustomerOrderHistory` pagination callbacks.
- Produces: `DashboardCustomerDetailDialog`, the only Dashboard-rendered customer dialog.
- Produces: `CustomerOrderHistoryContent`, reused by Customer Management's existing dialog wrapper.

- [ ] **Step 1: Write failing unified-dialog component tests**

Render the new dialog with outstanding and history data, then assert section order:

```ts
const dialog = renderDashboardCustomerDetail({
  outstanding: outstandingFixture(),
  history: historyFixture(),
});

expect(within(dialog).getByText('Total Unpaid: $1,250')).toBeInTheDocument();
expect(within(dialog).getByText('Released')).toBeInTheDocument();
expect(within(dialog).getByText('In Transit')).toBeInTheDocument();
expect(within(dialog).getByText('Historical Orders')).toBeInTheDocument();
expect(within(dialog).getByText('Recent Receipts')).toBeInTheDocument();
expect(sectionTitles(dialog)).toEqual([
  'Released', 'In Transit', 'Historical Orders', 'Recent Receipts',
]);
```

Add an unbound fixture that shows `Customer history is unavailable because this order is not linked to a customer.` and does not invoke a history loader.

- [ ] **Step 2: Run the new component test and verify failure**

```bash
npm test -- --runInBand src/components/workspace/modules/dashboard/components/dashboard-customer-detail-dialog.test.tsx
```

Expected: FAIL because the component is missing.

- [ ] **Step 3: Extract history tables without changing Customer Management UI**

Move the current loading/error/two-table/pagination body into:

```tsx
export function CustomerOrderHistoryContent(props: CustomerOrderHistoryContentProps) {
  const showInitialLoading = props.loading && !props.history;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      {showInitialLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {props.tx('加载中...', 'Loading...')}
        </div>
      ) : null}
      {props.error ? (
        <Alert variant="destructive"><AlertDescription>{props.error}</AlertDescription></Alert>
      ) : null}
      {props.history ? <CustomerHistoryTablesAndPagination {...props} /> : null}
    </div>
  );
}
```

Define private `CustomerHistoryTablesAndPagination(props)` in this file by moving the current two `<section>` nodes and their two `ListPagination` components without edits. Keep the current table classes, mobile layout, ORDER `/` wrapping, date formatting, receipt image click, and independent pagination unchanged. Make `CustomerOrderHistoryDialog` a thin Dialog wrapper around this content.

- [ ] **Step 4: Implement the Dashboard composed dialog**

```tsx
export function DashboardCustomerDetailDialog(props: DashboardCustomerDetailDialogProps) {
  const released = props.outstanding?.orders.filter((row) => row.statusGroup === 'RELEASED') ?? [];
  const inTransit = props.outstanding?.orders.filter((row) => row.statusGroup === 'IN_TRANSIT') ?? [];
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-6xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <span>{props.title || '-'}</span>
            <span className="text-sm font-semibold text-red-600">
              {props.tx('未付总计', 'Total Unpaid')}: {formatUsdAmount(props.outstanding?.totalOutstanding ?? 0)}
            </span>
          </DialogTitle>
          <DialogDescription>
            {props.tx('客户欠款、历史订单和最近付款记录', 'Customer outstanding, historical orders, and recent payments.')}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {renderOutstandingSection('RELEASED', released, props.outstanding?.statusSubtotals.released ?? 0, props.tx)}
          {renderOutstandingSection('IN_TRANSIT', inTransit, props.outstanding?.statusSubtotals.inTransit ?? 0, props.tx)}
          {props.customerId ? (
            <CustomerOrderHistoryContent {...props.historyProps} />
          ) : (
            <p className="text-sm text-muted-foreground">{props.unboundMessage}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

Define private `renderOutstandingSection(status, orders, subtotal, tx)` by moving the existing ranking-dialog status table from `dashboard-view.tsx` into this file. Render Released before In Transit, preserve subtotals/Days/amount formatting, and show zero/empty sections for a valid customer with no outstanding.

- [ ] **Step 5: Replace both Dashboard dialog states with one selection state**

Use one state object:

```ts
type DashboardCustomerDetailSelection = {
  customerId: string | null;
  title: string;
  previewOutstanding: DashboardCustomerOutstanding | null;
};

const [customerDetailSelection, setCustomerDetailSelection] =
  useState<DashboardCustomerDetailSelection | null>(null);
```

Ranking clicks open this state using `customer.customerId` and its loaded outstanding snapshot. Search clicks use the search item's customer ID and initially set `previewOutstanding: null`. Both call the same `loadCustomerDetail` function and render one `DashboardCustomerDetailDialog`. Remove the standalone `selectedCustomer` Dialog and standalone Dashboard `CustomerOrderHistoryDialog`.

- [ ] **Step 6: Preserve content during history pagination**

Keep current history/outstanding state while fetching another history page:

```ts
setCustomerHistoryLoading(true);
const result = await apiCall(endpoint);
if (requestGuard.isLatest(token) && result.success) {
  setCustomerHistory(result.data);
  setCustomerDetailOutstanding(result.data.outstanding ?? previewOutstanding);
}
```

Do not clear `customerHistory` at request start. Only clear it when a different customer is selected or the dialog closes.

- [ ] **Step 7: Update Dashboard interaction tests**

Prove ranking and search open the same test ID and same sections:

```ts
fireEvent.click(screen.getByRole('button', { name: 'SUPER DT2' }));
expect(await screen.findByTestId('dashboard-customer-detail-dialog')).toBeInTheDocument();
expect(screen.getByText('Historical Orders')).toBeInTheDocument();

closeDialog();
fireEvent.click(within(searchCard).getByRole('button', { name: 'SUPER DT2' }));
expect(await screen.findByTestId('dashboard-customer-detail-dialog')).toBeInTheDocument();
expect(screen.getByText('Released')).toBeInTheDocument();
```

Add a pagination test that keeps the dialog and outstanding heading mounted while the next page request is pending.

- [ ] **Step 8: Run component regressions**

```bash
npm test -- --runInBand \
  src/components/workspace/modules/dashboard/components/dashboard-customer-detail-dialog.test.tsx \
  src/components/workspace/modules/dashboard/dashboard-view.test.tsx \
  src/components/workspace/modules/customers/components/customer-order-history-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit the unified Dashboard dialog**

```bash
git add src/components/workspace/modules/customers/components \
  src/components/workspace/modules/dashboard/components/dashboard-customer-detail-dialog.tsx \
  src/components/workspace/modules/dashboard/components/dashboard-customer-detail-dialog.test.tsx \
  src/components/workspace/modules/dashboard/dashboard-view.tsx \
  src/components/workspace/modules/dashboard/dashboard-view.test.tsx
git commit -m "feat: unify dashboard customer detail dialog"
```

### Task 3: Inactive MU Contract source takeover

**Files:**
- Modify: `src/lib/integrations/mu-contract-order-applier.ts`
- Modify: `src/lib/integrations/mu-contract-order-applier.test.ts`
- Modify: `src/lib/integrations/mu-contract-sync-service.ts`
- Modify: `src/lib/integrations/mu-contract-sync-service.test.ts`

**Interfaces:**
- Produces: `claimOrderTrackerSource(tx, orderTrackerId, incomingPiId)` returning `{ blockingLink, detachedInactiveLink }`.
- Consumes: existing `persistLink`, event receipt transaction, conflict handling, and source metadata.

- [ ] **Step 1: Write failing takeover tests**

Set an inactive old link on a manual Orders row and apply a new active PI with the same ORDER NO:

```ts
tx.orderTracker.findFirst.mockResolvedValue(manualRow());
tx.externalOrderSourceLink.findFirst.mockResolvedValue({
  id: 'old-link',
  externalId: 'pi-deleted',
  orderTrackerId: 'manual-1',
  active: false,
  officialAmount: '10000.00',
});

const result = await apply(tx, makeEvent({ amount: '12500.00' }));

expect(result.result).toBe('APPLIED');
expect(tx.externalOrderSourceLink.update).toHaveBeenCalledWith({
  where: { id: 'old-link' },
  data: { orderTrackerId: null },
});
expect(tx.externalOrderSourceLink.create).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ orderTrackerId: 'manual-1', officialAmount: '12500.00' }),
}));
```

Add tests for active old source conflict, same PI idempotency, and displaced old PI reactivation conflict.

- [ ] **Step 2: Run the applier test and verify failure**

```bash
npm test -- --runInBand src/lib/integrations/mu-contract-order-applier.test.ts
```

Expected: FAIL because inactive foreign links still block attachment.

- [ ] **Step 3: Implement source claiming**

Replace `linkedElsewhere` with:

```ts
async function claimOrderTrackerSource(
  tx: Prisma.TransactionClient,
  orderTrackerId: string,
  incomingPiId: string,
) {
  const link = await tx.externalOrderSourceLink.findFirst({
    where: { provider: MU_CONTRACT_PROVIDER, orderTrackerId },
    select: {
      id: true,
      externalId: true,
      orderTrackerId: true,
      active: true,
      officialAmount: true,
    },
  });
  if (!link || link.externalId === incomingPiId) {
    return { blockingLink: null, detachedInactiveLink: null };
  }
  if (link.active) {
    return { blockingLink: link, detachedInactiveLink: null };
  }
  await tx.externalOrderSourceLink.update({
    where: { id: link.id },
    data: { orderTrackerId: null },
  });
  return { blockingLink: null, detachedInactiveLink: link };
}
```

Use it in both initial attach and rename-target attach paths. Only `blockingLink` produces `SOURCE_LINK_COLLISION`.

- [ ] **Step 4: Add structured takeover evidence after commit**

Extend `MuContractApplyResult` with optional takeover evidence:

```ts
takeover: {
  orderTrackerId: string;
  normalizedOrderNo: string;
  oldSourcePiId: string;
  newSourcePiId: string;
  oldOfficialAmount: string | null;
  newOfficialAmount: string | null;
} | null;
```

`processEvent` returns this evidence from its existing database transaction. In `runIncremental`, emit one structured server log only after `await processEvent(...)` has committed:

```ts
if (result.takeover) {
  logger.info('MU Contract inactive source replaced', result.takeover);
}
```

Do not log tokens or customer personal data. The durable old/new source rows and event receipt remain the audit record.

- [ ] **Step 5: Run applier and sync regressions**

```bash
npm test -- --runInBand \
  src/lib/integrations/mu-contract-order-applier.test.ts \
  src/lib/integrations/mu-contract-sync-service.test.ts \
  src/lib/integrations/mu-contract-reconcile-service.test.ts
```

Expected: PASS, including active collision and stale-version tests.

- [ ] **Step 6: Commit source takeover**

```bash
git add src/lib/integrations/mu-contract-order-applier.ts \
  src/lib/integrations/mu-contract-order-applier.test.ts \
  src/lib/integrations/mu-contract-sync-service.ts \
  src/lib/integrations/mu-contract-sync-service.test.ts
git commit -m "fix: replace inactive MU Contract order sources"
```

### Task 4: Transactional system-pool migration during invoice writes

**Files:**
- Create: `src/lib/invoice-system-pool-reconciliation.ts`
- Create: `src/lib/invoice-system-pool-reconciliation.test.ts`
- Modify: `src/lib/invoice-write.ts`
- Modify: `src/lib/invoice-write.test.ts`
- Modify: `src/lib/invoice-service.ts`
- Modify: `src/lib/invoice-service.test.ts`

**Interfaces:**
- Produces: `migrateSystemPoolOrderForInvoiceRow(tx, input): Promise<SystemPoolMigrationResult | null>`.
- Produces: `SystemPoolMigrationAudit` returned by `saveInvoiceWithOrders` for create/import audit metadata.
- Extends: `saveInvoiceWithOrders` input with `operationSource: 'INVOICE_WRITE' | 'BULK_IMPORT'` so audit records distinguish manual and imported writes.
- Consumes: `SYSTEM_POOL_INVOICE_NOS`, alias/composite matcher, `syncOrderAliases`, and transaction-aware `updateOrderBalance`.

- [ ] **Step 1: Write failing migration tests**

Cover direct reuse and existing-target merge:

```ts
const customer = {
  customerId: 'customer-ab',
  customerMark: 'AB',
  customerName: 'Alpha Buyer',
  customerPhone: '+224600000000',
  customerCity: 'Conakry',
  needsCustomerFix: false,
};
const moved = await migrateSystemPoolOrderForInvoiceRow(tx, {
  orderNo: 'AB-13B',
  targetInvoice: { id: 'invoice-990', invNo: '0000990' },
  authoritativeAmount: 20000,
  targetOrderId: null,
  customer,
  operationSource: 'INVOICE_WRITE',
});

expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
  where: { id: 'deposit-order' },
  data: expect.objectContaining({ invoiceId: 'invoice-990', amount: 20000 }),
}));
expect(tx.order.update).not.toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ amount: { increment: 20000 } }),
}));
expect(mockUpdateOrderBalance).toHaveBeenCalledWith('deposit-order', tx);
```

For a target Order that already exists, assert receipts move, the pool row is deleted, target amount is unchanged by pool amount, and balance is recalculated once.

- [ ] **Step 2: Run the module test and verify failure**

```bash
npm test -- --runInBand src/lib/invoice-system-pool-reconciliation.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the transaction-aware migration helper**

Find a pool match with the shared matcher and explicit pool filter:

```ts
const poolOrderId = await findOrderIdByNoOrAliasWithExecutor(tx, input.orderNo, {
  invoice: { invNo: { in: Array.from(SYSTEM_POOL_INVOICE_NOS) } },
});
if (!poolOrderId) return null;
```

When `targetOrderId` is absent, update the original row with `invoiceId`, canonical ORDER NO, serialized tokens, authoritative replacement amount, and customer snapshot; sync aliases and recalculate balance in the same transaction. When `targetOrderId` exists, move receipts to it, delete the pool row, retain the formal target amount, and recalculate the target balance.

Return:

```ts
type SystemPoolMigrationAudit = {
  sourceOrderId: string;
  sourcePool: 'DEPOSIT_POOL' | 'Un_Associated';
  targetInvoiceId: string;
  targetInvNo: string;
  targetOrderId: string;
  movedReceiptCount: number;
  amountBefore: number;
  amountAfter: number;
  balanceBefore: number;
  balanceAfter: number;
  operationSource: 'INVOICE_WRITE' | 'BULK_IMPORT' | 'REMATCH_AUTO' | 'REMATCH_MANUAL';
};
```

- [ ] **Step 4: Invoke migration before generic global merge**

Add required `operationSource` to `saveInvoiceWithOrders` and `persistInvoiceWithOrders`. `createInvoiceRecord` passes `INVOICE_WRITE`; the grouped import loop passes `BULK_IMPORT`. After locating `existingInTarget`, call the helper. If it handles the row, add its target ID to `touchedOrderIds`, append its audit record, and skip the old `Un_Associated` special case. Keep generic non-system global-order behavior unchanged.

```ts
const migrated = await migrateSystemPoolOrderForInvoiceRow(tx, {
  orderNo: canonicalOrderNo,
  targetInvoice,
  authoritativeAmount: amountNumber,
  targetOrderId: existingInTarget?.id ?? null,
  customer: customerResolution,
  operationSource: input.operationSource,
});
if (migrated) {
  touchedOrderIds.add(migrated.targetOrderId);
  poolMigrations.push(migrated.audit);
  continue;
}
```

Remove the create-copy-delete branch limited to `Un_Associated`.

- [ ] **Step 5: Preserve existing target-row amount behavior**

If the target invoice already contains the row, apply the incoming invoice amount according to the existing same-target rule before pool cleanup, but never add the pool row's amount. Add a retry test where a pool row already contains `20000` and the input is `20000`; final amount must be `20000`, not `40000`.

- [ ] **Step 6: Return and audit migration metadata**

Return `poolMigrations` from `saveInvoiceWithOrders`. Include it in existing create/import audit events:

```ts
metadata: {
  invNo: input.invNo,
  orderCount: input.orders.length,
  systemPoolMigrations: saved.poolMigrations,
}
```

For bulk import, aggregate each successful invoice's migration records into the existing `INVOICE_IMPORT` audit metadata.

- [ ] **Step 7: Run invoice write and service tests**

```bash
npm test -- --runInBand \
  src/lib/invoice-system-pool-reconciliation.test.ts \
  src/lib/invoice-write.test.ts \
  src/lib/invoice-service.test.ts
```

Expected: PASS for manual create, grouped bulk import, receipt preservation, amount replacement, and audit metadata.

- [ ] **Step 8: Commit invoice-write migration**

```bash
git add src/lib/invoice-system-pool-reconciliation.ts \
  src/lib/invoice-system-pool-reconciliation.test.ts \
  src/lib/invoice-write.ts src/lib/invoice-write.test.ts \
  src/lib/invoice-service.ts src/lib/invoice-service.test.ts
git commit -m "fix: move system pool orders into formal invoices"
```

### Task 5: Historical system-pool repair in Rematch API

**Files:**
- Modify: `src/lib/invoice-system-pool-reconciliation.ts`
- Modify: `src/lib/invoice-system-pool-reconciliation.test.ts`
- Modify: `src/lib/invoice-service.ts`
- Modify: `src/lib/invoice-service.test.ts`
- Modify: `src/app/api/invoice/route.ts`
- Modify: `src/lib/api-catalog.ts`
- Modify: `src/lib/api-catalog.test.ts`

**Interfaces:**
- Produces: `previewSystemPoolRepairs(tx, orderWhere, invoiceWhere)` returning repair rows and visible formal invoice options.
- Produces: `applySystemPoolRepairs(tx, input)` returning counts plus structured audit rows.
- Extends: `previewInvoiceRematch` response to `{ groups, poolRepairs, targetInvoices }`.
- Extends: `applyInvoiceRematch(currentUser, resolutions, poolResolutions)`.

- [ ] **Step 1: Write failing preview tests**

Create three pool fixtures:

```ts
expect(await previewInvoiceRematch(admin)).toEqual({
  groups: [],
  poolRepairs: [
    expect.objectContaining({ sourceOrderId: 'pool-unique', repairMode: 'AUTO', targetOrderId: 'formal-1' }),
    expect.objectContaining({ sourceOrderId: 'pool-manual', repairMode: 'MANUAL', amount: 18000 }),
  ],
  targetInvoices: [expect.objectContaining({ id: 'invoice-1', invNo: 'INV-001' })],
});
```

Assert a zero-amount pool order with no unique formal match is absent. Assert formal matching uses `findOrderIdByNoOrAliasWithExecutor` twice, excluding the first ID to prove uniqueness.

- [ ] **Step 2: Run preview tests and verify failure**

```bash
npm test -- --runInBand src/lib/invoice-service.test.ts -t "system pool repair"
```

Expected: FAIL because Rematch returns conflict groups only.

- [ ] **Step 3: Implement unique-target detection with the shared matcher**

```ts
const firstId = await findOrderIdByNoOrAliasWithExecutor(tx, pool.orderNo, formalOrderWhere);
const secondId = firstId
  ? await findOrderIdByNoOrAliasWithExecutor(tx, pool.orderNo, {
      AND: [formalOrderWhere, { id: { not: firstId } }],
    })
  : null;

const repairMode = firstId && !secondId ? 'AUTO' : pool.amount > 0 ? 'MANUAL' : null;
```

Never infer a target from customer, MARK, group name, or similar text.

- [ ] **Step 4: Implement transactional auto and manual apply**

Auto rows merge receipts into the unique formal target and delete the pool row. Manual rows validate a visible, non-system target invoice; if it already has the same Order, merge into that Order, otherwise update the original pool Order's `invoiceId` and retain its positive stored amount.

```ts
await runInTransaction(async (tx) => {
  const source = await requireVisibleSystemPoolOrder(tx, resolution.sourceOrderId, orderWhere);
  const target = await requireVisibleFormalInvoice(tx, resolution.targetInvoiceId, invoiceWhere);
  await applyVerifiedSystemPoolMove(tx, { source, target, operationSource: 'REMATCH_MANUAL' });
});
```

Reject stale source rows, deleted targets, invisible targets, system-pool targets, and manual moves of zero-amount placeholders with a readable `409` and no writes.

- [ ] **Step 5: Fix general duplicate keeper selection**

Replace the current `invNo !== 'Un_Associated'` preference with:

```ts
const targetOrder = orders.find(
  (row) => !SYSTEM_POOL_INVOICE_NOS.has(row.invoice.invNo),
);
if (!targetOrder) continue;
```

When merging a pool source into a formal target during automatic cleanup, move receipts but never add the pool source amount to the formal amount.

- [ ] **Step 6: Extend API parsing and catalog**

```ts
const result = await applyInvoiceRematch(
  currentUser,
  Array.isArray(body.resolutions) ? body.resolutions : [],
  Array.isArray(body.poolResolutions) ? body.poolResolutions : [],
);
```

Update the API catalog example to include:

```json
{
  "action": "rematch-apply",
  "resolutions": [],
  "poolResolutions": [{ "sourceOrderId": "pool-order-id", "targetInvoiceId": "invoice-id" }]
}
```

- [ ] **Step 7: Assert audit, visibility, rollback, and idempotency**

Tests must verify `INVOICE_REMATCH_APPLY` metadata contains auto/manual migration audit rows, USER/SALES cannot invoke the route, invisible targets are rejected, a transaction failure leaves source/receipts unchanged, and a second apply reports zero new moves rather than failing.

- [ ] **Step 8: Run Rematch service/API tests**

```bash
npm test -- --runInBand \
  src/lib/invoice-system-pool-reconciliation.test.ts \
  src/lib/invoice-service.test.ts \
  src/lib/api-catalog.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Rematch backend repair**

```bash
git add src/lib/invoice-system-pool-reconciliation.ts \
  src/lib/invoice-system-pool-reconciliation.test.ts \
  src/lib/invoice-service.ts src/lib/invoice-service.test.ts \
  src/app/api/invoice/route.ts src/lib/api-catalog.ts src/lib/api-catalog.test.ts
git commit -m "feat: repair historical system pool invoice links"
```

### Task 6: Rematch repair controls for administrators

**Files:**
- Create: `src/components/workspace/modules/invoices/components/rematch-dialog.test.tsx`
- Modify: `src/components/workspace/modules/invoices/types.ts`
- Modify: `src/components/workspace/modules/invoices/components/rematch-dialog.tsx`
- Modify: `src/components/workspace/modules/invoices/hooks/use-invoice-tools.ts`
- Modify: `src/components/workspace/modules/invoices/invoice-manager.tsx`

**Interfaces:**
- Consumes: `{ groups, poolRepairs, targetInvoices }` from preview.
- Produces: `poolResolutions: Array<{ sourceOrderId: string; targetInvoiceId: string }>` in apply request.

- [ ] **Step 1: Write failing Rematch dialog tests**

```tsx
render(<RematchDialog
  open
  groups={[]}
  poolRepairs={[
    {
      sourceOrderId: 'auto', orderNo: 'AB-12', sourcePool: 'DEPOSIT_POOL',
      amount: 10000, orderBalance: 8000, receiptCount: 1, repairMode: 'AUTO',
      targetOrderId: 'formal-1', targetInvoiceId: 'invoice-1', targetInvNo: 'INV-001',
    },
    {
      sourceOrderId: 'manual', orderNo: 'AB-13B', sourcePool: 'DEPOSIT_POOL',
      amount: 18000, orderBalance: 14000, receiptCount: 1, repairMode: 'MANUAL',
      targetOrderId: null, targetInvoiceId: null, targetInvNo: null,
    },
  ]}
  targetInvoices={[{ id: 'invoice-1', invNo: 'INV-001' }]}
  poolSelections={{}}
  selections={{}}
  applying={false}
  tx={tx}
  onOpenChange={jest.fn()}
  onSelectionChange={jest.fn()}
  onPoolSelectionChange={jest.fn()}
  onApply={jest.fn()}
/>);

expect(screen.getByText('Will move automatically')).toBeInTheDocument();
expect(screen.getByLabelText('Target invoice for AB-13B')).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
```

Select `INV-001` and assert Apply becomes enabled.

- [ ] **Step 2: Run the dialog test and verify prop/type failure**

```bash
npm test -- --runInBand src/components/workspace/modules/invoices/components/rematch-dialog.test.tsx
```

Expected: FAIL because system-pool repair props do not exist.

- [ ] **Step 3: Add UI types and hook state**

```ts
export type SystemPoolRepairPreview = {
  sourceOrderId: string;
  orderNo: string;
  sourcePool: 'DEPOSIT_POOL' | 'Un_Associated';
  amount: number;
  orderBalance: number;
  receiptCount: number;
  repairMode: 'AUTO' | 'MANUAL';
  targetOrderId: string | null;
  targetInvoiceId: string | null;
  targetInvNo: string | null;
};

const [poolRepairs, setPoolRepairs] = useState<SystemPoolRepairPreview[]>([]);
const [poolSelections, setPoolSelections] = useState<Record<string, string>>({});
```

Parse the preview object instead of treating `result.data` as a group array. Prepopulate selections only for manual candidates that already have an explicit target.

- [ ] **Step 4: Render the repair section responsively**

Add a section above existing conflict groups with ORDER, pool, amount, balance, receipts, and target. AUTO rows show the resolved INV NO as text. MANUAL rows use a labeled formal-invoice select. Keep Dialog content mobile-safe with `max-h-[calc(100vh-24px)]`, vertical scrolling, and a visible footer.

- [ ] **Step 5: Send only explicit manual choices**

```ts
const poolResolutions = poolRepairs
  .filter((row) => row.repairMode === 'MANUAL')
  .map((row) => ({
    sourceOrderId: row.sourceOrderId,
    targetInvoiceId: poolSelections[row.sourceOrderId] || '',
  }));
```

Disable Apply while any manual row has no target. AUTO rows are recalculated and applied by the backend; the browser must not assert their target.

- [ ] **Step 6: Run UI tests and typecheck the module**

```bash
npm test -- --runInBand src/components/workspace/modules/invoices/components/rematch-dialog.test.tsx
npx tsc --noEmit --pretty false
```

Expected: PASS.

- [ ] **Step 7: Commit Rematch controls**

```bash
git add src/components/workspace/modules/invoices/types.ts \
  src/components/workspace/modules/invoices/components/rematch-dialog.tsx \
  src/components/workspace/modules/invoices/components/rematch-dialog.test.tsx \
  src/components/workspace/modules/invoices/hooks/use-invoice-tools.ts \
  src/components/workspace/modules/invoices/invoice-manager.tsx
git commit -m "feat: add system pool repair controls to rematch"
```

### Task 7: Version, documentation, and full verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `ENGINEERING_LOG.md`
- Modify: `docs/superpowers/plans/README.md`
- Modify: `docs/superpowers/plans/2026-08-24-dashboard-source-deposit-reconciliation.md`

**Interfaces:**
- Consumes: all completed tasks and test evidence.
- Produces: version `1.0.211`, concise user documentation, engineering record, and archived plan status after verification.

- [ ] **Step 1: Run all targeted tests together**

```bash
npm test -- --runInBand \
  src/lib/dashboard-customer-outstanding.test.ts \
  src/lib/dashboard-summary-service.test.ts \
  src/lib/dashboard-customer-history-service.test.ts \
  src/app/api/dashboard/customer-history-search/route.test.ts \
  src/components/workspace/modules/dashboard/components/dashboard-customer-detail-dialog.test.tsx \
  src/components/workspace/modules/dashboard/dashboard-view.test.tsx \
  src/components/workspace/modules/customers/components/customer-order-history-dialog.test.tsx \
  src/lib/integrations/mu-contract-order-applier.test.ts \
  src/lib/integrations/mu-contract-sync-service.test.ts \
  src/lib/integrations/mu-contract-reconcile-service.test.ts \
  src/lib/invoice-system-pool-reconciliation.test.ts \
  src/lib/invoice-write.test.ts \
  src/lib/invoice-service.test.ts \
  src/lib/api-catalog.test.ts \
  src/components/workspace/modules/invoices/components/rematch-dialog.test.tsx
```

Expected: PASS with no open handles.

- [ ] **Step 2: Run project quality gates**

```bash
npm run typecheck
npm run lint
npm test -- --runInBand
npm audit --omit=dev
```

Expected: all commands exit `0`; production dependency audit reports zero vulnerabilities.

- [ ] **Step 3: Bump the single version source**

```bash
npm version 1.0.211 --no-git-tag-version
```

Expected: `package.json` and `package-lock.json` both report `1.0.211`; `src/lib/app-version.ts` requires no edit.

- [ ] **Step 4: Update concise user and engineering documentation**

Change README only to:

```md
- 版本：`1.0.211`
- 最近更新：Dashboard 客户欠款与历史信息已合并展示；MU Contract 重新创建的 PI 可接替已停用来源；定金池订单可安全迁入正式账单。
```

Append ENGINEERING_LOG with exact commits, tests, no-migration/no-backup-scope result, and the fact that no live Rematch was executed. Mark this plan `ARCHIVED_COMPLETED` in the plan index only after every verification step passes.

- [ ] **Step 5: Review the final diff for data safety and unintended scope**

```bash
git diff --check
git status --short
git diff --stat
git diff -- prisma docker-compose.yml docs/backup
```

Expected: no Prisma schema, migration, Docker volume, upload path, or backup-document changes.

- [ ] **Step 6: Commit version and documentation**

```bash
git add package.json package-lock.json README.md ENGINEERING_LOG.md \
  docs/superpowers/plans/README.md \
  docs/superpowers/plans/2026-08-24-dashboard-source-deposit-reconciliation.md
git commit -m "chore: release dashboard and reconciliation fixes"
```

- [ ] **Step 7: Verify branch history and remote-main readiness**

```bash
git status --short --branch
git log --oneline --decorate -8
git fetch origin
git rev-list --left-right --count origin/main...HEAD
```

Expected: clean worktree. If `origin/main` advanced, rebase or merge it non-interactively, rerun targeted tests and quality gates, then request review. Do not push, open/merge a PR, or rebuild Docker until explicitly authorized by the user.

## Execution Handoff

Per project instructions, Inline Execution is the default because no subagent authorization was given. Execute with `superpowers:executing-plans`, stop at the documented review checkpoints, and keep Docker/live data untouched until the user separately approves a rebuild.
