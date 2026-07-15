# Dashboard Customer Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one account-scoped Dashboard Customer Analytics card with independent annual order amount, trailing completed-month payment capacity, and explainable amount-weighted payment-cycle rankings calculated entirely by a reusable backend domain.

**Architecture:** A pure analytics kernel owns time windows, receipt inclusion, aggregation, weighted payment days, quality metadata, and risk classification. A visibility-scoped read service bulk-loads source records and exposes authenticated ranking/detail actions; React only performs lazy loading, tab switching, local 10-row pagination, responsive evidence dialogs, and visual risk rendering. Global ADMIN-editable settings reuse the existing transactional SystemSetting and audit pipeline; derived rankings are not persisted.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Prisma 6/MySQL, Prisma.Decimal, Africa/Conakry app clock, Radix Tabs/Tooltip/Popover/Dialog, Jest, React Testing Library, isolated MariaDB API tests, Docker Compose.

---

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-07-15-dashboard-customer-analytics-design.md`; implementation must not change its formulas without new user approval.
- Use invoice release date, never ship date, for annual amount and payment-cycle eligibility.
- Reuse `isReceiptIncludedInOrderBalance` so every formal receipt counts and only `SIGNING_PENDING` is excluded.
- Use receipt business date with creation-time fallback; future-dated receipts do not enter a calculation whose `asOf` is earlier.
- Use `APP_TIME_ZONE` from `src/lib/app-time.ts`; do not create a second timezone source.
- Use Prisma.Decimal/existing money helpers for financial totals and dollar-days.
- One canonical Customer produces one row even with multiple ORDER_NAME values.
- Every ranking and detail query applies existing management-tree visibility builders.
- Frontend code must not calculate annual totals, monthly capacity, payment allocation, cycle days, or risk bands.
- No derived-ranking table, migration, scheduled analytics job, or persisted ranking cache in this implementation.
- The card is visible by default, registered in the existing Dashboard analysis section, and remains hideable/reorderable per account.
- Version target is `1.0.195` unless main advances before implementation; then use the next patch version from the package single source.

## File Structure

### New backend files

- `src/lib/customer-analytics-types.ts`: shared DTO/input/config types without database access.
- `src/lib/customer-analytics.ts`: pure period, aggregation, weighted-cycle, ranking, and risk functions.
- `src/lib/customer-analytics.test.ts`: deterministic formula and boundary tests.
- `src/lib/customer-analytics-settings.ts`: validated runtime settings reader.
- `src/lib/customer-analytics-settings.test.ts`: defaults and malformed-stored-value tests.
- `src/lib/customer-analytics-service.ts`: scoped bulk reads and ranking/detail orchestration.
- `src/lib/customer-analytics-service.test.ts`: visibility/query-shape/reconciliation tests.
- `src/app/api/dashboard/customer-analytics/route.ts`: authenticated ranking/detail actions.
- `src/app/api/dashboard/customer-analytics/route.test.ts`: route dispatch and readable error tests.

### New frontend files

- `src/components/workspace/modules/dashboard/components/dashboard-card-pagination.tsx`: extracted fixed bottom Dashboard pager.
- `src/components/workspace/modules/dashboard/components/dashboard-card-pagination.test.tsx`: pager behavior.
- `src/components/workspace/modules/dashboard/components/customer-analytics-card.tsx`: tabs, lazy rankings, year selection, help, local paging.
- `src/components/workspace/modules/dashboard/components/customer-analytics-card.test.tsx`: ranking interaction tests.
- `src/components/workspace/modules/dashboard/components/customer-analytics-risk-indicator.tsx`: icon/color presentation with desktop/focus tooltip and tap popover.
- `src/components/workspace/modules/dashboard/components/customer-analytics-risk-indicator.test.tsx`: accessible pointer/keyboard/mobile explanation tests.
- `src/components/workspace/modules/dashboard/components/customer-analytics-detail-dialog.tsx`: metric-specific evidence dialogs.
- `src/components/workspace/modules/dashboard/components/customer-analytics-detail-dialog.test.tsx`: responsive evidence/error tests.
- `src/components/workspace/modules/settings/components/customer-analytics-settings-card.tsx`: human-readable global analytics settings.
- `src/components/workspace/modules/settings/components/customer-analytics-settings-card.test.tsx`: field/permission/save tests.

### Existing files modified

- `src/lib/system-settings.ts`, `src/lib/system-settings.test.ts`
- `src/lib/settings-write-service.ts`, `src/lib/settings-service.test.ts`
- `src/lib/dashboard-layout-preference.ts`, `src/lib/dashboard-layout-preference.test.ts`
- `src/lib/api-catalog.ts`, `src/lib/api-catalog.test.ts`
- `src/components/workspace/modules/dashboard/dashboard-view.tsx`, `dashboard-view.test.tsx`
- `src/components/workspace/modules/settings/components/index.ts`
- `src/components/workspace/modules/settings/settings-manager.tsx`, `settings-manager.test.tsx`
- `tests/api/isolated/cases/36-dashboard-customer-analytics.case.mjs`
- `.env.example`, `docs/API_TESTING.md`, `docs/backup/muledger-cos-backup.md`
- `README.md`, `ENGINEERING_LOG.md`, `todolist.md`
- `package.json`, `package-lock.json`

---

### Task 1: Shared Analytics Types, Conakry Periods, And Risk Bands

**Files:**
- Create: `src/lib/customer-analytics-types.ts`
- Create: `src/lib/customer-analytics.test.ts`
- Create: `src/lib/customer-analytics.ts`

- [ ] **Step 1: Write failing tests for period and risk boundaries**

Use injected `asOf = 2026-07-15T12:00:00.000Z` and assert:

```ts
expect(getCompletedMonthWindow(asOf, 12)).toEqual({
  start: new Date('2025-07-01T00:00:00.000Z'),
  endExclusive: new Date('2026-07-01T00:00:00.000Z'),
});
expect(getNaturalYearWindow(asOf, 2026)).toEqual({
  start: new Date('2026-01-01T00:00:00.000Z'),
  endExclusive: new Date('2027-01-01T00:00:00.000Z'),
});
expect(appCalendarDaysBetween(
  new Date('2026-06-14T23:30:00.000Z'),
  new Date('2026-07-15T00:30:00.000Z'),
)).toBe(31);

