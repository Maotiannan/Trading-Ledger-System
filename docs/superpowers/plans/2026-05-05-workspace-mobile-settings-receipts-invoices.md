# Workspace Mobile / Settings / Receipts / Invoices Implementation Plan

> **Plan status:** `ARCHIVED_COMPLETED` as of 2026-07-17. The implementation is on `main`; unchecked boxes below are retained as the original execution checklist and are not active backlog. See [the status index](./README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve mobile usability across the eight workspace pages, collapse Settings sections, upgrade Receipt Management status filtering/pagination, and change Invoice Management default ordering.

**Architecture:** Keep backend changes minimal and localized. Mobile improvements stay in page-level layout/components, receipt filtering expands the existing list query shape to multi-status while preserving backward compatibility, and invoice ordering is applied in the invoice view-state layer so data storage and APIs remain unchanged.

**Tech Stack:** Next.js App Router, React, TypeScript, shadcn/ui, Jest/RTL, existing `apiCall` helpers and workspace module hooks.

---

## File Structure

### Existing files to modify
- `src/components/workspace/modules/dashboard/dashboard-view.tsx`
- `src/components/workspace/modules/customers/customer-manager.tsx`
- `src/components/workspace/modules/deletions/deletion-manager.tsx`
- `src/components/workspace/modules/details/detail-manager.tsx`
- `src/components/workspace/modules/invoices/invoice-manager.tsx`
- `src/components/workspace/modules/invoices/components/invoice-list.tsx`
- `src/components/workspace/modules/invoices/hooks/use-invoice-view-state.ts`
- `src/components/workspace/modules/receipts/receipt-manager.tsx`
- `src/components/workspace/modules/settings/settings-manager.tsx`
- `src/components/workspace/modules/swifts/swift-manager.tsx`
- `src/app/api/receipt/route.ts`
- `src/messages/en.json`
- `src/messages/zh.json`
- `README.md`
- `todolist.md`
- `ENGINEERING_LOG.md`
- `package.json`

### Existing tests to modify
- `src/components/workspace/modules/receipts/receipt-manager.test.tsx`
- `src/components/workspace/modules/details/detail-manager.test.tsx`
- `src/components/workspace/modules/swifts/swift-manager.test.tsx`

### New files to create
- `src/components/workspace/modules/settings/components/collapsible-settings-section.tsx`
- `src/components/workspace/modules/invoices/hooks/use-invoice-ordering.ts`
- `src/components/workspace/modules/invoices/hooks/use-invoice-ordering.test.ts`
- `src/components/workspace/modules/settings/settings-manager.test.tsx`
- `src/components/workspace/modules/invoices/invoice-manager.test.tsx`
- `src/components/workspace/modules/dashboard/dashboard-view.test.tsx`
- `src/components/workspace/modules/customers/customer-manager.test.tsx`
- `src/components/workspace/modules/deletions/deletion-manager.test.tsx`

---

### Task 1: Add receipt multi-status filtering and page-size controls

**Files:**
- Modify: `src/components/workspace/modules/receipts/receipt-manager.tsx`
- Modify: `src/app/api/receipt/route.ts`
- Modify: `src/components/workspace/modules/receipts/receipt-manager.test.tsx`

- [ ] **Step 1: Write failing tests for default selected statuses, page-size options, and multi-status query parsing**

```tsx
it('defaults to unfinished receipt statuses and excludes RECEIVED', async () => {
  render(<ReceiptManager />);
  expect(screen.getByLabelText('SR_Received')).toBeChecked();
  expect(screen.getByLabelText('RECEIVED')).not.toBeChecked();
});

it('resets to page 1 when page size changes', async () => {
  render(<ReceiptManager />);
  fireEvent.click(screen.getByText('Page 2'));
  fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '100' } });
  expect(screen.getByText('Page 1')).toHaveAttribute('data-active', 'true');
});
```

```ts
it('accepts repeated status query values and applies them all', async () => {
  const request = new NextRequest('http://localhost/api/receipt?status=SR_Received&status=Waiting_SWIFT');
  const response = await GET(request);
  expect(response.status).toBe(200);
});
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/components/workspace/modules/receipts/receipt-manager.test.tsx src/app/api/receipt/route.test.ts
```

Expected: failures for missing multi-select UI/page-size behavior or receipt route not handling multiple statuses.

- [ ] **Step 3: Implement minimal receipt-manager UI state for multi-select and page size**

```tsx
const defaultReceiptStatuses = ['SIGNING_PENDING', 'SR_Received', 'Waiting_SWIFT', 'Bank_Transfer'];
const [statusFilter, setStatusFilter] = useState<string[]>(defaultReceiptStatuses);
const [pageSize, setPageSize] = useState(30);
const pageSizeOptions = [30, 50, 100, 200];

statusFilter.forEach((status) => params.append('status', status));
const totalPages = Math.max(1, Math.ceil(receipts.length / pageSize));
const paginatedReceipts = receipts.slice((currentPage - 1) * pageSize, currentPage * pageSize);
```

```tsx
<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
  {receiptStatusOptions.map((status) => (
    <label key={status} className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={statusFilter.includes(status)}
        onChange={() => toggleStatusFilter(status)}
        aria-label={status}
      />
      <span>{status}</span>
    </label>
  ))}
</div>
<select aria-label="Rows per page" value={pageSize} onChange={(event) => handlePageSizeChange(Number(event.target.value))}>
  {pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}
</select>
```

- [ ] **Step 4: Implement backend multi-status query parsing with backward compatibility**

```ts
const statusFilters = request.nextUrl.searchParams.getAll('status').map((value) => value.trim()).filter(Boolean);
if (statusFilters.length > 0) {
  filters.push({ status: { in: statusFilters } });
} else {
  const singleStatus = request.nextUrl.searchParams.get('status');
  if (singleStatus) filters.push({ status: singleStatus });
}
```

- [ ] **Step 5: Re-run targeted tests**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/components/workspace/modules/receipts/receipt-manager.test.tsx src/app/api/receipt/route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace/modules/receipts/receipt-manager.tsx src/app/api/receipt/route.ts src/components/workspace/modules/receipts/receipt-manager.test.tsx src/app/api/receipt/route.test.ts
git commit -m "feat: add receipt multi-status filters and page sizes"
```

### Task 2: Make Settings sections collapsible

**Files:**
- Create: `src/components/workspace/modules/settings/components/collapsible-settings-section.tsx`
- Modify: `src/components/workspace/modules/settings/settings-manager.tsx`
- Modify: `src/components/workspace/modules/settings/components/index.ts` (if needed for exports)
- Test: `src/components/workspace/modules/settings/settings-manager.test.tsx`

- [ ] **Step 1: Write failing test for collapsible Settings sections**

```tsx
it('renders settings cards inside collapsible sections', async () => {
  render(<SettingsManager />);
  expect(screen.getByRole('button', { name: /Password Settings/i })).toBeInTheDocument();
  expect(screen.queryByText(/User management has been moved into Settings/i)).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /User Management/i }));
  expect(screen.getByText(/User management has been moved into Settings/i)).toBeVisible();
});
```

- [ ] **Step 2: Run the settings test and confirm failure**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/components/workspace/modules/settings/settings-manager.test.tsx
```

