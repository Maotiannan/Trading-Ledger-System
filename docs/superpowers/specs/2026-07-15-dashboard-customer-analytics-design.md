# Dashboard Customer Analytics Design

## 1. Objective

Add one default-visible `Customer Analytics / 客户分析` card to Dashboard. The card contains three small tabs that replace the card body with independent customer rankings:

1. `Order Amount / 下单金额`
2. `Payment Capacity / 付款能力`
3. `Payment Cycle / 付款周期`

All financial and statistical calculations run in one independent backend analytics domain. Frontend code only requests and renders calculated rankings and evidence. It must not duplicate formulas.

## 2. Confirmed Business Rules

### 2.1 Shared identity and visibility

- One `Customer` record produces at most one row in each ranking, even when it owns multiple ORDER_NAME values.
- Customer display name uses `companyName` when present, otherwise `name`.
- Each row shows rank, customer display name, MARK, and only the active metric value.
- Every query inherits the authenticated account's existing management-tree visibility. A user must not infer a customer, order, invoice, or receipt outside that scope from either ranking or detail responses.
- All authenticated roles may view the card. Existing per-account Dashboard preferences control card visibility and ordering.

### 2.2 Shared time and receipt rules

- All period boundaries and calendar-day calculations use `Africa/Conakry`.
- Every response fixes one server-generated `asOf` timestamp. All calculations in that response use the same timestamp.
- A receipt is financially included through the existing shared financial rule: include every formal receipt and exclude only `SIGNING_PENDING`.
- Payment occurrence date uses `Receipt.date`; when missing, use `Receipt.createdAt` and increment the fallback-data count.
- A receipt whose effective payment date is after `asOf` is excluded from the current calculation and counted as future-dated data.
- Attribute a receipt once through its canonical bound order and that order's customer. A slash-delimited display ORDER NO never duplicates the receipt amount.
- An unbound receipt cannot be attributed to a customer and is excluded with an explicit data-quality count.
- Deposit receipts are real payments and are included under the same rules.

## 3. Metric Definitions

### 3.1 Order Amount

The user-facing tab remains `Order Amount / 下单金额`, but year attribution uses invoice release date, not shipment date.

For selected natural year `Y`:

```text
customer annual amount = sum(Order.amount)
where Order.invoice.releaseDate falls inside year Y in Africa/Conakry
```

Rules:

- Default to the current Conakry natural year.
- Offer years found in release-dated visible data.
- Group all qualifying financial orders by canonical `customerId`.
- Sort amount descending, then customer display name and customer ID for deterministic ties.
- Include only customers with a positive eligible annual amount.
- Exclude `DEPOSIT_POOL` and `Un_Associated` invoices.
- Exclude orders whose invoice has no release date and return their count and amount as data-quality metadata.
- The detail response lists ORDER NO, INV NO, release date, and order amount, sorted by release date descending and then ORDER NO.

### 3.2 Payment Capacity

The configured lookback defaults to 12 completed natural months. For an `asOf` date in July 2026, the default closed period is `[2025-07-01, 2026-07-01)` in Africa/Conakry.

```text
customer payment capacity = included receipt total inside the closed period / lookback months
```

Rules:

- Months with no payment contribute zero; always divide by the configured number of months.
- Include deposits and all other formal order-bound receipts.
- Count the full valid receipt amount once. An overpayment is still actual money received and remains part of payment capacity.
- Include every visible customer, including customers whose result is zero.
- Sort average monthly amount descending, then customer display name and customer ID.
- The detail response returns every month in chronological order with its total, plus the contributing receipt evidence needed to reconcile each monthly total.

### 3.3 Payment Cycle

Payment cycle is amount-weighted payment days, not a simple average of orders and not the final settlement date of an entire order.

#### Eligible orders