expect(classifyCustomerRisk(30, settings).id).toBe('normal');
expect(classifyCustomerRisk(31, settings).id).toBe('mild-delay');
expect(classifyCustomerRisk(60, settings).id).toBe('some-delay');
expect(classifyCustomerRisk(90, settings).id).toBe('delayed');
expect(classifyCustomerRisk(120, settings).id).toBe('warning');
expect(classifyCustomerRisk(150, settings).id).toBe('double-warning');
expect(classifyCustomerRisk(180, settings).id).toBe('severe-warning');
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx jest src/lib/customer-analytics.test.ts --runInBand
```

Expected: FAIL because the analytics modules do not exist.

- [ ] **Step 3: Define stable shared types**

Create types with these exact responsibilities:

```ts
export type CustomerAnalyticsMetric = 'annual-amount' | 'payment-capacity' | 'payment-cycle';
export type CustomerAnalyticsRiskBandId =
  | 'normal' | 'mild-delay' | 'some-delay' | 'delayed'
  | 'warning' | 'double-warning' | 'severe-warning';

export type CustomerAnalyticsSettings = {
  lookbackMonths: number;
  normalDays: number;
  mildDelayDays: number;
  delayDays: number;
  warningDays: number;
  doubleWarningDays: number;
  severeWarningDays: number;
};

export type CustomerAnalyticsCustomerInput = {
  id: string;
  companyName: string | null;
  name: string;
  mark: string;
};

export type CustomerAnalyticsReceiptInput = {
  id: string;
  usd: string | number | { toString(): string };
  status: string;
  date: Date | null;
  createdAt: Date;
  isDeposit: boolean;
};

export type CustomerAnalyticsOrderInput = {
  id: string;
  customerId: string | null;
  orderNo: string;
  invNo: string;
  releaseDate: Date | null;
  amount: string | number | { toString(): string };
  receipts: CustomerAnalyticsReceiptInput[];
};
```

Also define ranking row, period, quality metadata, risk band, and three detail DTOs once here so service, route, and frontend use the same shapes.

- [ ] **Step 4: Implement deterministic Conakry date helpers and risk classification**

Use `APP_TIME_ZONE` and `Intl.DateTimeFormat(...).formatToParts()` to derive a Conakry calendar-day stamp. Implement:

```ts
export function getNaturalYearWindow(asOf: Date, year: number): AnalyticsPeriod;
export function getCompletedMonthWindow(asOf: Date, months: number): AnalyticsPeriod;
export function appCalendarDaysBetween(start: Date, end: Date): number;
export function classifyCustomerRisk(days: number, settings: CustomerAnalyticsSettings): CustomerAnalyticsRiskBand;
```

Risk classification uses rounded whole days and the confirmed inclusive boundaries. Reject non-finite inputs in domain tests instead of returning an arbitrary risk.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npx jest src/lib/customer-analytics.test.ts --runInBand
git add src/lib/customer-analytics-types.ts src/lib/customer-analytics.ts src/lib/customer-analytics.test.ts
git commit -m "feat: add customer analytics foundations"
```

Expected: period/risk tests PASS.

---

### Task 2: Pure Annual Amount And Payment Capacity Calculations

**Files:**
- Modify: `src/lib/customer-analytics.test.ts`
- Modify: `src/lib/customer-analytics.ts`

- [ ] **Step 1: Add failing annual-amount tests**

Fixtures must prove:

