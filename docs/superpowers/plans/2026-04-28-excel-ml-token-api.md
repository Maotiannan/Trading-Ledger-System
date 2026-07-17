# Excel ML Token API Implementation Plan

> **Plan status:** `ARCHIVED_COMPLETED` as of 2026-07-17. The implementation is on `main`; unchecked boxes below are retained as the original execution checklist and are not active backlog. See [the status index](./README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-account token-protected Excel lookup API so `=ML(A1, 1)` style functions can resolve an order number like `GANDO-10` into customer/order fields using the same visible data as the logged-in account.

**Architecture:** Persist hash-only Excel API tokens on `User`, expose session-authenticated token management from Settings, and authenticate lookup routes with `Authorization: Bearer <token>`. Keep lookup logic in a dedicated service that first reuses current order matching rules, then falls back to derived customer `orderName`, with field mapping centralized for both single and batch endpoints.

**Tech Stack:** Next.js App Router route handlers, Prisma/MySQL migrations, existing `withAuth`/`CurrentUser` and hierarchy helpers, Jest service/component tests, isolated API test harness, Docker Compose deployment.

---

## File Structure

- Create `src/lib/excel-token-service.ts`: token generation, SHA-256 hashing, bearer verification, user-scoped metadata, revoke/rotate operations.
- Create `src/lib/excel-token-service.test.ts`: unit coverage for token shape, hash-only storage, verification, revoke/expired handling, bearer validation.
- Create `src/lib/excel-ml-service.ts`: field catalog, order number normalization, visible customer resolution, plain text value conversion, batch result mapping.
- Create `src/lib/excel-ml-service.test.ts`: unit coverage for field fallback, order alias/existing order matching, derived order name fallback, permission isolation, conflict/not-found errors.
- Create `src/app/api/excel/token/route.ts`: session-cookie route for Settings token list/generate/revoke.
- Create `src/app/api/excel/ml/route.ts`: bearer-token single-field route for Excel and JSON diagnostics.
- Create `src/app/api/excel/ml/batch/route.ts`: bearer-token batch route.
- Create `tests/api/isolated/cases/90-excel-ml-token.case.mjs`: end-to-end isolated API coverage through real HTTP routes.
- Create `prisma/migrations/20260428160000_excel_api_tokens/migration.sql`: add persistent token table.
- Create `src/components/workspace/modules/settings/components/excel-token-card.tsx`: Settings UI for token status, one-time token display, rotate, revoke, and usage hint.
- Modify `prisma/schema.prisma`: add `ExcelApiToken` model and `User.excelApiTokens`.
- Modify `src/lib/api-error.ts`, `src/lib/api-error-catalog.ts`, `src/lib/api-success-catalog.ts`, `src/lib/audit-catalog.ts`, `src/lib/api-catalog.ts`: register stable error/success/audit/API catalog entries.
- Modify `src/lib/rate-limit.ts`, `src/lib/rate-limit.test.ts`, `src/lib/system-settings.ts`, `src/lib/system-settings.test.ts`, `src/components/workspace/modules/settings/components/system-config-card.tsx`: add configurable Excel lookup rate limits.
- Modify `src/components/workspace/modules/settings/types.ts`, `read-model.ts`, `page-view-model.ts`, `view-model.ts`, `hooks/use-settings-actions.ts`, `hooks/use-settings-forms.ts`, `settings-manager.tsx`, component exports and focused tests: wire Settings token UI.
- Modify `README.md`, `docs/API_TESTING.md`, `todolist.md`, `package.json`, `package-lock.json`: document API, test command, field mapping, and bump version.

---

### Task 1: Prisma Token Persistence

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260428160000_excel_api_tokens/migration.sql`

- [ ] **Step 1: Add a user relation and token model**

In `prisma/schema.prisma`, add `excelApiTokens ExcelApiToken[]` to `model User`, then add:

```prisma
model ExcelApiToken {
  id          String    @id @default(cuid())
  userId      String
  name        String    @default("Excel ML")
  tokenPrefix String    @unique @map("token_prefix")
  tokenHash   String    @map("token_hash")
  lastUsedAt  DateTime? @map("last_used_at")
  lastUsedIp  String?   @map("last_used_ip")
  revokedAt   DateTime? @map("revoked_at")
  expiresAt   DateTime? @map("expires_at")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, revokedAt])
  @@index([lastUsedAt])
}
```

- [ ] **Step 2: Add the SQL migration**

Create the migration SQL:

```sql
CREATE TABLE `ExcelApiToken` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL DEFAULT 'Excel ML',
  `token_prefix` VARCHAR(191) NOT NULL,
  `token_hash` VARCHAR(191) NOT NULL,
  `last_used_at` DATETIME(3) NULL,
  `last_used_ip` VARCHAR(191) NULL,
  `revoked_at` DATETIME(3) NULL,
  `expires_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `ExcelApiToken_token_prefix_key` ON `ExcelApiToken`(`token_prefix`);
CREATE INDEX `ExcelApiToken_userId_revoked_at_idx` ON `ExcelApiToken`(`userId`, `revoked_at`);
CREATE INDEX `ExcelApiToken_last_used_at_idx` ON `ExcelApiToken`(`last_used_at`);

ALTER TABLE `ExcelApiToken`
  ADD CONSTRAINT `ExcelApiToken_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Generate Prisma client**