Expected: fail because test file/component structure does not exist yet.

- [ ] **Step 3: Implement a reusable collapsible wrapper component**

```tsx
export function CollapsibleSettingsSection({ title, description, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button type="button" className="flex w-full items-center justify-between px-6 py-4 text-left" onClick={() => setOpen((prev) => !prev)}>
        <div>
          <div className="font-semibold">{title}</div>
          {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
        </div>
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? <CardContent>{children}</CardContent> : null}
    </Card>
  );
}
```

- [ ] **Step 4: Wrap each Settings feature block with collapsible sections**

```tsx
<CollapsibleSettingsSection title={tx('密码设置', 'Password Settings')} defaultOpen>
  <PasswordSettingsCard ... />
</CollapsibleSettingsSection>
<CollapsibleSettingsSection title={tx('用户管理', 'User Management')}>
  <UserManager />
</CollapsibleSettingsSection>
```

- [ ] **Step 5: Run the settings test again**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/components/workspace/modules/settings/settings-manager.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace/modules/settings/components/collapsible-settings-section.tsx src/components/workspace/modules/settings/settings-manager.tsx src/components/workspace/modules/settings/components/index.ts src/components/workspace/modules/settings/settings-manager.test.tsx
git commit -m "feat: collapse settings sections"
```

### Task 3: Apply mobile layout fixes across the eight workspace pages

**Files:**
- Modify: `src/components/workspace/modules/dashboard/dashboard-view.tsx`
- Modify: `src/components/workspace/modules/customers/customer-manager.tsx`
- Modify: `src/components/workspace/modules/deletions/deletion-manager.tsx`
- Modify: `src/components/workspace/modules/details/detail-manager.tsx`
- Modify: `src/components/workspace/modules/invoices/invoice-manager.tsx`
- Modify: `src/components/workspace/modules/invoices/components/invoice-list.tsx`
- Modify: `src/components/workspace/modules/receipts/receipt-manager.tsx`
- Modify: `src/components/workspace/modules/swifts/swift-manager.tsx`
- Test: `src/components/workspace/modules/dashboard/dashboard-view.test.tsx`
- Test: `src/components/workspace/modules/customers/customer-manager.test.tsx`
- Test: `src/components/workspace/modules/deletions/deletion-manager.test.tsx`
- Test: `src/components/workspace/modules/details/detail-manager.test.tsx`
- Test: `src/components/workspace/modules/swifts/swift-manager.test.tsx`
- Test: `src/components/workspace/modules/receipts/receipt-manager.test.tsx`

- [ ] **Step 1: Write failing mobile-oriented rendering tests for page toolbars and wide-content containment**

```tsx
it('wraps receipt primary actions instead of requiring horizontal drag', () => {
  render(<ReceiptManager />);
  expect(screen.getByTestId('receipt-manager-primary-actions')).toHaveClass('flex-wrap');
});