```ts
const result = calculateAnnualAmountRanking({ customers, orders, year: 2026, asOf, settings });
expect(result.items).toEqual([
  expect.objectContaining({ customerId: 'customer-a', value: 125000, rank: 1 }),
]);
expect(result.quality.missingReleaseDateOrders).toBe(1);
expect(result.quality.missingReleaseDateAmount).toBe(5000);
expect(result.availableYears).toEqual([2025, 2026]);
```

Include one Customer with two ORDER_NAME-derived order numbers, one out-of-year release, one missing release, one `DEPOSIT_POOL`, one `Un_Associated`, deterministic tie sorting, and a customer with no annual amount who must not appear.

- [ ] **Step 2: Add failing payment-capacity tests**

Assert:

```ts
const result = calculatePaymentCapacityRanking({ customers, orders, asOf, settings });
expect(result.period).toEqual({
  start: new Date('2025-07-01T00:00:00.000Z'),
  endExclusive: new Date('2026-07-01T00:00:00.000Z'),
});
expect(result.items.find((row) => row.customerId === 'customer-a')?.value).toBe(1000); // 12,000 / 12
expect(result.items.find((row) => row.customerId === 'customer-zero')?.value).toBe(0);
```

Cover deposit inclusion, all four formal statuses, `SIGNING_PENDING` exclusion, missing business-date fallback, future/out-of-window exclusion, full overpayment inclusion, a slash display ORDER NO counted once, and twelve chronological monthly detail rows including zero months.

- [ ] **Step 3: Verify RED**

```bash
npx jest src/lib/customer-analytics.test.ts --runInBand
```

Expected: FAIL on missing aggregation functions.

- [ ] **Step 4: Implement annual amount and payment capacity**

Expose:

```ts
export function calculateAnnualAmountRanking(input: AnnualAmountInput): AnnualAmountResult;
export function calculatePaymentCapacityRanking(input: PaymentCapacityInput): PaymentCapacityResult;
```

Implementation rules:

```ts
const effectiveDate = receipt.date || receipt.createdAt;
const included = isReceiptIncludedInOrderBalance(receipt.status);
const customerName = customer.companyName?.trim() || customer.name.trim();
```

Aggregate money with `Prisma.Decimal`; convert to rounded two-decimal DTO numbers only at the output boundary. Build detail evidence during the same pass so ranking totals and details share one calculation.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npx jest src/lib/customer-analytics.test.ts --runInBand
git add src/lib/customer-analytics.ts src/lib/customer-analytics.test.ts
git commit -m "feat: calculate customer amount and capacity rankings"
```

---

### Task 3: Pure Amount-Weighted Payment Cycle

**Files:**
- Modify: `src/lib/customer-analytics.test.ts`
- Modify: `src/lib/customer-analytics.ts`

- [ ] **Step 1: Add the approved 52-day failing regression**

```ts
const result = calculatePaymentCycleRanking({
  customers: [customerA],
  orders: [{
    id: 'order-a', customerId: 'customer-a', orderNo: 'A-01', invNo: 'INV-A',
    releaseDate: new Date('2026-01-01T00:00:00.000Z'), amount: 100000,
    receipts: [
      receipt('prepay', 30000, '2025-12-20'),
      receipt('payment-40', 40000, '2026-02-10'),
      receipt('payment-100', 20000, '2026-04-11'),
    ],
  }],
  asOf: new Date('2026-06-10T00:00:00.000Z'),
  settings,
});

expect(result.items[0]).toEqual(expect.objectContaining({
  customerId: 'customer-a',
  roundedDays: 52,
  riskBand: expect.objectContaining({ id: 'mild-delay' }),
  overdueOutstanding: 10000,
}));
```

- [ ] **Step 2: Add failing eligibility and guardrail tests**

Cover all approved cases:

- open age 30: excluded from cycle and added to `withinTermsOutstanding`
- open age 31: included
- old fully paid order outside lookback: excluded
- old open order outside lookback: included
- fully prepaid order: zero days
- partial payment plus current unpaid exposure
- overpayment: cycle allocation capped at remaining amount
- future-dated receipt excluded and counted
- non-positive order/receipt excluded and counted
- one eligible order is enough
- exact risk thresholds and worst-first sorting
- exact tie uses overdue amount, display name, then customer ID

- [ ] **Step 3: Verify RED**

```bash
npx jest src/lib/customer-analytics.test.ts --runInBand
```

- [ ] **Step 4: Implement payment timeline and customer aggregation**

Use focused helpers:

```ts
function calculateOrderPaymentTimeline(input: OrderTimelineInput): OrderTimelineResult;
export function calculatePaymentCycleRanking(input: PaymentCycleInput): PaymentCycleResult;
```

Core allocation must follow this shape:

```ts
let remaining = toDecimal(order.amount);
let dollarDays = new Prisma.Decimal(0);

for (const payment of sortedPayments) {
  const paymentAmount = toDecimal(payment.usd);
  const allocated = paymentAmount.greaterThan(remaining) ? remaining : paymentAmount;
  const days = payment.effectiveDate <= releaseDate
    ? 0
    : appCalendarDaysBetween(releaseDate, payment.effectiveDate);
  dollarDays = dollarDays.plus(allocated.mul(days));
  remaining = remaining.minus(allocated);
  if (remaining.lessThanOrEqualTo(0)) break;
}