- A fully paid order participates when its release date falls in the previous configured number of completed natural months. “Fully paid” means included positive receipts dated no later than `asOf` cover the order amount.
- An open order older than the configured normal period participates regardless of how old it is. Old unpaid debt must never disappear because it passed the lookback boundary.
- An open order aged from 0 through the normal-day threshold does not enter the cycle denominator. Its remaining amount is returned separately as `withinTermsOutstanding`.
- A customer enters the ranking with one eligible order; low sample size never hides overdue risk.
- Orders without release dates cannot participate.
- Orders with non-positive amounts are excluded and counted as invalid data.

#### Order timeline

For an eligible order with amount `A` and release date `R`:

1. Sort included receipts by effective payment date and stable receipt ID.
2. Cap payment allocation at the order's remaining amount so overpayment cannot create negative exposure.
3. Amounts paid on or before `R` contribute zero days and reduce the balance exposed at release.
4. Amounts paid after `R` contribute `allocated amount × calendar days from R to payment date`.
5. Remaining unpaid amount contributes `remaining amount × calendar days from R to asOf`.

```text
order dollar-days =
  sum(allocated paid amount × payment days)
  + unpaid amount × age at asOf

customer payment-cycle days =
  sum(order dollar-days) / sum(eligible order amounts)
```

Money accumulation must use the project's precise money/decimal handling rather than unbounded floating-point addition. Display and risk classification use the rounded whole-day result; sorting uses the unrounded result and then overdue amount/customer identity as stable tie-breakers.

Example:

```text
Order amount:       $100,000
Paid before release: $30,000 ×   0 days
Paid after release:  $40,000 ×  40 days
Paid after release:  $20,000 × 100 days
Still unpaid:        $10,000 × 160 days

Payment cycle = 52 days
```

#### Risk bands

Defaults are globally configurable and strictly increasing:

| Rounded days | Persistent row treatment | Tooltip meaning |
|---|---|---|
| 0-30 | Green check | Normal / 正常 |
| 31-59 | Yellow clock | Mild delay / 轻微拖延 |
| 60-89 | Amber reminder | Some delay / 有点拖延 |
| 90-119 | Orange alert | Delayed / 拖延 |
| 120-149 | Red warning | Warning / 警告 |
| 150-179 | Dark-red double warning | Double warning / 加倍警告 |
| 180+ | Severe alarm icon | Severe warning / 严重警告 |

Ranking rows do not persistently print the Chinese risk label. They show a distinct icon, color, and whole-day value such as `52d`. Desktop hover/focus and mobile tap expose the bilingual band explanation.

Sort highest payment-cycle days first. If exact values tie, sort current overdue amount descending, then customer display name and customer ID.

The detail response lists contributing orders with ORDER NO, INV NO, release date, order amount, paid amount, outstanding amount, payment-cycle days, and visual risk band. It also returns eligible order count, eligible total amount, current overdue amount, and amount still inside normal terms.

## 4. UI Design

### 4.1 Card

- Register `customer-analytics` in the existing Dashboard `analysis` section, visible by default and compatible with existing account-specific hide/reorder settings.
- Place three compact tabs at the top of the card body. Switching tabs replaces the ranking body; metrics never share one table.
- Default to Order Amount.
- Show the year selector only on Order Amount.
- Show one question-mark control near the card title. Desktop hover and keyboard focus show its content; mobile tap opens the same content in a popover/dialog.
- The rule explanation includes effective periods, release-date attribution, included receipt statuses, date fallback, deposit treatment, 30-day normal period, amount-weighted formula, risk thresholds, and data-quality exclusions.

### 4.2 Ranking and pagination

- Show 10 customers per page.
- Maintain independent page state for each tab.
- Keep the compact shared pager pinned to the bottom of the card so sparse pages do not move controls vertically.
- Use a fixed minimum card body height consistent with existing Dashboard analysis cards.
- Ranking rows are clickable and keyboard accessible.
- Mobile layout must avoid horizontal page overflow. Customer name may truncate visually with full text available on focus/tap; MARK and metric stay readable.

### 4.3 Metric-specific detail dialogs