Run: `npm run db:generate`

Expected: Prisma client generation succeeds without schema errors.

---

### Task 2: Token Service TDD

**Files:**
- Create: `src/lib/excel-token-service.test.ts`
- Create: `src/lib/excel-token-service.ts`
- Modify: `src/lib/api-error.ts`
- Modify: `src/lib/api-error-catalog.ts`
- Modify: `src/lib/api-success-catalog.ts`
- Modify: `src/lib/audit-catalog.ts`

- [ ] **Step 1: Write failing tests**

Create tests that mock `db.excelApiToken` and verify:

```ts
it('generates a one-time raw token and stores only its hash', async () => {
  const result = await generateExcelApiToken(currentUser, 'Excel desktop');
  expect(result.token).toMatch(/^ml_[A-Za-z0-9_-]{10,}_[A-Za-z0-9_-]{32,}$/);
  expect(db.excelApiToken.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      userId: currentUser.id,
      tokenHash: expect.not.stringContaining(result.token),
      tokenPrefix: expect.any(String),
    }),
  }));
});

it('verifies a bearer token and returns the token owner as CurrentUser', async () => {
  const auth = await verifyExcelApiTokenFromHeader(`Bearer ${rawToken}`, '127.0.0.1');
  expect(auth.user.id).toBe('sales-1');
});

it('rejects missing, revoked, expired, and malformed tokens with stable API errors', async () => {
  await expect(verifyExcelApiTokenFromHeader('', null)).rejects.toMatchObject({ code: 'EXCEL_TOKEN_REQUIRED', status: 401 });
  await expect(verifyExcelApiTokenFromHeader('Bearer bad', null)).rejects.toMatchObject({ code: 'EXCEL_TOKEN_INVALID', status: 401 });
});
```

- [ ] **Step 2: Run token tests and confirm RED**

Run: `npm test -- src/lib/excel-token-service.test.ts --runInBand`

Expected: fails because `excel-token-service.ts` does not exist.

- [ ] **Step 3: Implement token service**

Implement:

```ts
export async function listExcelApiTokens(currentUser: CurrentUser): Promise<ExcelApiTokenSummary[]>
export async function generateExcelApiToken(currentUser: CurrentUser, name?: string): Promise<{ token: string; tokenInfo: ExcelApiTokenSummary }>
export async function revokeExcelApiToken(currentUser: CurrentUser, tokenId: string): Promise<{ message: string }>
export async function verifyExcelApiTokenFromHeader(headerValue: string | null, ipAddress: string | null): Promise<{ user: CurrentUser; tokenId: string }>
export function getExcelApiTokenIp(request: NextRequest): string | null
```