if (remaining.greaterThan(0)) {
  dollarDays = dollarDays.plus(remaining.mul(appCalendarDaysBetween(releaseDate, asOf)));
}
```

Customer raw cycle is total dollar-days divided by total eligible order amount. Preserve raw days for sorting; round once for display and risk classification.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npx jest src/lib/customer-analytics.test.ts --runInBand
git add src/lib/customer-analytics.ts src/lib/customer-analytics.test.ts
git commit -m "feat: calculate customer payment cycle risk"
```

---

### Task 4: Global Customer Analytics Settings And Validation

**Files:**
- Modify: `src/lib/system-settings.test.ts`
- Modify: `src/lib/system-settings.ts`
- Create: `src/lib/customer-analytics-settings.test.ts`
- Create: `src/lib/customer-analytics-settings.ts`
- Modify: `src/lib/settings-service.test.ts`
- Modify: `src/lib/settings-write-service.ts`

- [ ] **Step 1: Add failing defaults/runtime-reader tests**

Assert all seven keys are editable, have the approved defaults, use positive integer bounds, and normalize to:

```ts
expect(await getCustomerAnalyticsSettings()).toEqual({
  lookbackMonths: 12,
  normalDays: 30,
  mildDelayDays: 60,
  delayDays: 90,
  warningDays: 120,
  doubleWarningDays: 150,
  severeWarningDays: 180,
});
```

Malformed stored values must return the complete safe default set and write one structured warning, never a partially reversed threshold set.

- [ ] **Step 2: Add failing write-validation tests**

```ts
await expect(updateSystemSettings(admin, {
  CUSTOMER_ANALYTICS_NORMAL_DAYS: '60',
  CUSTOMER_ANALYTICS_MILD_DELAY_DAYS: '30',
})).rejects.toMatchObject({ code: 'BAD_REQUEST' });

await expect(updateSystemSettings(user, {
  CUSTOMER_ANALYTICS_NORMAL_DAYS: '30',
})).rejects.toMatchObject({ code: 'FORBIDDEN' });
```

Also assert decimal, zero, negative, equal, reversed, and excessive values write nothing, do not invalidate cache, and create no audit event. Valid changes upsert transactionally and record before/after values.

- [ ] **Step 3: Verify RED**

```bash
npx jest src/lib/system-settings.test.ts src/lib/customer-analytics-settings.test.ts src/lib/settings-service.test.ts --runInBand
```

- [ ] **Step 4: Implement keys, runtime normalization, and merged-set validation**

Add exact keys/defaults from the approved spec. Bound lookback to `1..60` months and thresholds to integer `1..3650` days. After `validateSettingUpdates` merges submitted values with current settings, validate:

```ts
normalDays < mildDelayDays
  && mildDelayDays < delayDays
  && delayDays < warningDays
  && warningDays < doubleWarningDays
  && doubleWarningDays < severeWarningDays
```

Return one readable bilingual-compatible API error detail containing the proposed ordered values.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npx jest src/lib/system-settings.test.ts src/lib/customer-analytics-settings.test.ts src/lib/settings-service.test.ts --runInBand
git add src/lib/system-settings.ts src/lib/system-settings.test.ts src/lib/customer-analytics-settings.ts src/lib/customer-analytics-settings.test.ts src/lib/settings-write-service.ts src/lib/settings-service.test.ts
git commit -m "feat: configure customer analytics rules"
```

---

### Task 5: Visibility-Scoped Bulk Read Service

**Files:**
- Create: `src/lib/customer-analytics-service.test.ts`
- Create: `src/lib/customer-analytics-service.ts`

- [ ] **Step 1: Write failing service tests**

Mock `db`, `getOwnerVisibleIds`, all relevant visibility builders, settings reader, and pure calculators. Assert:

- ranking uses server-created/injected `asOf`
- customers are queried once and orders once; no per-customer query
- annual query omits receipt payload
- capacity/cycle queries select receipt ID, USD, status, business date, creation date, and deposit flag
- special invoices remain available to capacity but are excluded by the pure annual/cycle rules
- sibling-branch data cannot enter calculator input
- one scoped aggregate query counts receipts without a canonical order/customer and merges that value into quality metadata
- detail independently checks the requested customer under `buildCustomerVisibilityWhere`
- ranking/detail totals and `asOf` reconcile for a stable fixture
- unknown/out-of-scope customer returns 404

- [ ] **Step 2: Verify RED**

```bash
npx jest src/lib/customer-analytics-service.test.ts --runInBand
```

- [ ] **Step 3: Implement service contracts**

```ts
export async function getCustomerAnalyticsRanking(
  currentUser: CurrentUser,
  input: { metric: CustomerAnalyticsMetric; year?: number; asOf?: Date },
): Promise<CustomerAnalyticsRankingResponse>;

