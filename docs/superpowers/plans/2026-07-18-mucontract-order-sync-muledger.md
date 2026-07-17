# MU Contract Order Sync - MULEDGER Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull durable MU Contract PI order events into MULEDGER Orders with idempotent processing, historical reconcile, manual-order priority, shared customer matching, administrator controls, and no effect on financial balances.

**Architecture:** The Next.js server owns an environment-only MU Contract client, persists cursor/link/conflict state in MySQL, and applies each source event transactionally. A lightweight Docker trigger calls an internal endpoint; administrator APIs expose status, Sync Now, and preview-confirmed Full Reconcile. Orders and Settings consume only MULEDGER APIs.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma/MySQL, Jest/Testing Library, isolated API tests, Docker Compose.

## Global Constraints

- Do not touch the existing production Docker services, `trading_ledger` database, Docker volumes, or NAS media while implementing or testing.
- Synchronization affects `OrderTracker` and new integration tables only; it must not write `Order`, `Invoice`, `Receipt`, `Detail`, `Swift`, balances, or media.
- The hidden MU Contract PI ID is stable identity; normalized ORDER NO is the business key.
- Manual Orders always win and retain creator, ownership, customer, status, PI status, remark, system note, and confirmed date.
- Only successful formal PI generation supplies official amount; unknown amount is `null`, not zero.
- Use MULEDGER's shared ORDER NO normalization and customer matcher; do not create a second formula.
- Default sync interval is 30 seconds, allowed `10..3600`; default batch is 100, allowed `1..500`.
- Integration HTTP timeout is 15 seconds with at most three attempts; lease is renewable for 120 seconds.
- Secrets are environment-only and must never appear in responses, SystemSetting, audit metadata, or logs.
- MULEDGER displays dates in `Africa/Conakry` and official amount with the existing rounded USD formatter.
- Full Reconcile must complete before normal event synchronization can be enabled.
- All database migrations are additive; production migration requires a verified backup and isolated restore rehearsal.
- Keep README concise; detailed integration, backup, and rollout material belongs in engineering docs.

---

## File Structure

- `src/lib/integrations/mu-contract-contract.ts`: version-1 wire types and strict parser.
- `src/lib/integrations/mu-contract-client.ts`: bounded authenticated HTTP client with retry classification.
- `src/lib/integrations/mu-contract-order-applier.ts`: transaction-local link/create/rename/deactivate rules.
- `src/lib/integrations/mu-contract-sync-service.ts`: lease, incremental pull, cursor, retry, status.
- `src/lib/integrations/mu-contract-reconcile-service.ts`: preview/apply snapshot workflow.
- `src/lib/integrations/mu-contract-sync-settings.ts`: typed system-setting defaults and bounds.
- `src/app/api/integrations/mu-contract/status/route.ts`: ADMIN read-only status.
- `src/app/api/integrations/mu-contract/actions/route.ts`: ADMIN actions.
- `src/app/api/internal/integrations/mu-contract/pull/route.ts`: maintenance-token scheduled trigger.
- `src/components/workspace/modules/settings/components/mu-contract-sync-settings-card.tsx`: collapsible settings content.
- Existing Orders files: serialize and display PI source fields without merging them into financial amount.
- `docs/integrations/mu-contract-order-sync-v1.schema.json`: shared contract artifact.
- `tests/fixtures/mu-contract-order-sync/*.json`: accepted/rejected contract fixtures.
- `tests/api/isolated/helpers/mu-contract-order-feed-server.mjs`: disposable fake source.
- `tests/api/isolated/cases/95-mu-contract-order-sync.case.mjs`: API-level end-to-end proof.

### Task 1: Version-1 Contract Parser and Fixtures

**Files:**
- Create: `src/lib/integrations/mu-contract-contract.ts`
- Create: `src/lib/integrations/mu-contract-contract.test.ts`
- Create: `docs/integrations/mu-contract-order-sync-v1.schema.json`
- Create: `tests/fixtures/mu-contract-order-sync/formal-generated.json`
- Create: `tests/fixtures/mu-contract-order-sync/deactivated.json`

**Interfaces:**
- Consumes: raw JSON from MU Contract.
- Produces: `parseMuContractEventPage(value): MuContractEventPage` and `parseMuContractSnapshotPage(value): MuContractSnapshotPage`.

- [ ] **Step 1: Write failing parser tests**

```ts
import formalGenerated from '../../../tests/fixtures/mu-contract-order-sync/formal-generated.json';
import { parseMuContractEventPage } from './mu-contract-contract';

it('preserves decimal strings, UTC timestamps, and 64-bit cursors', () => {
  const page = parseMuContractEventPage(formalGenerated);
  expect(page.events[0].cursor).toBe('1042');
  expect(page.events[0].officialAmount?.value).toBe('30040.00');
  expect(page.events[0].occurredAt).toBe('2026-07-17T14:30:00.000Z');
});

it('rejects unsupported schema versions without coercion', () => {
  expect(() => parseMuContractEventPage({ ...formalGenerated, schemaVersion: 2 }))
    .toThrow('MU_CONTRACT_SCHEMA_UNSUPPORTED');
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npm test -- --runInBand src/lib/integrations/mu-contract-contract.test.ts`