Use `randomBytes(8)` for prefix, `randomBytes(32)` for secret, `createHash('sha256')` for storage, and `timingSafeEqual` for hash comparison. On generation, revoke existing active tokens for the same user before creating a new token so each account has one current Excel token. Select token owner fields matching `CurrentUser`: `id`, `email`, `name`, `role`, `parentId`, `active`.

- [ ] **Step 4: Register errors, successes, and audit constants**

Add error codes:

```ts
EXCEL_TOKEN_REQUIRED
EXCEL_TOKEN_INVALID
EXCEL_TOKEN_REVOKED
EXCEL_TOKEN_EXPIRED
EXCEL_TOKEN_NOT_FOUND
EXCEL_FIELD_INVALID
EXCEL_ORDER_NOT_FOUND
EXCEL_ORDER_CONFLICT
```

Add success keys for token generated/revoked/listed and ML lookup completed. Add audit actions:

```ts
EXCEL_TOKEN_LIST
EXCEL_TOKEN_GENERATE
EXCEL_TOKEN_REVOKE
EXCEL_ML_LOOKUP
EXCEL_ML_BATCH_LOOKUP
```

Use target types `EXCEL_API_TOKEN` and `EXCEL_ML_LOOKUP`.

- [ ] **Step 5: Run token tests and catalog tests**

Run: `npm test -- src/lib/excel-token-service.test.ts src/lib/api-error-catalog.test.ts src/lib/api-success-catalog.test.ts --runInBand`

Expected: all pass.

---

### Task 3: Excel ML Lookup Service TDD

**Files:**
- Create: `src/lib/excel-ml-service.test.ts`
- Create: `src/lib/excel-ml-service.ts`
- Modify: `src/lib/rate-limit.ts`
- Modify: `src/lib/system-settings.ts`

- [ ] **Step 1: Write failing lookup tests**

Create tests that mock Prisma and assert:

```ts
it('returns ORDER_NAME for field 1 after deriving it from order number', async () => {
  mockCustomerMatches([{ id: 'c1', orderName: 'GANDO', companyName: 'Gando LLC', name: 'Gando Customer', mark: 'M1' }]);
  await expect(resolveExcelMlValue(salesUser, { orderNo: 'GANDO-10', field: 1 })).resolves.toMatchObject({
    field: 1,
    fieldKey: 'ORDER_NAME',
    value: 'GANDO',
  });
});

it('returns company name with customer name fallback for field 2', async () => {
  mockCustomerMatches([{ id: 'c1', orderName: 'GANDO', companyName: '', name: 'Gando Customer' }]);
  const result = await resolveExcelMlValue(salesUser, { orderNo: 'GANDO-10', field: 2 });
  expect(result.value).toBe('Gando Customer');
});

it('returns MARK for field 3', async () => {
  mockCustomerMatches([{ id: 'c1', orderName: 'GANDO', mark: 'MK-88', name: 'Gando Customer' }]);
  await expect(resolveExcelMlValue(salesUser, { orderNo: 'GANDO-10', field: 3 })).resolves.toMatchObject({ value: 'MK-88' });
});

it('rejects ambiguous derived customer matches', async () => {
  mockCustomerMatches([{ id: 'c1', orderName: 'GANDO' }, { id: 'c2', orderName: 'GANDO' }]);
  await expect(resolveExcelMlValue(salesUser, { orderNo: 'GANDO-10', field: 2 })).rejects.toMatchObject({ code: 'EXCEL_ORDER_CONFLICT', status: 409 });
});
```

- [ ] **Step 2: Run lookup tests and confirm RED**

Run: `npm test -- src/lib/excel-ml-service.test.ts --runInBand`

Expected: fails because `excel-ml-service.ts` does not exist.

- [ ] **Step 3: Implement field catalog and resolver**

Implement:

```ts
export const EXCEL_ML_FIELDS = [
  { index: 1, key: 'ORDER_NAME', label: 'ORDER NAME' },
  { index: 2, key: 'DISPLAY_NAME', label: 'COMPANY NAME / CUSTOMER NAME' },
  { index: 3, key: 'MARK', label: 'MARK' },
  { index: 4, key: 'CUSTOMER_NAME', label: 'CUSTOMER NAME' },
  { index: 5, key: 'COMPANY_NAME', label: 'COMPANY NAME' },
  { index: 6, key: 'PHONE', label: 'PHONE' },
  { index: 7, key: 'CITY', label: 'CITY' },
  { index: 8, key: 'CONSIGNEE', label: 'CONSIGNEE' },
  { index: 9, key: 'COMPANY_ADDRESS', label: 'COMPANY ADDRESS' },
  { index: 10, key: 'CREDIT', label: 'CREDIT' },
  { index: 11, key: 'CUSTOMER_ID', label: 'CUSTOMER ID' },
] as const;
```

Use `normalizeOrderNo`, `canonicalizeOrderNo`, `extractOrderNameFromOrderNo`, `getHierarchyScope`, `ownerVisibleIds`, and existing order alias selection rules. For linked orders, return the unique linked visible customer. For fallback matches, query customers visible to the current user by `orderName = derivedOrderName`. Return 404 for zero matches and 409 for multiple matches.

- [ ] **Step 4: Add Excel rate-limit setting keys**

Add defaults:

```ts
EXCEL_LOOKUP_RATE_LIMIT_WINDOW_MS = '60000'
EXCEL_LOOKUP_RATE_LIMIT_MAX = '240'
```

Expose them through `getSystemSettings`, system config form metadata, and `createRateLimiter('excelLookup')`.

- [ ] **Step 5: Run lookup and settings tests**

Run: `npm test -- src/lib/excel-ml-service.test.ts src/lib/rate-limit.test.ts src/lib/system-settings.test.ts --runInBand`

Expected: all pass.

---

### Task 4: API Routes TDD

**Files:**
- Create: `src/app/api/excel/token/route.ts`
- Create: `src/app/api/excel/ml/route.ts`
- Create: `src/app/api/excel/ml/batch/route.ts`
- Create: `tests/api/isolated/cases/90-excel-ml-token.case.mjs`
- Modify: `src/lib/api-catalog.ts`
- Modify: `src/lib/api-catalog.test.ts`

- [ ] **Step 1: Add isolated API case**

The case must:

```js
export default async function runExcelMlTokenCase(ctx) {
  const admin = await ctx.loginAdmin();
  const tokenCreate = await admin.post('/api/excel/token', { action: 'generate', name: 'Excel test' });
  const token = tokenCreate.data.token;

  const customer = await admin.post('/api/customer', {
    action: 'add',
    mark: 'MK-GANDO',
    orderName: 'GANDO',
    name: 'Gando Customer',
    companyName: '',
  });

  await ctx.request.get('/api/excel/ml?orderNo=GANDO-10&field=1', {
    headers: { Authorization: `Bearer ${token}` },
  }).expectText('GANDO');

  await ctx.request.get('/api/excel/ml?orderNo=GANDO-10&field=2', {
    headers: { Authorization: `Bearer ${token}` },
  }).expectText('Gando Customer');

  await ctx.request.get('/api/excel/ml?orderNo=GANDO-10&field=3', {
    headers: { Authorization: `Bearer ${token}` },
  }).expectText('MK-GANDO');

  await admin.post('/api/excel/token', { action: 'revoke', id: tokenCreate.data.tokenInfo.id });
  await ctx.request.get('/api/excel/ml?orderNo=GANDO-10&field=1', {
    headers: { Authorization: `Bearer ${token}` },
  }).expectStatus(401);
}
```

Adapt helper names to the existing isolated test harness, but keep these assertions.

- [ ] **Step 2: Run isolated case and confirm RED**

Run: `npm run test:api:isolated -- --case 90-excel-ml-token`

Expected: fails because the routes do not exist.

- [ ] **Step 3: Implement token management route**

`GET /api/excel/token` returns current user token summaries. `POST /api/excel/token` accepts:

```json
{ "action": "generate", "name": "Excel desktop" }
{ "action": "revoke", "id": "token-id" }
```