export async function getCustomerAnalyticsDetail(
  currentUser: CurrentUser,
  input: { metric: CustomerAnalyticsMetric; customerId: string; year?: number; asOf?: Date },
): Promise<CustomerAnalyticsDetailResponse>;
```

Load in bulk:

```ts
const ownerIds = await getOwnerVisibleIds(currentUser);
const [settings, customers, orders, unboundReceiptCount] = await Promise.all([
  getCustomerAnalyticsSettings(),
  db.customer.findMany({ where: buildCustomerVisibilityWhere(ownerIds), select: customerIdentitySelect }),
  db.order.findMany({
    where: buildOrderVisibilityWhere(ownerIds),
    select: metric === 'annual-amount' ? annualOrderSelect : orderWithReceiptsSelect(ownerIds),
  }),
  metric === 'annual-amount'
    ? Promise.resolve(0)
    : db.receipt.count({
        where: {
          AND: [
            buildReceiptVisibilityWhere(ownerIds),
            { OR: [{ orderId: null }, { order: { customerId: null } }] },
          ],
        },
      }),
]);
```

Nested receipts must apply `buildReceiptVisibilityWhere(ownerIds)`. Capture one `asOf` before normalization. Log metric, duration, visible counts, result counts, and quality counters without logging individual financial rows.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npx jest src/lib/customer-analytics-service.test.ts --runInBand
git add src/lib/customer-analytics-service.ts src/lib/customer-analytics-service.test.ts
git commit -m "feat: add scoped customer analytics service"
```

---

### Task 6: Authenticated Ranking And Detail API

**Files:**
- Create: `src/app/api/dashboard/customer-analytics/route.test.ts`
- Create: `src/app/api/dashboard/customer-analytics/route.ts`
- Modify: `src/lib/api-catalog.test.ts`
- Modify: `src/lib/api-catalog.ts`

- [ ] **Step 1: Write failing route tests**

Test these calls:

```text
GET ?action=ranking&metric=annual-amount&year=2026
GET ?action=ranking&metric=payment-capacity
GET ?action=ranking&metric=payment-cycle
GET ?action=detail&metric=payment-cycle&customerId=customer-1
```

Assert exact service arguments, 200 response mapping, readable 400 for unknown action/metric, required year validation for annual ranking/detail, required customer ID for detail, and propagated 404/403 mappings.

- [ ] **Step 2: Verify RED**

```bash
npx jest src/app/api/dashboard/customer-analytics/route.test.ts src/lib/api-catalog.test.ts --runInBand
```

- [ ] **Step 3: Implement authenticated action dispatch**

Follow existing Dashboard customer-history route conventions:

```ts
export const GET = withAuth(async (request, currentUser) => {
  const query = new URL(request.url).searchParams;
  const action = query.get('action');
  const metric = parseCustomerAnalyticsMetric(query.get('metric'));

  if (action === 'ranking') {
    return NextResponse.json({ success: true, data: await getCustomerAnalyticsRanking(currentUser, { metric, year }) });
  }
  if (action === 'detail') {
    return NextResponse.json({ success: true, data: await getCustomerAnalyticsDetail(currentUser, { metric, customerId, year }) });
  }
  throw createApiError({ code: apiErrorCodes.BAD_REQUEST, status: 400, message: '未知客户分析操作' });
});
```

Add endpoint/actions to the route catalog so ADMIN route discovery exposes the API.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npx jest src/app/api/dashboard/customer-analytics/route.test.ts src/lib/api-catalog.test.ts --runInBand
git add src/app/api/dashboard/customer-analytics src/lib/api-catalog.ts src/lib/api-catalog.test.ts
git commit -m "feat: expose customer analytics API"
```

---

### Task 7: Dedicated Customer Analytics Settings UI

**Files:**
- Create: `src/components/workspace/modules/settings/components/customer-analytics-settings-card.test.tsx`
- Create: `src/components/workspace/modules/settings/components/customer-analytics-settings-card.tsx`
- Modify: `src/components/workspace/modules/settings/components/index.ts`
- Modify: `src/components/workspace/modules/settings/settings-manager.test.tsx`
- Modify: `src/components/workspace/modules/settings/settings-manager.tsx`

- [ ] **Step 1: Write failing component and integration tests**

Assert:

- seven human-readable number fields render approved defaults from generic config state
- each input calls `onConfigFieldChange` with its exact system key
- Save calls the existing `onSaveConfig`
- non-admin fields and save are disabled with a readable message
- Settings page adds one collapsed `客户分析设置 / Customer Analytics Settings` section
- generic System Configuration behavior remains unchanged

- [ ] **Step 2: Verify RED**

```bash
npx jest src/components/workspace/modules/settings/components/customer-analytics-settings-card.test.tsx src/components/workspace/modules/settings/settings-manager.test.tsx --runInBand
```

- [ ] **Step 3: Implement the focused settings card**

Use `Input type="number" min/max/step="1"`, labels such as `正常期限（天） / Normal term (days)`, and the existing generic config state:

```tsx
<CustomerAnalyticsSettingsCard
  config={config}
  canEdit={canEditConfig}
  saving={savingConfig}
  tx={tx}
  onFieldChange={updateConfigField}
  onSave={handleSaveConfig}