Expected: FAIL because the parser module does not exist.

- [ ] **Step 3: Implement exact wire types and strict validation**

```ts
export const MU_CONTRACT_SCHEMA_VERSION = 1 as const;

export type MuContractOrderState = {
  orderNo: string;
  previousOrderNo: string | null;
  piCreatedAt: string;
  active: boolean;
  deletedAt: string | null;
};

export type MuContractOfficialAmount = {
  currency: string;
  value: string;
  generatedAt: string;
  generationRunId: string;
};

export type MuContractOrderEvent = {
  cursor: string;
  eventId: string;
  eventType: 'PI_ORDER_LINKED' | 'PI_ORDER_RENAMED' | 'PI_FORMAL_PDF_GENERATED' | 'PI_SOURCE_DEACTIVATED';
  reason: 'ORDER_ASSIGNED' | 'ORDER_CHANGED' | 'FORMAL_PDF_GENERATED' | 'FORMAL_PDF_REGENERATED' | 'PI_DELETED' | 'ORDER_UNLINKED';
  occurredAt: string;
  source: { system: 'MU_CONTRACT'; piId: string; version: number };
  order: MuContractOrderState;
  officialAmount: MuContractOfficialAmount | null;
};

export type MuContractEventPage = {
  schemaVersion: 1;
  events: MuContractOrderEvent[];
  nextCursor: string | null;
  hasMore: boolean;
};
```

The parser must reject non-decimal amount values, non-UTC timestamps, empty PI IDs, unsafe cursor values, limits over 500, and inconsistent active/deleted fields with stable error codes.

- [ ] **Step 4: Run parser tests and JSON validation**

Run: `npm test -- --runInBand src/lib/integrations/mu-contract-contract.test.ts && node -e "JSON.parse(require('fs').readFileSync('docs/integrations/mu-contract-order-sync-v1.schema.json','utf8'))"`

Expected: PASS and exit code 0.

- [ ] **Step 5: Commit the contract slice**

```bash
git add src/lib/integrations docs/integrations tests/fixtures/mu-contract-order-sync
git commit -m "feat(integration): define MU Contract order feed contract"
```

### Task 2: Durable Integration Schema and Additive Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260718090000_mu_contract_order_sync/migration.sql`
- Create: `src/lib/integrations/mu-contract-schema.test.ts`
- Modify: `src/lib/auth-service.ts`
- Modify: `src/lib/auth-service.test.ts`

**Interfaces:**
- Consumes: provider `MU_CONTRACT`, source PI IDs, Orders IDs, and User IDs.
- Produces: Prisma models `ExternalOrderSourceLink`, `IntegrationSyncState`, `IntegrationEventReceipt`, `IntegrationSyncConflict`, and `IntegrationReconcilePreview`.

- [ ] **Step 1: Add a failing static schema test**

```ts
it('keeps external PI amount nullable and protects event identity', () => {
  const schema = readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  expect(schema).toContain('model ExternalOrderSourceLink');
  expect(schema).toMatch(/officialAmount\s+Decimal\?/);
  expect(schema).toContain('@@unique([provider, externalId])');
  expect(schema).toContain('@@unique([provider, eventId])');
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --runInBand src/lib/integrations/mu-contract-schema.test.ts`

Expected: FAIL because the new models are absent.

- [ ] **Step 3: Add the Prisma models and relations**

```prisma
model ExternalOrderSourceLink {
  id                       String    @id @default(cuid())
  provider                 String
  externalId               String
  orderTrackerId           String?
  sourceVersion            Int
  sourceOrderNo            String
  normalizedSourceOrderNo  String
  piCreatedAt              DateTime
  officialAmount           Decimal?  @db.Decimal(18, 2)
  currency                 String?
  officialGeneratedAt      DateTime?
  officialGenerationRunId  String?
  active                   Boolean   @default(true)
  sourceDeletedAt          DateTime?
  linkMode                 String
  humanEditedAt            DateTime?
  humanEditedBy            String?
  customerMatchStatus      String
  lastEventCursor          String?
  firstSeenAt              DateTime  @default(now())
  lastSourceUpdatedAt      DateTime
  createdAt                DateTime  @default(now())
  updatedAt                DateTime  @updatedAt

  orderTracker OrderTracker? @relation(fields: [orderTrackerId], references: [id], onDelete: SetNull)
  humanEditor  User?         @relation("ExternalOrderSourceHumanEditor", fields: [humanEditedBy], references: [id], onDelete: SetNull)

  @@unique([provider, externalId])
  @@unique([provider, orderTrackerId])
  @@index([provider, active])
  @@index([customerMatchStatus])
}
```

Add these four supporting models and add `OrderTracker.archivedAt` plus `OrderTracker.archiveReason`:

```prisma
model IntegrationSyncState {
  provider                    String    @id
  committedCursor             String?
  lastAttemptAt               DateTime?
  lastSuccessAt               DateTime?
  lastErrorCode               String?
  lastErrorMessage            String?   @db.Text
  nextEligiblePollAt          DateTime?
  leaseOwner                  String?
  leaseExpiresAt              DateTime?
  reconcileStatus             String?
  reconcileCursor             String?
  reconcileHighWatermark      String?
  initialReconcileCompletedAt DateTime?
  serviceActorId              String
  createdAt                   DateTime  @default(now())
  updatedAt                   DateTime  @updatedAt

  serviceActor User @relation("IntegrationSyncServiceActor", fields: [serviceActorId], references: [id], onDelete: Restrict)

  @@index([leaseExpiresAt])
  @@index([lastSuccessAt])
}

model IntegrationEventReceipt {
  id             String    @id @default(cuid())
  provider       String
  eventId        String
  cursor         String
  sourcePiId     String
  sourceVersion  Int
  payloadHash    String
  result         String
  orderTrackerId String?
  processedAt    DateTime
  createdAt      DateTime  @default(now())

  orderTracker OrderTracker? @relation(fields: [orderTrackerId], references: [id], onDelete: SetNull)

  @@unique([provider, eventId])
  @@index([provider, cursor])
  @@index([provider, sourcePiId, sourceVersion])
}

model IntegrationSyncConflict {
  id                    String    @id @default(cuid())
  dedupeKey             String    @unique
  provider              String
  sourcePiId            String
  sourceVersion         Int
  eventId               String?
  cursor                String?
  type                  String
  sourceOrderNo         String?
  targetOrderTrackerIds Json
  summary               String    @db.Text
  evidence              Json
  status                String    @default("OPEN")
  resolvedAt            DateTime?
  resolvedBy            String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  resolver User? @relation("IntegrationConflictResolver", fields: [resolvedBy], references: [id], onDelete: SetNull)

  @@index([provider, status])
  @@index([provider, sourcePiId])
}

model IntegrationReconcilePreview {
  id                  String    @id @default(cuid())
  provider            String
  sourceHighWatermark String
  snapshotSummary     Json
  summaryHash         String
  createdBy           String
  createdAt           DateTime  @default(now())
  expiresAt           DateTime
  consumedAt          DateTime?

  creator User @relation("IntegrationReconcilePreviewCreator", fields: [createdBy], references: [id], onDelete: Cascade)

  @@index([provider, expiresAt])
}
```

Add these inverse relations:

```prisma
// User
externalOrderSourceEdits       ExternalOrderSourceLink[]       @relation("ExternalOrderSourceHumanEditor")
integrationSyncStates          IntegrationSyncState[]          @relation("IntegrationSyncServiceActor")
resolvedIntegrationConflicts   IntegrationSyncConflict[]       @relation("IntegrationConflictResolver")
integrationReconcilePreviews   IntegrationReconcilePreview[]   @relation("IntegrationReconcilePreviewCreator")

// OrderTracker
externalSourceLinks       ExternalOrderSourceLink[]
integrationEventReceipts IntegrationEventReceipt[]
```

Normal business queries exclude rows where `archivedAt` is non-null.

- [ ] **Step 4: Write the additive SQL migration**

The migration must create new tables and indexes, add two nullable archive columns, and add foreign keys with `SET NULL` or `RESTRICT`; it must contain no `DROP`, no business-row `UPDATE`, and no financial-table statement.

- [ ] **Step 5: Close supported user-deletion cascade risk**

Inside the existing `runInTransaction` block, before `tx.user.delete`, add:

```ts
await tx.orderTracker.updateMany({ where: { createdBy: userId }, data: { createdBy: currentUser.id } });
await tx.orderTracker.updateMany({ where: { updatedBy: userId }, data: { updatedBy: currentUser.id } });
await tx.integrationSyncState.updateMany({ where: { serviceActorId: userId }, data: { serviceActorId: currentUser.id } });
```

Extend `auth-service.test.ts` to prove all three reassignments happen before deletion.

- [ ] **Step 6: Validate Prisma and run focused tests**