- Clicking a customer opens only the active tab's evidence dialog.
- Load detail evidence lazily after the click.
- Desktop may use a wide responsive dialog. Mobile uses a viewport-bounded dialog with internal vertical scrolling and horizontally scrollable tables only when necessary.
- Dialog totals and row evidence must reconcile exactly with the ranking response generated under the same settings. If source data changed between requests, the detail response returns its own `asOf` and the UI states that the result was refreshed.

### 4.4 Loading and errors

- Load the default tab only after the Dashboard/card mounts.
- Load another metric only when first selected. Keep successful results in component memory for smooth local tab switching and pagination.
- A metric failure remains inside the card and does not break the Dashboard. Show a readable bilingual error and Retry action.
- Detail failure remains inside the dialog and can be retried.
- Empty rankings explain why they are empty rather than rendering a blank table.

## 5. Backend Architecture

### 5.1 Pure analytics domain

Create a focused backend domain module with no database or React dependency. Responsibilities:

- Conakry natural-year and completed-month boundaries.
- Receipt normalization and inclusion.
- Annual amount aggregation.
- Monthly payment-capacity aggregation.
- Per-order payment timeline and dollar-days.
- Customer payment-cycle aggregation.
- Risk-band classification.
- Deterministic ranking and data-quality counters.

The domain accepts normalized data plus settings and an injected `asOf`, making every formula deterministic and directly unit-testable.

### 5.2 Scoped read service

Create a separate service that:

- Resolves the current user's management-tree owner IDs.
- Applies existing Customer, Order, Invoice, and Receipt visibility builders.
- Loads each required dataset in bulk; no customer-by-customer queries.
- Uses canonical order/customer relations for attribution.
- Reads validated analytics settings once per request.
- Passes normalized inputs to the pure domain.
- Maps domain results to lightweight ranking and detailed evidence responses.

Current data volume supports live calculation. Do not persist derived rankings or introduce another balance-like cache. If later profiling demonstrates a real bottleneck, add an explicitly invalidated/materialized design as a separate project rather than silently caching stale rankings.

### 5.3 API

Add an authenticated route under:

```text
GET /api/dashboard/customer-analytics
```

Ranking request:

```text
?action=ranking&metric=annual-amount&year=2026
?action=ranking&metric=payment-capacity
?action=ranking&metric=payment-cycle
```

Detail request:

```text
?action=detail&metric=<metric>&customerId=<id>&year=<optional-year>
```

Ranking responses return all lightweight visible rows for smooth 10-row client pagination, plus:

- `asOf`
- metric period
- applied settings
- available release years
- data-quality counts
- total visible/result customers

Detail requests independently re-check customer visibility. They never trust a customer name, amount, year, or rank supplied by the client.

### 5.4 Consistency and observability

- Generate one `asOf` before data normalization and use it throughout the calculation.
- Prefer one bounded read transaction/snapshot where supported and beneficial; do not hold long transactions.
- Log structured timing, visible row counts, metric, and data-quality counts without logging unnecessary customer financial details.
- Invalid stored settings fall back to safe defaults and produce a structured warning; invalid updates are rejected before persistence.

## 6. Global Settings

Extend the existing database-backed system-setting pipeline with defaults:

```text
CUSTOMER_ANALYTICS_LOOKBACK_MONTHS=12
CUSTOMER_ANALYTICS_NORMAL_DAYS=30
CUSTOMER_ANALYTICS_MILD_DELAY_DAYS=60
CUSTOMER_ANALYTICS_DELAY_DAYS=90
CUSTOMER_ANALYTICS_WARNING_DAYS=120
CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS=150
CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS=180
```

Rules:

- Only ADMIN accounts can edit, matching current global-system-setting permissions.
- Lookback months must be a bounded positive integer.
- Day thresholds must be bounded integers and strictly increasing.
- Validate the complete proposed settings set, not individual fields in isolation.
- Save all submitted changes in the existing transaction.
- Reuse existing before/after settings audit records and cache invalidation.
- Add a separate collapsed `Customer Analytics Settings / 客户分析设置` section rather than crowding unrelated configuration UI.