/>
```

Do not duplicate backend cross-field validation in a second authoritative frontend formula. Inputs may show a concise ascending-order hint; backend remains final authority.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npx jest src/components/workspace/modules/settings/components/customer-analytics-settings-card.test.tsx src/components/workspace/modules/settings/settings-manager.test.tsx --runInBand
git add src/components/workspace/modules/settings
git commit -m "feat: add customer analytics settings UI"
```

---

### Task 8: Dashboard Registry, Shared Pager, And Ranking Card

**Files:**
- Modify: `src/lib/dashboard-layout-preference.test.ts`
- Modify: `src/lib/dashboard-layout-preference.ts`
- Create: `src/components/workspace/modules/dashboard/components/dashboard-card-pagination.test.tsx`
- Create: `src/components/workspace/modules/dashboard/components/dashboard-card-pagination.tsx`
- Create: `src/components/workspace/modules/dashboard/components/customer-analytics-card.test.tsx`
- Create: `src/components/workspace/modules/dashboard/components/customer-analytics-card.tsx`
- Create: `src/components/workspace/modules/dashboard/components/customer-analytics-risk-indicator.test.tsx`
- Create: `src/components/workspace/modules/dashboard/components/customer-analytics-risk-indicator.tsx`
- Modify: `src/components/workspace/modules/dashboard/dashboard-view.test.tsx`
- Modify: `src/components/workspace/modules/dashboard/dashboard-view.tsx`

- [ ] **Step 1: Add failing layout-registry tests**

Update expected default card order to place `customer-analytics` in `analysis` after `customer-outstanding-ranking` and before `order-receipt-search`. Assert old saved layouts automatically receive the new default-visible card exactly once.

- [ ] **Step 2: Add failing shared-pager tests**

Extract the existing Dashboard card footer behavior into a component that renders only previous arrow, `1 / 2 (15)`, and next arrow; no page-size selector. Assert disabled boundaries and `mt-auto`/fixed-bottom-compatible wrapper.

- [ ] **Step 3: Add failing ranking-card tests**

Mock `apiCall` and assert:

- only annual ranking loads on mount
- three compact tabs exist and switching first loads the selected metric once
- switching back uses successful in-memory results
- annual tab shows current returned year and changes request when year selection changes
- four row fields render: rank, company-name fallback, MARK, active value
- capacity keeps zero rows
- cycle shows icon/color/`52d`, but no persistent `轻微拖延` text
- question-mark help opens on desktop hover/focus and mobile click, and contains the applied period/formula/quality counts
- risk explanation opens on hover/focus and tap while the persistent row remains icon/color/`52d` only
- each tab preserves its own page and shows exactly 10 rows
- active metric error has Retry and does not remove the card
- clicking a row emits a detail request/open action for the active metric only

- [ ] **Step 4: Verify RED**

```bash
npx jest src/lib/dashboard-layout-preference.test.ts src/components/workspace/modules/dashboard/components/dashboard-card-pagination.test.tsx src/components/workspace/modules/dashboard/components/customer-analytics-risk-indicator.test.tsx src/components/workspace/modules/dashboard/components/customer-analytics-card.test.tsx src/components/workspace/modules/dashboard/dashboard-view.test.tsx --runInBand
```

- [ ] **Step 5: Implement registry and shared pager**

Add:

```ts
{ id: 'customer-analytics', sectionId: 'analysis', defaultOrder: 25, zh: '客户分析', en: 'Customer Analytics' }
```

Extract existing Released/Outstanding pagination footer to `DashboardCardPagination` and use it for those cards plus Customer Analytics, preserving existing visible output.

- [ ] **Step 6: Implement ranking card with frontend-only presentation state**

The card owns:

```ts
type MetricState = Record<CustomerAnalyticsMetric, {
  loading: boolean;
  error: string;
  response: CustomerAnalyticsRankingResponse | null;
  page: number;
}>;
```

Use `apiCall('dashboard/customer-analytics?...')`, `Tabs`, `Tooltip`, `Popover`, existing USD formatter, and Lucide icons. Slice returned lightweight rows locally by 10. Do not recompute or reclassify risk; use the server's `riskBand.id` only to select the approved icon/CSS mapping.

Implement help/risk triggers as real buttons. Wrap them with a desktop/focus Tooltip and open a controlled Popover from click/tap so mobile users receive the same bilingual explanation without relying on hover.

Render `<CustomerAnalyticsCard />` from the `customer-analytics` branch of `renderDashboardCard` so unrelated Dashboard state remains untouched.

- [ ] **Step 7: Verify GREEN and commit**