it('contains approval tables in an explicit horizontal scroll container', () => {
  render(<DeletionManager />);
  expect(screen.getByTestId('approval-receipt-edit-table')).toHaveClass('overflow-x-auto');
});
```

- [ ] **Step 2: Run the targeted page tests and confirm failure**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/components/workspace/modules/receipts/receipt-manager.test.tsx src/components/workspace/modules/details/detail-manager.test.tsx src/components/workspace/modules/swifts/swift-manager.test.tsx src/components/workspace/modules/dashboard/dashboard-view.test.tsx src/components/workspace/modules/customers/customer-manager.test.tsx src/components/workspace/modules/deletions/deletion-manager.test.tsx
```

Expected: failures for missing wrappers/classes or missing new test files.

- [ ] **Step 3: Implement mobile-safe wrapping and stacking patterns page by page**

```tsx
<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
  <h2 className="text-2xl font-bold">...</h2>
  <div data-testid="receipt-manager-primary-actions" className="flex flex-wrap gap-2">...</div>
</div>
```

```tsx
<CardContent className="pt-6 grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
```

```tsx
<div data-testid="approval-receipt-edit-table" className="overflow-x-auto">
  <table className="w-full min-w-[720px] text-sm">...</table>
</div>
```

- [ ] **Step 4: Re-run the targeted page tests**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/components/workspace/modules/receipts/receipt-manager.test.tsx src/components/workspace/modules/details/detail-manager.test.tsx src/components/workspace/modules/swifts/swift-manager.test.tsx src/components/workspace/modules/dashboard/dashboard-view.test.tsx src/components/workspace/modules/customers/customer-manager.test.tsx src/components/workspace/modules/deletions/deletion-manager.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/modules/dashboard/dashboard-view.tsx src/components/workspace/modules/customers/customer-manager.tsx src/components/workspace/modules/deletions/deletion-manager.tsx src/components/workspace/modules/details/detail-manager.tsx src/components/workspace/modules/invoices/invoice-manager.tsx src/components/workspace/modules/invoices/components/invoice-list.tsx src/components/workspace/modules/receipts/receipt-manager.tsx src/components/workspace/modules/swifts/swift-manager.tsx src/components/workspace/modules/dashboard/dashboard-view.test.tsx src/components/workspace/modules/customers/customer-manager.test.tsx src/components/workspace/modules/deletions/deletion-manager.test.tsx src/components/workspace/modules/details/detail-manager.test.tsx src/components/workspace/modules/swifts/swift-manager.test.tsx src/components/workspace/modules/receipts/receipt-manager.test.tsx
git commit -m "feat: improve workspace mobile layouts"
```

### Task 4: Implement invoice ordering hook and wire it into Invoice Management

**Files:**
- Create: `src/components/workspace/modules/invoices/hooks/use-invoice-ordering.ts`
- Test: `src/components/workspace/modules/invoices/hooks/use-invoice-ordering.test.ts`
- Modify: `src/components/workspace/modules/invoices/hooks/use-invoice-view-state.ts`
- Test: `src/components/workspace/modules/invoices/invoice-manager.test.tsx`

- [ ] **Step 1: Write failing ordering tests**

```ts
it('puts active invoices before completed invoices and null ship dates first in each group', () => {
  const result = orderInvoicesForDisplay([
    { id: 'done-dated', invBalance: 0, shipDate: '2026-05-02T00:00:00.000Z' },
    { id: 'active-dated', invBalance: 10, shipDate: '2026-05-03T00:00:00.000Z' },
    { id: 'active-null', invBalance: 10, shipDate: null },
    { id: 'done-null', invBalance: 0, shipDate: null },
  ] as Invoice[]);
  expect(result.map((row) => row.id)).toEqual(['active-null', 'active-dated', 'done-null', 'done-dated']);
});
```

- [ ] **Step 2: Run the ordering tests and confirm failure**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/components/workspace/modules/invoices/hooks/use-invoice-ordering.test.ts src/components/workspace/modules/invoices/invoice-manager.test.tsx
```