Run: `npx prisma format && npx prisma validate && npm test -- --runInBand src/lib/integrations/mu-contract-schema.test.ts src/lib/auth-service.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit persistence**

```bash
git add prisma src/lib/auth-service.ts src/lib/auth-service.test.ts src/lib/integrations/mu-contract-schema.test.ts
git commit -m "feat(integration): add durable order sync state"
```

### Task 3: Shared Global Customer Matcher Entry Point

**Files:**
- Modify: `src/lib/order-customer-lookup-service.ts`
- Modify: `src/lib/order-customer-lookup-service.test.ts`
- Create: `src/lib/integrations/mu-contract-customer-resolver.ts`
- Create: `src/lib/integrations/mu-contract-customer-resolver.test.ts`

**Interfaces:**
- Consumes: a Prisma transaction client, owner IDs, and raw ORDER NO.
- Produces: `resolveOrderCustomerForOwnerIds(client, ownerIds, orderNo)` and `resolveMuContractOrderCustomer(client, orderNo)`.

- [ ] **Step 1: Write regression tests for browser and global scope**

```ts
it('uses the same composite-order kernel for system scope', async () => {
  mockDb.user.findMany.mockResolvedValue([{ id: 'root' }, { id: 'sales' }]);
  mockDb.order.findMany.mockResolvedValue([{ id: 'o1', orderNo: 'AB-13B/AB-12B', customer }]);
  const result = await resolveMuContractOrderCustomer(mockDb, 'AB-13B');
  expect(result.customerId).toBe(customer.id);
});
```

Also retain existing hierarchy-scoped tests unchanged.

- [ ] **Step 2: Run tests and confirm the new export is missing**

Run: `npm test -- --runInBand src/lib/order-customer-lookup-service.test.ts src/lib/integrations/mu-contract-customer-resolver.test.ts`

Expected: FAIL only for the new system-scope API.

- [ ] **Step 3: Extract a shared scoped implementation**

```ts
export async function resolveOrderCustomerForOwnerIds(
  client: OrderCustomerLookupClient,
  ownerIds: string[],
  orderNo: string,
): Promise<OrderCustomerLookupSuccess> {
  // Existing exact-order, alias, composite, and derived ORDER_NAME logic moves here unchanged.
}