```bash
npx jest src/lib/dashboard-layout-preference.test.ts src/components/workspace/modules/dashboard/components/dashboard-card-pagination.test.tsx src/components/workspace/modules/dashboard/components/customer-analytics-risk-indicator.test.tsx src/components/workspace/modules/dashboard/components/customer-analytics-card.test.tsx src/components/workspace/modules/dashboard/dashboard-view.test.tsx --runInBand
git add src/lib/dashboard-layout-preference.ts src/lib/dashboard-layout-preference.test.ts src/components/workspace/modules/dashboard
git commit -m "feat: add customer analytics dashboard card"
```

---

### Task 9: Metric-Specific Evidence Dialogs And Mobile Behavior

**Files:**
- Create: `src/components/workspace/modules/dashboard/components/customer-analytics-detail-dialog.test.tsx`
- Create: `src/components/workspace/modules/dashboard/components/customer-analytics-detail-dialog.tsx`
- Modify: `src/components/workspace/modules/dashboard/components/customer-analytics-card.test.tsx`
- Modify: `src/components/workspace/modules/dashboard/components/customer-analytics-card.tsx`

- [ ] **Step 1: Write failing dialog tests**

Assert three independent evidence layouts:

- annual: ORDER NO, INV NO, release date, amount, and reconciled total
- capacity: 12 chronological month rows, monthly totals, contributing receipt evidence, and average
- cycle: eligible count/amount, current overdue, within-terms amount, and order rows with amount/paid/outstanding/days/server risk icon

Also assert loading, readable error plus Retry, refreshed `asOf` notice when detail differs from ranking, keyboard-close behavior, `max-h-[calc(100dvh-...)]`, internal vertical scrolling, and no viewport-level mobile overflow.

- [ ] **Step 2: Verify RED**

```bash
npx jest src/components/workspace/modules/dashboard/components/customer-analytics-detail-dialog.test.tsx src/components/workspace/modules/dashboard/components/customer-analytics-card.test.tsx --runInBand
```

- [ ] **Step 3: Implement lazy detail loading and responsive evidence**

The card passes only server DTOs:

```tsx
<CustomerAnalyticsDetailDialog
  open={Boolean(selectedCustomer)}
  metric={activeMetric}
  customer={selectedCustomer}
  rankingAsOf={activeResponse?.asOf || null}
  year={activeMetric === 'annual-amount' ? selectedYear : undefined}
  onOpenChange={handleOpenChange}
/>
```

The dialog independently calls the detail API and uses `formatAppDate`, `formatAppDateTime`, and `formatUsdAmount`. Tables use `whitespace-nowrap` where required and an internal `overflow-x-auto` wrapper only when content exceeds available width.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npx jest src/components/workspace/modules/dashboard/components/customer-analytics-detail-dialog.test.tsx src/components/workspace/modules/dashboard/components/customer-analytics-card.test.tsx --runInBand
git add src/components/workspace/modules/dashboard/components
git commit -m "feat: add customer analytics evidence dialogs"
```

---

### Task 10: Isolated API Regression And Authorization Proof

**Files:**
- Create: `tests/api/isolated/cases/36-dashboard-customer-analytics.case.mjs`
- Modify: `docs/API_TESTING.md`

- [ ] **Step 1: Add an isolated MariaDB API case**

Create SALES A, SALES B, and USER A branches plus visible/hidden customers. Use dates derived from the runtime date so releases remain in the current Conakry year and payment receipts land in the previous completed month.

The case must assert:

- USER A sees only its visible customer in annual/capacity/cycle rankings
- ADMIN sees both branches
- annual result uses release date and selected year
- capacity returns average monthly amount and includes zero-payment visible customer
- cycle exposes a partial-payment/open-balance customer with nonzero weighted days
- detail totals reconcile with ranking result
- hidden customer detail returns 404/403 for USER A
- same receipt appears once
- non-admin cannot update global analytics settings
- ADMIN can update valid thresholds and reversed thresholds fail without partial persistence

- [ ] **Step 2: Run the isolated case**

```bash
bash scripts/test-api-isolated.sh --case 36-dashboard-customer-analytics
```

Expected: temporary MariaDB/app starts, all assertions PASS, and cleanup removes the test volume/project.

- [ ] **Step 3: Document authenticated curl examples and commit**

Add ranking/detail/settings examples to `docs/API_TESTING.md`, including date/visibility semantics.

```bash
git add tests/api/isolated/cases/36-dashboard-customer-analytics.case.mjs docs/API_TESTING.md
git commit -m "test: verify customer analytics API flow"
```

---

### Task 11: Documentation, Backup Coverage, Version, And Final Gates

**Files:**
- Modify: `.env.example`
- Modify: `src/lib/api-catalog.ts` if Task 6 did not finalize examples
- Modify: `docs/backup/muledger-cos-backup.md`
- Modify: `README.md`
- Modify: `ENGINEERING_LOG.md`
- Modify: `todolist.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Update configuration and backup documentation**