No new persistence table is required. New rows live in the existing SystemSetting table, already covered by the MySQL backup. Update the backup documentation to explicitly note the new business-rule keys.

## 7. Data-Quality Behavior

The backend returns counts rather than silently ignoring problematic rows:

- orders missing release date
- amount excluded with missing release date
- receipts using created-time fallback
- receipts missing canonical order/customer attribution
- non-positive order or receipt values
- future-dated receipt values excluded from the current calculation

The question-mark explanation shows relevant non-zero counts. Detailed customer evidence must reconcile with the ranking value. Data-quality issues never grant access to out-of-scope rows.

For payment cycle, payment allocation is capped at the remaining order amount. For payment capacity, the complete positive receipt amount remains counted because it represents actual received money. Non-positive financial values are excluded and reported rather than silently changing the formula.

## 8. Automated Verification

### 8.1 Pure calculation tests

- Natural-year and previous-complete-month boundaries in Africa/Conakry.
- Annual amount grouping by canonical customer and release year.
- Customer with multiple ORDER_NAME values remains one row.
- Zero-payment customer remains in payment capacity.
- Receipt business date and creation-time fallback.
- Every valid receipt status included; `SIGNING_PENDING` excluded.
- Deposit before release contributes zero days and reduces opening balance.
- Partial payments produce the approved weighted example result of 52 days.
- Unpaid amount accrues to injected `asOf`.
- Open order at 30 days remains outside cycle; day 31 enters cycle.
- Fully paid recent order included; old fully paid order excluded.
- Old open overdue order remains included.
- Overpayment capped for cycle but fully counted for capacity.
- Missing release date and invalid values appear in quality counters.
- Exact risk boundaries at 30/31/59/60/89/90/119/120/149/150/179/180.
- Stable sorting and one-order minimum sample.

### 8.2 Service and API tests

- Bulk query shapes do not introduce N+1 behavior.
- Visibility is enforced for ADMIN, SALES, USER, and management-tree descendants.
- Ranking and detail cannot expose an out-of-scope customer.
- Ranking returns fixed `asOf`, applied settings, periods, and quality metadata.
- Annual year validation and unknown metric/action errors are readable.
- Detail totals reconcile with ranking fixtures.
- The same receipt is counted once.

### 8.3 Settings tests

- Non-admin updates rejected.
- Default settings returned when no database override exists.
- Reversed/equal thresholds rejected as one complete set.
- Valid updates persist transactionally and write before/after audit metadata.
- Invalid updates write nothing and do not invalidate a good cached configuration.

### 8.4 Frontend tests

- Three tabs render independent rankings and load on demand.
- Default tab and annual year selector behavior.
- Independent 10-row pages and fixed bottom pager.
- Customer display fallback and MARK.
- Risk rows show icon/color/days without persistent Chinese labels.
- Hover/focus/tap rule and risk explanations.
- Active-metric detail dialog only.
- Loading, empty, error, retry, stale-detail refresh, and mobile overflow behavior.
- New card participates in existing Dashboard layout normalization, hide/restore, and ordering.

### 8.5 Delivery gates

- Targeted unit, service, route, and component tests.
- Full lint, typecheck, Jest suite, and production build.
- Isolated authenticated API verification against a disposable/test deployment before touching the current service.
- Version single source, API testing catalog, engineering docs, README summary, backup documentation, and GitHub CI synchronized.
- Because system-setting rows change production data, take/verify the normal database backup before deployment even though no new table is introduced.

## 9. Non-Goals

- No AI-generated customer risk score.
- No browser-side financial calculation.
- No persisted/materialized ranking cache in the first implementation.
- No new customer credit limit or per-customer payment-term model.
- No replacement of existing Customer Outstanding Ranking.
- No automatic modification of orders, receipts, customers, or balances from analytics reads.