export async function resolveOrderCustomer(currentUser: CurrentUser, orderNo: string) {
  const scope = await getHierarchyScope(currentUser);
  return resolveOrderCustomerForOwnerIds(db, Array.from(scope.ownerVisibleIds), orderNo);
}
```

`resolveMuContractOrderCustomer` loads all user IDs, calls this function with the passed transaction client, and maps `not found` to `UNMATCHED` and multi-customer results to `CONFLICT` without changing the matcher.

- [ ] **Step 4: Run matcher tests**

Run: `npm test -- --runInBand src/lib/order-customer-lookup-service.test.ts src/lib/integrations/mu-contract-customer-resolver.test.ts`

Expected: PASS, including existing composite examples.

- [ ] **Step 5: Commit matcher extraction**

```bash
git add src/lib/order-customer-lookup-service.ts src/lib/order-customer-lookup-service.test.ts src/lib/integrations/mu-contract-customer-resolver*
git commit -m "refactor(matching): expose shared system order resolver"
```

### Task 4: Bounded MU Contract HTTP Client

**Files:**
- Create: `src/lib/integrations/mu-contract-client.ts`
- Create: `src/lib/integrations/mu-contract-client.test.ts`

**Interfaces:**
- Consumes: `MU_CONTRACT_SYNC_BASE_URL`, `MU_CONTRACT_SYNC_TOKEN`, parser functions, and injectable `fetch`.
- Produces: `MuContractClient.fetchEvents(after, limit)`, `fetchSnapshot(after, limit)`, and `fetchSnapshotHighWatermark()`.

- [ ] **Step 1: Write timeout, retry, auth, and redaction tests**

```ts
it('retries 503 but never retries 401', async () => {
  const fetchImpl = jest.fn()
    .mockResolvedValueOnce(new Response('busy', { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(validPage), { status: 200 }));
  const client = createMuContractClient({ fetchImpl, sleep: async () => undefined, token: 'secret' });
  await expect(client.fetchEvents(null, 100)).resolves.toEqual(expect.objectContaining({ schemaVersion: 1 }));
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- --runInBand src/lib/integrations/mu-contract-client.test.ts`

Expected: FAIL because the client does not exist.

- [ ] **Step 3: Implement the client**

```ts
export type MuContractClientOptions = {
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
};

export function createMuContractClient(options: MuContractClientOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxAttempts = options.maxAttempts ?? 3;
  // Build URLs from an environment-controlled base, add Bearer auth, AbortSignal timeout,
  // bounded response read, 5xx/408/425/429 retry, and no retry for auth/schema/business errors.
}
```

Thrown errors expose safe codes/status only; token and Authorization values are never included.

- [ ] **Step 4: Run tests**

Run: `npm test -- --runInBand src/lib/integrations/mu-contract-client.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit client**

```bash
git add src/lib/integrations/mu-contract-client*
git commit -m "feat(integration): add bounded MU Contract client"
```

### Task 5: Transactional Source Event Applier

**Files:**
- Create: `src/lib/integrations/mu-contract-order-applier.ts`
- Create: `src/lib/integrations/mu-contract-order-applier.test.ts`
- Modify: `src/lib/order-tracker-service.ts`
- Modify: `src/lib/order-tracker-service.test.ts`

**Interfaces:**
- Consumes: Prisma transaction client, parsed event/snapshot, service actor ID, cursor.
- Produces: `applyMuContractOrderState(tx, input): Promise<MuContractApplyResult>`.

- [ ] **Step 1: Write table-driven failing business-rule tests**

Cover these exact cases:

```ts
it.each([
  ['manual match', 'MANUAL_ATTACHED'],
  ['missing order', 'SYNC_CREATED'],
])('%s preserves manual priority', async (_name, expectedLinkMode) => {
  const result = await applyMuContractOrderState(tx, input);
  expect(result.linkMode).toBe(expectedLinkMode);
});
```

Add separate tests for nullable amount, unmatched admin-only row, matched customer, same-PI rename, untouched collision transfer/archive, human-edited collision, source-link collision, stale version, deactivation, and non-USD conflict.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- --runInBand src/lib/integrations/mu-contract-order-applier.test.ts`

Expected: FAIL because the applier does not exist.

- [ ] **Step 3: Implement source-owned versus user-owned fields**

```ts
export type MuContractApplyResult = {
  result: 'APPLIED' | 'IGNORED_STALE' | 'BUSINESS_CONFLICT';
  orderTrackerId: string | null;
  linkMode: 'MANUAL_ATTACHED' | 'SYNC_CREATED' | null;
  conflictType: MuContractConflictType | null;
};

export async function applyMuContractOrderState(
  tx: Prisma.TransactionClient,
  input: { state: MuContractOrderEvent; actorId: string; cursor: string },
): Promise<MuContractApplyResult>;
```

The function may write only the new integration models and `OrderTracker`. Sync-created defaults are `In progress`, `piStatus=false`, null remark/system note/confirmedAt. It sets `needsCustomerFix=true` when unresolved and never overwrites manual fields.

- [ ] **Step 4: Mark human edits atomically**

Wrap the existing Orders update and source-link human-edit stamp in `runInTransaction`:

```ts
const updated = await runInTransaction(async (tx) => {
  const row = await tx.orderTracker.update({ where: { id }, data });
  await tx.externalOrderSourceLink.updateMany({
    where: { orderTrackerId: id, active: true },
    data: { humanEditedAt: new Date(), humanEditedBy: currentUser.id },
  });
  return row;
});
```

- [ ] **Step 5: Run applier and Orders regression tests**

Run: `npm test -- --runInBand src/lib/integrations/mu-contract-order-applier.test.ts src/lib/order-tracker-service.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit applier**

```bash
git add src/lib/integrations/mu-contract-order-applier* src/lib/order-tracker-service*
git commit -m "feat(integration): apply MU Contract orders transactionally"
```

### Task 6: Lease, Incremental Pull, and Full Reconcile

**Files:**
- Create: `src/lib/integrations/mu-contract-sync-settings.ts`
- Create: `src/lib/integrations/mu-contract-sync-service.ts`
- Create: `src/lib/integrations/mu-contract-sync-service.test.ts`
- Create: `src/lib/integrations/mu-contract-reconcile-service.ts`
- Create: `src/lib/integrations/mu-contract-reconcile-service.test.ts`
- Modify: `src/lib/system-settings.ts`
- Modify: `src/lib/system-settings.test.ts`

**Interfaces:**
- Consumes: client, applier, integration models, and three audited settings.
- Produces: `runScheduledMuContractSync`, `runMuContractSyncNow`, `previewMuContractReconcile`, `applyMuContractReconcile`, and `getMuContractSyncStatus`.

- [ ] **Step 1: Write failing coordinator tests**

```ts
it('commits receipt and cursor in the same transaction', async () => {
  await runMuContractSyncNow({ actorId: 'admin', client });
  expect(mockTx.integrationEventReceipt.create).toHaveBeenCalled();
  expect(mockTx.integrationSyncState.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ committedCursor: '1042' }) }),
  );
});

it('does not advance cursor on transient failure', async () => {
  client.fetchEvents.mockRejectedValue(new Error('timeout'));
  await expect(runMuContractSyncNow({ actorId: 'admin', client })).rejects.toThrow();
  expect(mockTx.integrationSyncState.update).not.toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ committedCursor: expect.anything() }) }),
  );
});
```

Also test lease contention, disabled scheduling, initial-reconcile gate, stale events, conflicts advancing, preview expiry, high-watermark drift, resumable snapshot cursor, and final high-watermark handoff.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- --runInBand src/lib/integrations/mu-contract-sync-service.test.ts src/lib/integrations/mu-contract-reconcile-service.test.ts`

Expected: FAIL because services do not exist.

- [ ] **Step 3: Register typed settings**

```ts
export const muContractSyncSettingKeys = [
  'MU_CONTRACT_SYNC_ENABLED',
  'MU_CONTRACT_SYNC_INTERVAL_SECONDS',
  'MU_CONTRACT_SYNC_BATCH_SIZE',
] as const;
```

Add defaults `false`, `30`, `100`; boolean/numeric classification; interval bounds `10..3600`; batch bounds `1..500`.

- [ ] **Step 4: Implement lease and incremental processing**

Use conditional database updates to acquire `leaseOwner`/`leaseExpiresAt`; renew before 120 seconds; process one event per transaction; insert `IntegrationEventReceipt` and update cursor atomically. `runScheduledMuContractSync` returns `disabled`, `not-due`, or `running` without error when appropriate.

- [ ] **Step 5: Implement preview-confirmed reconcile**

```ts
export async function previewMuContractReconcile(actorId: string): Promise<{
  previewId: string;
  expiresAt: string;
  highWatermark: string;
  summary: MuContractReconcileSummary;
}>;

export async function applyMuContractReconcile(
  actorId: string,
  previewId: string,
): Promise<MuContractReconcileRunResult>;
```

Preview is read-only except for its confirmation record. Apply rejects consumed/expired/drifted preview, checkpoints snapshot cursor per batch, sets `initialReconcileCompletedAt`, then sets committed event cursor to the captured high-watermark.

- [ ] **Step 6: Run all coordinator tests**

Run: `npm test -- --runInBand src/lib/integrations/mu-contract-sync-service.test.ts src/lib/integrations/mu-contract-reconcile-service.test.ts src/lib/system-settings.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit coordinator**

```bash
git add src/lib/integrations/mu-contract-sync* src/lib/integrations/mu-contract-reconcile* src/lib/system-settings*
git commit -m "feat(integration): coordinate durable PI order sync"
```

### Task 7: Administrator and Internal APIs with Isolated API Coverage

**Files:**
- Create: `src/app/api/integrations/mu-contract/status/route.ts`
- Create: `src/app/api/integrations/mu-contract/status/route.test.ts`
- Create: `src/app/api/integrations/mu-contract/actions/route.ts`
- Create: `src/app/api/integrations/mu-contract/actions/route.test.ts`
- Create: `src/app/api/internal/integrations/mu-contract/pull/route.ts`
- Create: `src/app/api/internal/integrations/mu-contract/pull/route.test.ts`
- Create: `tests/api/isolated/helpers/mu-contract-order-feed-server.mjs`
- Create: `tests/api/isolated/cases/95-mu-contract-order-sync.case.mjs`
- Modify: `scripts/test-api-isolated.sh`

**Interfaces:**
- Consumes: sync and reconcile services.
- Produces: the three routes fixed in the design.

- [ ] **Step 1: Write route authorization tests**

```ts
it('rejects non-admin Sync Now', async () => {
  mockWithAuthUser({ role: UserRole.SALES });
  const response = await POST(request({ action: 'sync-now' }));
  expect(response.status).toBe(403);
});

it('requires maintenance token for scheduled pull', async () => {
  const response = await POST_INTERNAL(new NextRequest('http://test/api/internal/integrations/mu-contract/pull'));
  expect(response.status).toBe(401);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- --runInBand src/app/api/integrations/mu-contract src/app/api/internal/integrations/mu-contract`

Expected: FAIL because routes are absent.

- [ ] **Step 3: Implement thin API adapters**

`actions` accepts only:

```ts
type MuContractAdminAction =
  | { action: 'sync-now' }
  | { action: 'preview-reconcile' }
  | { action: 'apply-reconcile'; previewId: string };
```

Return localized human-readable messages via existing API success/error helpers. Never return token, base URL credentials, raw Authorization headers, or stack traces.

- [ ] **Step 4: Add a disposable fake source to isolated tests**

The helper starts an HTTP server on `127.0.0.1`, validates the dedicated bearer token, exposes event/snapshot fixtures, and records requests. `test-api-isolated.sh` exports its URL/token to the app and terminates it in `cleanup`.

- [ ] **Step 5: Add isolated end-to-end API case**

The case must prove: initial enable rejection, preview counts, apply, 39 metadata-only/14 create/10 untouched fixture semantics, incremental event, duplicate replay, cursor resume, ADMIN-only status, and no writes to financial table counts.

- [ ] **Step 6: Run route and isolated tests**

Run: `npm test -- --runInBand src/app/api/integrations/mu-contract src/app/api/internal/integrations/mu-contract && npm run test:api:isolated -- --case 95-mu-contract-order-sync`

Expected: PASS.

- [ ] **Step 7: Commit APIs**

```bash
git add src/app/api/integrations src/app/api/internal/integrations tests/api/isolated scripts/test-api-isolated.sh
git commit -m "feat(integration): expose controlled order sync APIs"
```

### Task 8: Orders Serialization, Visibility, and Responsive Columns

**Files:**
- Modify: `src/lib/order-tracker-service.ts`
- Modify: `src/lib/order-tracker-service.test.ts`
- Modify: `src/components/workspace/modules/orders/types.ts`
- Modify: `src/components/workspace/modules/orders/order-tracker-manager.tsx`
- Modify: `src/components/workspace/modules/orders/order-tracker-manager.test.tsx`

**Interfaces:**
- Consumes: source link joined by Orders query.
- Produces: `piCreatedAt`, `piOfficialAmount`, `piCurrency`, `sourceState`, and `sourceConflict` API fields.

- [ ] **Step 1: Write failing service and UI tests**

```tsx
expect(screen.getByRole('columnheader', { name: 'PI CREATED DATE' })).toBeInTheDocument();
expect(screen.getByRole('columnheader', { name: 'AMOUNT' })).toBeInTheDocument();
expect(screen.getByText('-')).toBeInTheDocument();
expect(screen.getByText('$30,040')).toBeInTheDocument();
```

Service tests must prove archived rows are excluded, manual-only rows return null fields, unmatched source rows are visible to ADMIN only, and matched rows follow customer ownership.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- --runInBand src/lib/order-tracker-service.test.ts src/components/workspace/modules/orders/order-tracker-manager.test.tsx`

Expected: FAIL for new fields/columns.

- [ ] **Step 3: Join and serialize source metadata**

Add `externalSourceLinks: { where: { provider: 'MU_CONTRACT' }, take: 1 }`, filter `archivedAt: null`, and serialize nullable amount without `asNumber(null)`:

```ts
piOfficialAmount: source?.officialAmount == null ? null : Number(source.officialAmount),
piCreatedAt: source?.piCreatedAt ?? null,
sourceState: source ? (source.active ? 'ACTIVE' : 'INACTIVE') : null,
```

- [ ] **Step 4: Add approved desktop order and mobile-safe fields**

Use this exact desktop sequence:

```text
ORDER / PI CREATED DATE / AMOUNT / STATUS / PI STATUS / REMARK /
SYSTEM NOTED / DEPOSIT / CONFIRMED DATE / CUSTOMER / ACTIONS
```

Mobile fields stay inside the existing card/row container and must not add page-level horizontal overflow. Use existing Guinea date and USD format helpers.

- [ ] **Step 5: Run Orders tests**

Run: `npm test -- --runInBand src/lib/order-tracker-service.test.ts src/components/workspace/modules/orders/order-tracker-manager.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit Orders UI**

```bash
git add src/lib/order-tracker-service* src/components/workspace/modules/orders
git commit -m "feat(orders): show synchronized PI metadata"
```

### Task 9: Collapsible MU Contract Sync Settings UI

**Files:**
- Create: `src/components/workspace/modules/settings/components/mu-contract-sync-settings-card.tsx`
- Create: `src/components/workspace/modules/settings/components/mu-contract-sync-settings-card.test.tsx`
- Modify: `src/components/workspace/modules/settings/components/index.ts`
- Modify: `src/components/workspace/modules/settings/settings-manager.tsx`
- Modify: `src/components/workspace/modules/settings/settings-manager.test.tsx`
- Modify: `src/components/workspace/modules/settings/hooks/use-settings-actions.ts`
- Modify: `src/components/workspace/modules/settings/hooks/use-settings-actions.test.tsx`
- Modify: `src/components/workspace/modules/settings/types.ts`

**Interfaces:**
- Consumes: `/api/settings`, integration status, and action APIs.
- Produces: audited config save, status refresh, Sync Now, preview, and confirmed apply.

- [ ] **Step 1: Write failing card behavior tests**

```tsx
expect(screen.getByLabelText('Enabled')).not.toBeChecked();
expect(screen.getByLabelText('Polling interval (seconds)')).toHaveValue(30);
expect(screen.getByText('Initial reconcile required')).toBeInTheDocument();
fireEvent.click(screen.getByRole('button', { name: 'Full Reconcile' }));
expect(onPreviewReconcile).toHaveBeenCalledTimes(1);
```

Also test non-admin omission, counts, last success, error summary, disabled apply before preview, bilingual confirmation, and no secret fields.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- --runInBand src/components/workspace/modules/settings/components/mu-contract-sync-settings-card.test.tsx`

Expected: FAIL because the card does not exist.

- [ ] **Step 3: Implement hook actions and card**

```ts
type MuContractSyncStatus = {
  enabled: boolean;
  intervalSeconds: number;
  batchSize: number;
  initialReconcileCompletedAt: string | null;
  lastSuccessAt: string | null;
  committedCursor: string | null;
  lastError: string | null;
  unmatchedCount: number;
  conflictCount: number;
  running: boolean;
};
```

The card uses existing `apiCall`, global config save, `CollapsibleSettingsSection`, `Button`, `Input`, and bilingual `tx`. Preview renders counts first; apply requires a second browser confirmation and preview ID.

- [ ] **Step 4: Run settings tests**

Run: `npm test -- --runInBand src/components/workspace/modules/settings`

Expected: PASS.

- [ ] **Step 5: Commit settings UI**

```bash
git add src/components/workspace/modules/settings
git commit -m "feat(settings): manage MU Contract order sync"
```

### Task 10: Docker Trigger, Environment Contract, and Safe Rebuild Script

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `scripts/rebuild-local-app.sh`
- Modify: `scripts/rebuild-local-app.test.ts`
- Create: `src/app/api/internal/integrations/mu-contract/pull/runtime-contract.test.ts`

**Interfaces:**
- Consumes: `MAINTENANCE_JOB_TOKEN`, `MU_CONTRACT_SYNC_BASE_URL`, `MU_CONTRACT_SYNC_TOKEN`.
- Produces: `mucontract-sync-trigger` service that only calls the internal app API.

- [ ] **Step 1: Extend the rebuild safety test first**

```ts
expect(script).toContain('docker compose up -d --no-deps --force-recreate mucontract-sync-trigger');
expect(script).not.toMatch(/docker\s+compose\s+down\s+-v/);
expect(script).not.toMatch(/prisma\s+db\s+push/);
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- --runInBand scripts/rebuild-local-app.test.ts`

Expected: FAIL because the trigger service is absent.

- [ ] **Step 3: Add isolated trigger service**

```yaml
  mucontract-sync-trigger:
    image: curlimages/curl:8.12.1
    restart: unless-stopped
    depends_on:
      - app
    environment:
      MAINTENANCE_BASE_URL: ${MAINTENANCE_BASE_URL:-http://app:3000}
      MAINTENANCE_JOB_TOKEN: ${MAINTENANCE_JOB_TOKEN:?MAINTENANCE_JOB_TOKEN must be set}
    command: >
      sh -c 'while true; do curl -fsS -X POST "$${MAINTENANCE_BASE_URL}/api/internal/integrations/mu-contract/pull" -H "x-maintenance-token: $${MAINTENANCE_JOB_TOKEN}" || true; sleep 5; done'
```

Pass source URL/token only to `app`, not to the curl trigger. Add blank safe examples to `.env.example`.

- [ ] **Step 4: Update safe rebuild behavior**

After rebuilding `app`, force-recreate both `maintenance` and `mucontract-sync-trigger`, health-check the app, then invoke the internal sync endpoint once. Preserve the script's full-error reporting and never add destructive commands.

- [ ] **Step 5: Validate Compose and tests**

Run: `docker compose config --quiet && npm test -- --runInBand scripts/rebuild-local-app.test.ts src/app/api/internal/integrations/mu-contract/pull/runtime-contract.test.ts`

Expected: PASS. Do not run the production rebuild script in this task.

- [ ] **Step 6: Commit runtime wiring**

```bash
git add docker-compose.yml .env.example scripts/rebuild-local-app* src/app/api/internal/integrations/mu-contract/pull/runtime-contract.test.ts
git commit -m "chore(runtime): schedule MU Contract order pulls"
```

### Task 11: Documentation, Backup Gate, Version, and Full Verification

**Files:**
- Modify: `docs/data-and-integrations.md`
- Modify: `docs/backup/muledger-cos-backup.md`
- Modify: `docs/API_TESTING.md`
- Modify: `CHANGE_CHECKLIST.md`
- Modify: `ENGINEERING_LOG.md`
- Modify: `docs/superpowers/plans/README.md`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: all completed implementation slices.
- Produces: operator documentation, backup/rollback proof, version `1.0.208`, and CI-ready branch.

- [ ] **Step 1: Update detailed integration and backup documentation**

Document the two source endpoints, three MULEDGER endpoints, environment-only secrets, durable MySQL tables, no new NAS paths, initial reconcile gate, conflict rules, and deployment order. Add the new tables to restore verification while confirming the complete `trading_ledger` dump already covers them.

- [ ] **Step 2: Add an isolated migration/restore rehearsal command**

Use only the disposable API test database for routine verification:

```bash
npm run test:api:isolated -- --case 95-mu-contract-order-sync
```

Before production migration, restore the latest verified COS MySQL dump into a separate MariaDB container, run `npx prisma migrate deploy` against that copy, and record table counts and financial-table checksums in a new restore-drill report. Do not execute that production-derived rehearsal without the explicit migration checkpoint.

- [ ] **Step 3: Bump the single source version**

Set `package.json` and lockfile project version from `1.0.207` to `1.0.208`; update the concise README version and feature summary without copying the engineering log into README.

- [ ] **Step 4: Run focused and full automated verification**

Run:

```bash
npx prisma validate
npm run typecheck
npm run lint
npm test -- --runInBand
npm run test:api:isolated -- --case 95-mu-contract-order-sync
npm run build
docker compose config --quiet
git diff --check
```

Expected: every command exits 0. Tests must use disposable databases and the fake MU Contract server.

- [ ] **Step 5: Review the complete diff for forbidden writes and secrets**

Run:

```bash
git diff origin/main...HEAD -- prisma src docker-compose.yml .env.example scripts docs README.md package.json package-lock.json
rg -n "Authorization: Bearer|MU_CONTRACT_SYNC_TOKEN=" . --glob '!node_modules/**' --glob '!.git/**'
```

Expected: no real token, no financial write path, no media path, no destructive Docker command.

- [ ] **Step 6: Commit release documentation**

```bash
git add docs CHANGE_CHECKLIST.md ENGINEERING_LOG.md README.md package.json package-lock.json
git commit -m "docs: document MU Contract order synchronization"
```

- [ ] **Step 7: Sync latest main, resolve only relevant conflicts, and re-run gates**

```bash
git fetch origin main
git rebase origin/main
npm run typecheck
npm test -- --runInBand
npm run test:api:isolated -- --case 95-mu-contract-order-sync
npm run build
```

Expected: PASS on the rebased branch.

- [ ] **Step 8: Push the MULEDGER feature branch without rebuilding production**

```bash
git push --force-with-lease origin feat/mucontract-order-sync
```

Do not merge, migrate production, enable synchronization, or run `scripts/rebuild-local-app.sh` until the MU Contract PR is reviewed and the migration/backup checkpoint is explicitly approved.