Expected: fail because ordering hook/test file does not exist yet.

- [ ] **Step 3: Implement isolated invoice ordering helper and apply it in invoice view state**

```ts
export function orderInvoicesForDisplay(invoices: Invoice[]): Invoice[] {
  return [...invoices].sort((left, right) => {
    const leftCompleted = left.invBalance <= 0 ? 1 : 0;
    const rightCompleted = right.invBalance <= 0 ? 1 : 0;
    if (leftCompleted !== rightCompleted) return leftCompleted - rightCompleted;

    const leftShip = left.shipDate ? Date.parse(left.shipDate) : Number.NEGATIVE_INFINITY;
    const rightShip = right.shipDate ? Date.parse(right.shipDate) : Number.NEGATIVE_INFINITY;
    return leftShip - rightShip;
  });
}
```

```ts
const result = await apiCall(endpoint);
if (result.success) {
  setInvoices(orderInvoicesForDisplay(result.data));
}
```

- [ ] **Step 4: Re-run the invoice ordering tests**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/components/workspace/modules/invoices/hooks/use-invoice-ordering.test.ts src/components/workspace/modules/invoices/invoice-manager.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/modules/invoices/hooks/use-invoice-ordering.ts src/components/workspace/modules/invoices/hooks/use-invoice-ordering.test.ts src/components/workspace/modules/invoices/hooks/use-invoice-view-state.ts src/components/workspace/modules/invoices/invoice-manager.test.tsx
git commit -m "feat: reorder invoices by outstanding and ship date"
```

### Task 5: Full verification, docs, version, and local runtime sync

**Files:**
- Modify: `README.md`
- Modify: `todolist.md`
- Modify: `ENGINEERING_LOG.md`
- Modify: `package.json`

- [ ] **Step 1: Bump version and document the feature set**

```json
{
  "version": "1.0.116"
}
```

Document updates must mention:
- mobile usability improvements across the eight pages
- settings collapsible sections
- receipt status multi-select + page size defaults/options
- invoice ordering changes

- [ ] **Step 2: Run build and full CI-equivalent suite**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm run build
npm run test:ci
```

Expected:
- build succeeds
- all Jest / isolated API / isolated Playwright checks pass

- [ ] **Step 3: Rebuild local Docker service**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
docker compose up -d --build
curl -k -I https://localhost
```

Expected:
- containers restart successfully
- localhost returns `HTTP/2 200`

- [ ] **Step 4: Commit and push**

```bash
git add README.md todolist.md ENGINEERING_LOG.md package.json
git commit -m "docs: sync mobile settings receipts and invoices updates"
git push origin main
```

---

## Self-Review

### Spec coverage
- Mobile usability across eight pages: covered by Task 3.
- Settings collapsible sections: covered by Task 2.
- Receipt Management multi-select + pagination defaults/options: covered by Task 1.
- Invoice ordering rules with active/completed grouping and null shipDate first: covered by Task 4.

No gaps found.

### Placeholder scan
- No `TODO/TBD` placeholders remain.
- All code-change tasks include concrete file paths, commands, and code snippets.

### Type consistency
- Receipt status filter is consistently modeled as `string[]` in UI/query handling.
- Invoice ordering helper name is consistently `orderInvoicesForDisplay`.
- Settings collapsible wrapper naming is consistent across task steps.
