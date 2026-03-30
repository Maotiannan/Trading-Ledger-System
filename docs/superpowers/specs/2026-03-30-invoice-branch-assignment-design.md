# Invoice Branch Assignment And Customer Owner Visibility Design

**Goal**
- Allow an ADMIN to reassign an invoice and all its orders to a descendant ADMIN branch.
- Make SALES visibility for invoices, receipts, details, and swifts follow the bound customer owner (`customer.ownerId`) instead of only the record creator.

**Scope**
- Backend service, route, audit, visibility helpers, invoice UI entry, API tests, service tests.
- No schema change unless implementation proves unavoidable.

## Design

### 1. Ownership reassignment
- Add a new invoice action that updates `Invoice.createdBy` and every child `Order.createdBy` in one transaction.
- Only a level-1 ADMIN can assign to a descendant ADMIN visible in that ADMIN tree.
- The reassignment is a real ownership move, not a parallel assignment field.

### 2. Visibility model correction
- Resource visibility for invoice/receipt/detail/swift/report will treat customer binding as `customer.ownerId`.
- This fixes SALES visibility for bound customers even when the customer row was created by another upstream admin.
- Existing creator-based visibility stays in place as an additional path for records directly created inside the branch.

### 3. UI
- In invoice management, show an ADMIN-only control per invoice to pick a descendant ADMIN and submit reassignment.
- After success, refresh the invoice list and preserve current UX conventions.

### 4. Testing
- Add failing service/API tests first for:
  - ADMIN can reassign invoice ownership to descendant ADMIN.
  - Non-admin or invalid target cannot reassign.
  - SALES can see customer-bound invoice/receipt/detail/swift resources.
- Re-run isolated API tests plus targeted unit tests.