Use `withAuth`, token service methods, `createApiSuccessResponse`, `toApiErrorResponse`, and audit events.

- [ ] **Step 4: Implement single lookup route**

`GET /api/excel/ml?orderNo=GANDO-10&field=2` authenticates via bearer token. Default response is `text/plain; charset=utf-8`. `format=json` returns:

```json
{
  "success": true,
  "data": {
    "orderNo": "GANDO-10",
    "field": 2,
    "fieldKey": "DISPLAY_NAME",
    "value": "Gando Customer",
    "customerId": "customer-id",
    "matchedBy": "derived-order-name"
  }
}
```

- [ ] **Step 5: Implement batch route**

`POST /api/excel/ml/batch` accepts:

```json
{
  "items": [
    { "orderNo": "GANDO-10", "field": 1 },
    { "orderNo": "GANDO-10", "field": 2 }
  ]
}
```

Return per-row success/errors in the same order. Auth failure rejects the whole request.

- [ ] **Step 6: Register API catalog**

Add `/api/excel/token`, `/api/excel/ml`, `/api/excel/ml/batch` to `api-catalog.ts`, mark lookup auth as bearer token, and include field mapping in route metadata.

- [ ] **Step 7: Run API tests**

Run:

```bash
npm test -- src/lib/api-catalog.test.ts --runInBand
npm run test:api:isolated -- --case 90-excel-ml-token
```

Expected: both pass.

---

### Task 5: Settings UI Integration

**Files:**
- Create: `src/components/workspace/modules/settings/components/excel-token-card.tsx`
- Modify: `src/components/workspace/modules/settings/components/index.ts`
- Modify: `src/components/workspace/modules/settings/types.ts`
- Modify: `src/components/workspace/modules/settings/read-model.ts`
- Modify: `src/components/workspace/modules/settings/page-view-model.ts`
- Modify: `src/components/workspace/modules/settings/view-model.ts`
- Modify: `src/components/workspace/modules/settings/hooks/use-settings-actions.ts`
- Modify: `src/components/workspace/modules/settings/hooks/use-settings-forms.ts`
- Modify: `src/components/workspace/modules/settings/settings-manager.tsx`
- Modify tests in `src/components/workspace/modules/settings/*.test.ts` and `hooks/*.test.tsx`

- [ ] **Step 1: Write focused Settings tests**

Add tests that assert settings bootstrap normalizes:

```ts
excelTokens: [{ id: 'tok-1', name: 'Excel ML', tokenPrefix: 'abc123', createdAt: '2026-04-28T00:00:00.000Z', lastUsedAt: null, revokedAt: null }]
```

Add hook tests that `generateExcelToken` calls `apiCall('excel/token', { method: 'POST', body: JSON.stringify({ action: 'generate', name: 'Excel ML' }) })`, stores the one-time raw token, and `revokeExcelToken` clears it.

- [ ] **Step 2: Run Settings tests and confirm RED**

Run:

```bash
npm test -- src/components/workspace/modules/settings/read-model.test.ts src/components/workspace/modules/settings/hooks/use-settings-actions.test.tsx --runInBand
```

Expected: tests fail because Settings has no Excel token state/actions.

- [ ] **Step 3: Add Settings state and actions**

Add `ExcelTokenSummary`, `excelTokens`, `oneTimeExcelToken`, `excelTokenSaving`, `generateExcelToken`, `revokeExcelToken`, and `loadExcelTokens`. Call `GET /api/excel/token` during settings bootstrap and after generate/revoke.

- [ ] **Step 4: Add ExcelTokenCard**

Render token status, prefix, created/last-used/revoked timestamps, rotate button, revoke button, one-time token display, and examples:

```text
=ML(A1,1) -> ORDER NAME
=ML(A1,2) -> COMPANY NAME, fallback CUSTOMER NAME
=ML(A1,3) -> MARK
```

Do not show the full raw token after page refresh because it is only returned once.

- [ ] **Step 5: Mount card in Settings**