Add seven optional environment defaults to `.env.example`. In the backup runbook, state that Customer Analytics rules persist as SystemSetting rows in the existing `trading_ledger` MySQL dump, no media path changes, and restore verification must confirm settings plus all three API rankings.

- [ ] **Step 2: Update user and engineering documentation**

- README: one concise customer-analysis capability summary, not formula internals.
- ENGINEERING_LOG: backend architecture, formula source, settings/audit, tests, and no-persisted-ranking decision.
- todolist: mark the requested feature complete only after all gates pass.
- API catalog/testing docs: exact ranking/detail actions and settings keys.

- [ ] **Step 3: Bump the single-source version**

```bash
npm version 1.0.195 --no-git-tag-version
```

If `main` already has `1.0.195`, use the next patch number instead and keep package/lock synchronized.

- [ ] **Step 4: Run targeted suites**

```bash
npx jest \
  src/lib/customer-analytics.test.ts \
  src/lib/customer-analytics-settings.test.ts \
  src/lib/customer-analytics-service.test.ts \
  src/app/api/dashboard/customer-analytics/route.test.ts \
  src/lib/system-settings.test.ts \
  src/lib/settings-service.test.ts \
  src/lib/dashboard-layout-preference.test.ts \
  src/components/workspace/modules/settings/components/customer-analytics-settings-card.test.tsx \
  src/components/workspace/modules/settings/settings-manager.test.tsx \
  src/components/workspace/modules/dashboard/components/dashboard-card-pagination.test.tsx \
  src/components/workspace/modules/dashboard/components/customer-analytics-risk-indicator.test.tsx \
  src/components/workspace/modules/dashboard/components/customer-analytics-card.test.tsx \
  src/components/workspace/modules/dashboard/components/customer-analytics-detail-dialog.test.tsx \
  src/components/workspace/modules/dashboard/dashboard-view.test.tsx \
  --runInBand
```

- [ ] **Step 5: Run full pre-deployment gates sequentially**

```bash
git diff --check
npm run typecheck
npm run lint
npm test -- --runInBand
npm run test:api:isolated -- --case 36-dashboard-customer-analytics
npm run test:e2e:isolated
npm run build
npm run i18n:audit
```

Expected: every command exits 0. Record exact test-suite/test counts and any existing non-blocking dependency audit warning separately.

- [ ] **Step 6: Review requirements and data safety**

Verify line by line against the approved design. Confirm:

- no Prisma schema/migration or media directory change
- SystemSetting remains inside the MySQL backup scope
- no code writes rankings, balances, orders, receipts, or customers during analytics reads
- all detail routes re-check visibility
- frontend contains no financial formula
- Docker compose/NAS paths are unchanged

- [ ] **Step 7: Commit, push, and wait for CI**

```bash
git add .env.example README.md ENGINEERING_LOG.md todolist.md docs package.json package-lock.json src tests
git commit -m "feat: add dashboard customer analytics"
git push origin <feature-branch>
gh run list --branch <feature-branch>
```

Wait until GitHub Actions completes. If CI fails, inspect exact logs, fix, rerun local affected/full gates, push, and wait again. Do not report completion while CI is pending.

- [ ] **Step 8: Take and verify the normal business-data backup before local-service deployment**

```bash
scripts/backup/muledger-cos-backup.sh --dry-run
scripts/backup/muledger-cos-backup.sh --check-cos
```

Record the database object, SHA256 object, manifest object, and Git commit in the release evidence. No restore drill is required because no new table/storage engine/path is introduced, but the backup command must succeed before touching the existing app service.

- [ ] **Step 9: Merge only after review, then safely rebuild the current local app**

After review approval and merge to `main`:

```bash
bash scripts/rebuild-local-app.sh
```

If the script fails, report the complete output, failed phase, exit code, relevant `docker compose logs`, and whether MySQL, Docker volumes, or the NAS upload mount were touched. Never hide or summarize away the error.

- [ ] **Step 10: Verify the running service**

```bash
docker compose ps
docker inspect -f '{{.Name}} restarts={{.RestartCount}} status={{.State.Status}}' \
  trading-ledger-system-app-1 trading-ledger-system-maintenance-1
docker compose logs --no-color --tail=160 app maintenance
```

Use authenticated API probes for all three ranking actions, one detail action, current settings defaults, and a lower-scope visibility check. Confirm UI version, Dashboard card default visibility, tab loading, help Popover, 10-row paging, and mobile dialog overflow in the isolated/browser test session before declaring closure.

---

## Completion Evidence Required

- Approved design reference and implementation commit(s).
- Targeted and full Jest counts with zero failures.
- Isolated API case output with visibility and formula assertions.
- Typecheck, lint, build, i18n audit, and isolated E2E exit codes.
- GitHub Actions URL and successful conclusion.
- Backup object paths, checksum verification, and manifest.
- Running version, container status/restart counts, migration status, and NAS mount unchanged.
- API sample results for annual amount, payment capacity, payment cycle, and detail reconciliation.