Add `<ExcelTokenCard />` near password/security settings. Keep version display unchanged and keep config controls restricted by existing permissions.

- [ ] **Step 6: Run Settings tests**

Run:

```bash
npm test -- src/components/workspace/modules/settings/read-model.test.ts src/components/workspace/modules/settings/page-view-model.test.ts src/components/workspace/modules/settings/view-model.test.ts src/components/workspace/modules/settings/hooks/use-settings-actions.test.tsx src/components/workspace/modules/settings/hooks/use-settings-forms.test.tsx --runInBand
```

Expected: all pass.

---

### Task 6: Docs, Version, Full Verification, Deployment

**Files:**
- Modify: `README.md`
- Modify: `docs/API_TESTING.md`
- Modify: `todolist.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Bump version**

Update `package.json#version` and root `package-lock.json#version` from `1.0.103` to `1.0.104`. Do not create a separate version source.

- [ ] **Step 2: Document Excel ML API**

In `README.md` add:

```md
### Excel ML API

Excel lookup uses per-account tokens generated from Settings. Tokens are shown once, stored only as hashes, and inherit the current account's existing hierarchy permissions. Use `Authorization: Bearer <token>`.

`GET /api/excel/ml?orderNo=GANDO-10&field=2` returns plain text for Excel. `format=json` returns diagnostics. `POST /api/excel/ml/batch` resolves multiple rows.

Field mapping:
1. ORDER NAME
2. COMPANY NAME, fallback CUSTOMER NAME (`Customer.name`)
3. MARK
4. CUSTOMER NAME
5. COMPANY NAME
6. PHONE
7. CITY
8. CONSIGNEE
9. COMPANY ADDRESS
10. CREDIT
11. CUSTOMER ID
```

- [ ] **Step 3: Document automated API test**

In `docs/API_TESTING.md`, add the command:

```bash
npm run test:api:isolated -- --case 90-excel-ml-token
```

and describe that it verifies generate, lookup fields 1/2/3, and revoke.

- [ ] **Step 4: Update todo/history**

Add a dated entry to `todolist.md` noting Excel ML token API, per-account permission inheritance, field mapping, tests, and version `1.0.104`.

- [ ] **Step 5: Run unit and API verification**

Run:

```bash
npm test -- src/lib/excel-token-service.test.ts src/lib/excel-ml-service.test.ts src/lib/api-catalog.test.ts src/lib/api-error-catalog.test.ts src/lib/api-success-catalog.test.ts src/lib/rate-limit.test.ts src/lib/system-settings.test.ts src/components/workspace/modules/settings/read-model.test.ts src/components/workspace/modules/settings/page-view-model.test.ts src/components/workspace/modules/settings/view-model.test.ts src/components/workspace/modules/settings/hooks/use-settings-actions.test.tsx src/components/workspace/modules/settings/hooks/use-settings-forms.test.tsx --runInBand
npm run test:api:isolated -- --case 90-excel-ml-token
npm run lint
npm run build
```

Expected: all commands pass.

- [ ] **Step 6: Rebuild running local Docker service**

Because the local app is already running, rebuild only this project:

```bash
docker compose up -d --build
docker compose ps
```

Expected: app and Caddy are healthy/up; existing database volume is preserved.

- [ ] **Step 7: Git sync**

Commit and push:

```bash
git status --short
git add prisma src tests docs README.md todolist.md package.json package-lock.json
git commit -m "feat: add Excel ML token API"
git push
```

Expected: commit succeeds and branch pushes to configured remote.

---

## Self-Review

- Spec coverage: per-account token storage, Settings token management, bearer lookup authentication, existing order matching/fallback customer lookup, field 1/2/3 examples, broader field mapping, permission inheritance, batch API, docs/version/tests/deployment are each mapped to tasks.
- Placeholder scan: no task uses "TBD", "TODO", "implement later", or an unspecified error-handling step.
- Type consistency: service names are `excel-token-service` and `excel-ml-service`; public methods used by API/UI tests are defined before use; field numbers and keys match the approved design.
