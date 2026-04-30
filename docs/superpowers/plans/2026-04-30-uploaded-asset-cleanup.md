# Uploaded Asset Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable uploaded-asset registry and automated cleanup flow that safely removes orphaned staged images after 24 hours, keeps signed-receipt pending sessions on a separate 72-hour policy, and preserves current NAS-backed storage and protected image access.

**Architecture:** Introduce a first-class `UploadedAsset` lifecycle in Prisma (`STAGED -> ATTACHED -> DELETED`) and route all server-side image writes through a focused asset service that registers staged assets immediately, then promotes them on final business confirmation. Execute cleanup through an internal token-protected maintenance route, triggered every 24 hours by a dedicated Docker maintenance container, so scheduling remains part of the deployed stack without relying on host cron or fragile in-process timers.

**Tech Stack:** Next.js App Router, Prisma/MySQL, Node fs/promises, Docker Compose, NAS bind mount upload storage, Jest, isolated API tests.

---

## File Structure

**Create:**
- `prisma/migrations/20260430120000_uploaded_asset_cleanup/migration.sql`
- `src/lib/uploaded-asset-service.ts`
- `src/lib/uploaded-asset-service.test.ts`
- `src/lib/uploaded-asset-maintenance.ts`
- `src/lib/uploaded-asset-maintenance.test.ts`
- `src/app/api/internal/maintenance/uploaded-assets/route.ts`
- `tests/api/isolated/cases/85-uploaded-asset-cleanup.case.mjs`

**Modify:**
- `prisma/schema.prisma`
- `src/lib/system-settings.ts`
- `src/lib/upload.ts`
- `src/app/api/upload-image/route.ts`
- `src/app/api/receipt/route.ts`
- `src/app/api/detail/route.ts`
- `src/app/api/swift/route.ts`
- `src/app/api/receipt-generator/route.ts`
- `src/lib/receipt-service.ts`
- `src/lib/detail-service.ts`
- `src/lib/swift-service.ts`
- `src/lib/receipt-generator-service.ts`
- `docker-compose.yml`
- `.env.example`
- `README.md`
- `todolist.md`
- `ENGINEERING_LOG.md`
- `package.json`
- `package-lock.json`

**Rationale:**
- Prisma owns lifecycle truth through explicit asset rows and enums.
- `uploaded-asset-service.ts` centralizes registration, attachment, and safe path resolution so OCR/direct/generator flows do not each invent their own file lifecycle logic.
- `uploaded-asset-maintenance.ts` isolates cleanup policy and stale-signing policy from route glue, making it easy to test without booting the whole app.
- An internal maintenance route keeps the job logic inside existing app/service boundaries, while a dedicated Docker maintenance container handles 24-hour execution without host-side cron drift.

## Task 1: Add schema and settings for asset lifecycle

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260430120000_uploaded_asset_cleanup/migration.sql`
- Modify: `src/lib/system-settings.ts`
- Test: `src/lib/uploaded-asset-maintenance.test.ts`

- [ ] **Step 1: Write the failing settings test**

```ts
it('returns uploaded asset cleanup ttl defaults', async () => {
  const settings = await getUploadedAssetCleanupSettings();

  expect(settings.stagedTtlHours).toBe(24);
  expect(settings.signingPendingTtlHours).toBe(72);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/lib/uploaded-asset-maintenance.test.ts`
Expected: FAIL because `getUploadedAssetCleanupSettings` and the cleanup-related setting keys do not exist yet.

- [ ] **Step 3: Extend Prisma schema with explicit asset lifecycle models**

```prisma
enum UploadedAssetStatus {
  STAGED
  ATTACHED
  DELETED
}

enum UploadedAssetAttachmentType {
  RECEIPT
  DETAIL
  SWIFT
  RECEIPT_GENERATOR_SESSION
}

enum UploadedAssetCategory {
  RECEIPT_DIRECT
  RECEIPT_OCR
  DETAIL_OCR
  SWIFT_OCR
  RECEIPT_GENERATOR_FINAL
  RECEIPT_GENERATOR_SIGNATURE
}

model UploadedAsset {
  id           String                       @id @default(cuid())
  path         String                       @unique @db.LongText
  name         String                       @db.Text
  category     UploadedAssetCategory
  mimeType     String
  sizeBytes    Int
  createdBy    String
  status       UploadedAssetStatus          @default(STAGED)
  attachedType UploadedAssetAttachmentType?
  attachedId   String?
  expiresAt    DateTime?
  deletedAt    DateTime?
  createdAt    DateTime                     @default(now())
  updatedAt    DateTime                     @updatedAt

  creator User @relation(fields: [createdBy], references: [id], onDelete: Cascade)

  @@index([status, expiresAt])
  @@index([attachedType, attachedId])
  @@index([category, createdAt])
  @@index([createdBy, createdAt])
}
```

Also extend `User` with `uploadedAssets UploadedAsset[]`.

- [ ] **Step 4: Add the migration SQL**

```sql
CREATE TABLE `UploadedAsset` (
  `id` VARCHAR(191) NOT NULL,
  `path` LONGTEXT NOT NULL,
  `name` TEXT NOT NULL,
  `category` ENUM('RECEIPT_DIRECT','RECEIPT_OCR','DETAIL_OCR','SWIFT_OCR','RECEIPT_GENERATOR_FINAL','RECEIPT_GENERATOR_SIGNATURE') NOT NULL,
  `mimeType` VARCHAR(191) NOT NULL,
  `sizeBytes` INTEGER NOT NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `status` ENUM('STAGED','ATTACHED','DELETED') NOT NULL DEFAULT 'STAGED',
  `attachedType` ENUM('RECEIPT','DETAIL','SWIFT','RECEIPT_GENERATOR_SESSION') NULL,
  `attachedId` VARCHAR(191) NULL,
  `expiresAt` DATETIME(3) NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `UploadedAsset_path_key`(`path`(255)),
  INDEX `UploadedAsset_status_expiresAt_idx`(`status`, `expiresAt`),
  INDEX `UploadedAsset_attachedType_attachedId_idx`(`attachedType`, `attachedId`),
  INDEX `UploadedAsset_category_createdAt_idx`(`category`, `createdAt`),
  INDEX `UploadedAsset_createdBy_createdAt_idx`(`createdBy`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `UploadedAsset`
  ADD CONSTRAINT `UploadedAsset_createdBy_fkey`
  FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 5: Add cleanup settings to the system-settings helper**

```ts
export const editableSystemSettingKeys = [
  // existing keys...
  'UPLOADED_ASSET_STAGED_TTL_HOURS',
  'SIGNING_PENDING_TTL_HOURS',
] as const;

export const systemSettingDefaults = {
  // existing defaults...
  UPLOADED_ASSET_STAGED_TTL_HOURS: process.env.UPLOADED_ASSET_STAGED_TTL_HOURS ?? '24',
  SIGNING_PENDING_TTL_HOURS: process.env.SIGNING_PENDING_TTL_HOURS ?? '72',
};

export async function getUploadedAssetCleanupSettings(): Promise<{
  stagedTtlHours: number;
  signingPendingTtlHours: number;
}> {
  const settings = await getSystemSettingsWithDefaults([
    'UPLOADED_ASSET_STAGED_TTL_HOURS',
    'SIGNING_PENDING_TTL_HOURS',
  ]);

  return {
    stagedTtlHours: Math.max(1, Number(settings.UPLOADED_ASSET_STAGED_TTL_HOURS) || 24),
    signingPendingTtlHours: Math.max(24, Number(settings.SIGNING_PENDING_TTL_HOURS) || 72),
  };
}
```

- [ ] **Step 6: Run tests and Prisma generation**

Run:
- `npx prisma generate`
- `npm test -- --runInBand src/lib/uploaded-asset-maintenance.test.ts`

Expected: Prisma client regenerates cleanly, and the settings test passes.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260430120000_uploaded_asset_cleanup/migration.sql src/lib/system-settings.ts src/lib/uploaded-asset-maintenance.test.ts
git commit -m "Add uploaded asset lifecycle schema and cleanup settings"
```

### Task 2: Build the uploaded asset service for register/attach/delete lifecycle

**Files:**
- Create: `src/lib/uploaded-asset-service.ts`
- Test: `src/lib/uploaded-asset-service.test.ts`
- Modify: `src/lib/upload.ts`

- [ ] **Step 1: Write the failing service tests**

```ts
it('registers a staged asset immediately after a successful NAS write', async () => {
  const result = await registerUploadedAsset({
    path: '/upload/images/receipts/direct/test.png',
    name: 'test.png',
    category: UploadedAssetCategory.RECEIPT_DIRECT,
    mimeType: 'image/png',
    sizeBytes: 1024,
    createdBy: 'user-1',
    expiresAt: new Date('2026-05-01T00:00:00.000Z'),
  });

  expect(db.uploadedAsset.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: UploadedAssetStatus.STAGED }),
  }));
  expect(result.status).toBe(UploadedAssetStatus.STAGED);
});

it('promotes a staged asset to attached by public path', async () => {
  await attachUploadedAssetByPath({
    path: '/upload/images/receipts/direct/test.png',
    attachedType: UploadedAssetAttachmentType.RECEIPT,
    attachedId: 'receipt-1',
  });

  expect(db.uploadedAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      status: UploadedAssetStatus.ATTACHED,
      attachedType: UploadedAssetAttachmentType.RECEIPT,
      attachedId: 'receipt-1',
      expiresAt: null,
    }),
  }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/lib/uploaded-asset-service.test.ts`
Expected: FAIL because the service file and exported functions do not exist yet.

- [ ] **Step 3: Implement the service and category/subdir helpers**

```ts
export async function registerUploadedAsset(input: {
  path: string;
  name: string;
  category: UploadedAssetCategory;
  mimeType: string;
  sizeBytes: number;
  createdBy: string;
  expiresAt: Date | null;
}) {
  return db.uploadedAsset.create({
    data: {
      path: input.path,
      name: input.name,
      category: input.category,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      createdBy: input.createdBy,
      status: UploadedAssetStatus.STAGED,
      expiresAt: input.expiresAt,
    },
  });
}

export async function attachUploadedAssetByPath(input: {
  path: string;
  attachedType: UploadedAssetAttachmentType;
  attachedId: string;
}) {
  await db.uploadedAsset.updateMany({
    where: { path: input.path, status: UploadedAssetStatus.STAGED },
    data: {
      status: UploadedAssetStatus.ATTACHED,
      attachedType: input.attachedType,
      attachedId: input.attachedId,
      expiresAt: null,
    },
  });
}

export function uploadedAssetSubDirForCategory(category: UploadedAssetCategory): string {
  switch (category) {
    case UploadedAssetCategory.RECEIPT_DIRECT:
      return 'receipts/direct';
    case UploadedAssetCategory.RECEIPT_OCR:
      return 'receipts/ocr';
    case UploadedAssetCategory.DETAIL_OCR:
      return 'details/ocr';
    case UploadedAssetCategory.SWIFT_OCR:
      return 'swifts/ocr';
    case UploadedAssetCategory.RECEIPT_GENERATOR_FINAL:
      return 'receipts/generated';
    case UploadedAssetCategory.RECEIPT_GENERATOR_SIGNATURE:
      return 'receipts/generated/signatures';
  }
}
```

Also extend `saveUploadedImage(...)` so it returns `mimeType` and `sizeBytes` along with `path/name`, because the asset registry needs write-time metadata.

- [ ] **Step 4: Run tests to verify it passes**

Run:
- `npm test -- --runInBand src/lib/uploaded-asset-service.test.ts`
- `npm test -- --runInBand src/lib/uploaded-asset-maintenance.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/upload.ts src/lib/uploaded-asset-service.ts src/lib/uploaded-asset-service.test.ts
git commit -m "Add uploaded asset lifecycle service"
```

### Task 3: Register staged assets on upload and attach them on final business confirmation

**Files:**
- Modify: `src/app/api/upload-image/route.ts`
- Modify: `src/app/api/receipt/route.ts`
- Modify: `src/app/api/detail/route.ts`
- Modify: `src/app/api/swift/route.ts`
- Modify: `src/lib/receipt-service.ts`
- Modify: `src/lib/detail-service.ts`
- Modify: `src/lib/swift-service.ts`
- Test: `tests/api/isolated/cases/85-uploaded-asset-cleanup.case.mjs`

- [ ] **Step 1: Write the failing isolated API case**

```js
await uploadReceiptDirectImage({ cookie, filePath });
const stagedAssets = await prisma.uploadedAsset.findMany({ where: { status: 'STAGED', category: 'RECEIPT_DIRECT' } });
assert.equal(stagedAssets.length, 1);

await createReceiptDirectly({
  cookie,
  orderNo: 'MAB-1-10',
  invNo: 'L25MH071089C',
  imagePath: stagedAssets[0].path,
});

const attached = await prisma.uploadedAsset.findFirst({ where: { path: stagedAssets[0].path } });
assert.equal(attached.status, 'ATTACHED');
assert.equal(attached.attachedType, 'RECEIPT');
```

Also add OCR-path assertions for receipt/detail/swift recognize -> staged, confirm -> attached.

- [ ] **Step 2: Run the isolated case to verify it fails**

Run: `npm run test:api:isolated -- 85-uploaded-asset-cleanup.case.mjs`
Expected: FAIL because `UploadedAsset` rows are not created or attached yet.

- [ ] **Step 3: Register direct-upload assets in `/api/upload-image`**

```ts
const category = UploadedAssetCategory.RECEIPT_DIRECT;
const subDir = uploadedAssetSubDirForCategory(category);
const image = await saveUploadedImage(file, { subDir });
await registerUploadedAsset({
  path: image.path,
  name: image.name,
  category,
  mimeType: image.mimeType,
  sizeBytes: image.sizeBytes,
  createdBy: currentUser.id,
  expiresAt: addHours(new Date(), stagedTtlHours),
});
```

- [ ] **Step 4: Register OCR recognize uploads as staged assets**

```ts
const image = await saveUploadedImage(file, { subDir: uploadedAssetSubDirForCategory(UploadedAssetCategory.RECEIPT_OCR) });
await registerUploadedAsset({
  path: image.path,
  name: image.name,
  category: UploadedAssetCategory.RECEIPT_OCR,
  mimeType: image.mimeType,
  sizeBytes: image.sizeBytes,
  createdBy: currentUser.id,
  expiresAt: addHours(new Date(), stagedTtlHours),
});
```

Repeat the same shape in:
- receipt recognize
- detail recognize
- swift recognize

- [ ] **Step 5: Attach assets when final records are created or confirmed**

```ts
await attachUploadedAssetByPath({
  path: createdReceipt.imageUrl!,
  attachedType: UploadedAssetAttachmentType.RECEIPT,
  attachedId: createdReceipt.id,
});
```

Apply the same promotion pattern when:
- direct receipt create succeeds
- receipt OCR confirm succeeds
- detail OCR confirm succeeds
- swift OCR confirm succeeds

- [ ] **Step 6: Run tests to verify they pass**

Run:
- `npm run test:api:isolated -- 85-uploaded-asset-cleanup.case.mjs`
- `npm test -- --runInBand src/lib/receipt-service.test.ts src/lib/detail-service.test.ts src/lib/swift-service.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/upload-image/route.ts src/app/api/receipt/route.ts src/app/api/detail/route.ts src/app/api/swift/route.ts src/lib/receipt-service.ts src/lib/detail-service.ts src/lib/swift-service.ts tests/api/isolated/cases/85-uploaded-asset-cleanup.case.mjs
git commit -m "Register and attach uploaded assets across receipt OCR flows"
```

### Task 4: Register generator assets and add stale `SIGNING_PENDING` cleanup logic

**Files:**
- Modify: `src/lib/receipt-generator-service.ts`
- Modify: `src/app/api/receipt-generator/route.ts`
- Create: `src/lib/uploaded-asset-maintenance.ts`
- Test: `src/lib/uploaded-asset-maintenance.test.ts`
- Test: `src/lib/receipt-generator-service.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('registers generator signatures and final image as attached assets on finalize', async () => {
  await finalizeReceiptGeneratorSession({ sessionId: 'sess-1', ...payload });

  expect(db.uploadedAsset.createMany).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.arrayContaining([
      expect.objectContaining({ category: 'RECEIPT_GENERATOR_SIGNATURE', status: 'ATTACHED' }),
      expect.objectContaining({ category: 'RECEIPT_GENERATOR_FINAL', status: 'ATTACHED' }),
    ]),
  }));
});

it('cancels stale signing sessions and removes untouched SIGNING_PENDING receipts after ttl', async () => {
  const result = await cleanupStaleSigningPendingReceipts({ now: new Date('2026-05-03T00:00:00.000Z') });

  expect(result.cancelledSessions).toBe(1);
  expect(result.deletedReceipts).toBe(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
- `npm test -- --runInBand src/lib/receipt-generator-service.test.ts`
- `npm test -- --runInBand src/lib/uploaded-asset-maintenance.test.ts`

Expected: FAIL because finalize does not register assets and stale-signing cleanup does not exist.

- [ ] **Step 3: Register final generator artifacts as attached**

```ts
await db.uploadedAsset.createMany({
  data: [
    {
      path: receiverSignature.path,
      name: receiverSignature.name,
      category: UploadedAssetCategory.RECEIPT_GENERATOR_SIGNATURE,
      mimeType: 'image/png',
      sizeBytes: receiverSignature.sizeBytes,
      createdBy: session.createdBy,
      status: UploadedAssetStatus.ATTACHED,
      attachedType: UploadedAssetAttachmentType.RECEIPT_GENERATOR_SESSION,
      attachedId: session.id,
    },
    {
      path: payerSignature.path,
      name: payerSignature.name,
      category: UploadedAssetCategory.RECEIPT_GENERATOR_SIGNATURE,
      mimeType: 'image/png',
      sizeBytes: payerSignature.sizeBytes,
      createdBy: session.createdBy,
      status: UploadedAssetStatus.ATTACHED,
      attachedType: UploadedAssetAttachmentType.RECEIPT_GENERATOR_SESSION,
      attachedId: session.id,
    },
    {
      path: receiptImage.path,
      name: receiptImage.name,
      category: UploadedAssetCategory.RECEIPT_GENERATOR_FINAL,
      mimeType: 'image/png',
      sizeBytes: receiptImage.sizeBytes,
      createdBy: session.createdBy,
      status: UploadedAssetStatus.ATTACHED,
      attachedType: UploadedAssetAttachmentType.RECEIPT,
      attachedId: session.receiptId,
    },
  ],
});
```

- [ ] **Step 4: Implement stale signing cleanup policy**

```ts
export async function cleanupStaleSigningPendingReceipts(input: { now?: Date } = {}) {
  const now = input.now ?? new Date();
  const { signingPendingTtlHours } = await getUploadedAssetCleanupSettings();
  const threshold = subHours(now, signingPendingTtlHours);

  const staleSessions = await db.receiptGeneratorSession.findMany({
    where: {
      status: ReceiptGeneratorSessionStatus.PENDING,
      createdAt: { lte: threshold },
      receipt: {
        status: ReceiptStatus.SIGNING_PENDING,
        imageUrl: null,
      },
      finalImageUrl: null,
    },
    include: { receipt: true },
  });

  for (const session of staleSessions) {
    await db.$transaction(async (tx) => {
      await tx.receiptGeneratorSession.update({ where: { id: session.id }, data: { status: ReceiptGeneratorSessionStatus.CANCELLED } });
      await tx.receipt.delete({ where: { id: session.receiptId } });
    });
  }
}
```

Also add audit logging for cancelled stale signing sessions.

- [ ] **Step 5: Run tests to verify they pass**

Run:
- `npm test -- --runInBand src/lib/receipt-generator-service.test.ts`
- `npm test -- --runInBand src/lib/uploaded-asset-maintenance.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/receipt-generator-service.ts src/app/api/receipt-generator/route.ts src/lib/uploaded-asset-maintenance.ts src/lib/uploaded-asset-maintenance.test.ts src/lib/receipt-generator-service.test.ts
git commit -m "Register generator assets and stale signing cleanup policy"
```

### Task 5: Add the daily maintenance execution path in Docker

**Files:**
- Create: `src/app/api/internal/maintenance/uploaded-assets/route.ts`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Test: `src/lib/uploaded-asset-maintenance.test.ts`

- [ ] **Step 1: Write the failing route test**

```ts
it('rejects maintenance cleanup requests with an invalid token', async () => {
  const response = await POST(new Request('http://localhost/api/internal/maintenance/uploaded-assets', {
    method: 'POST',
    headers: { 'x-maintenance-token': 'bad-token' },
  }));

  expect(response.status).toBe(401);
});

it('runs both staged-asset cleanup and stale-signing cleanup with a valid token', async () => {
  const response = await POST(new Request('http://localhost/api/internal/maintenance/uploaded-assets', {
    method: 'POST',
    headers: { 'x-maintenance-token': 'expected-token' },
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    success: true,
    data: {
      stagedAssetCleanup: expect.any(Object),
      staleSigningCleanup: expect.any(Object),
    },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/lib/uploaded-asset-maintenance.test.ts`
Expected: FAIL because the internal maintenance route does not exist.

- [ ] **Step 3: Implement the internal route and orchestrator**

```ts
export async function POST(request: Request) {
  const token = request.headers.get('x-maintenance-token');
  if (!token || token !== process.env.MAINTENANCE_JOB_TOKEN) {
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const stagedAssetCleanup = await cleanupExpiredStagedUploadedAssets();
  const staleSigningCleanup = await cleanupStaleSigningPendingReceipts();

  return NextResponse.json({
    success: true,
    data: { stagedAssetCleanup, staleSigningCleanup },
  });
}
```

- [ ] **Step 4: Add the maintenance container to Docker Compose**

```yaml
maintenance:
  image: curlimages/curl:8.12.1
  restart: unless-stopped
  depends_on:
    - app
  environment:
    MAINTENANCE_BASE_URL: ${MAINTENANCE_BASE_URL:-http://app:3000}
    MAINTENANCE_JOB_TOKEN: ${MAINTENANCE_JOB_TOKEN:-replace-with-a-long-random-secret}
    MAINTENANCE_LOOP_SECONDS: ${MAINTENANCE_LOOP_SECONDS:-86400}
  command: >
    sh -c '
      while true; do
        curl -fsS -X POST "$MAINTENANCE_BASE_URL/api/internal/maintenance/uploaded-assets" \
          -H "x-maintenance-token: $MAINTENANCE_JOB_TOKEN" || true;
        sleep "$MAINTENANCE_LOOP_SECONDS";
      done
    '
```

Document the new env vars in `.env.example`:

```env
MAINTENANCE_JOB_TOKEN=replace-with-a-long-random-secret
MAINTENANCE_BASE_URL=http://app:3000
MAINTENANCE_LOOP_SECONDS=86400
UPLOADED_ASSET_STAGED_TTL_HOURS=24
SIGNING_PENDING_TTL_HOURS=72
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
- `npm test -- --runInBand src/lib/uploaded-asset-maintenance.test.ts`
- `docker compose config >/tmp/trading-ledger-maintenance-config.txt`

Expected:
- route/orchestrator tests PASS
- compose config renders a `maintenance` service without syntax errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/internal/maintenance/uploaded-assets/route.ts docker-compose.yml .env.example src/lib/uploaded-asset-maintenance.test.ts
git commit -m "Add scheduled uploaded asset maintenance execution path"
```

### Task 6: Add cleanup logic and full regression verification

**Files:**
- Create: `tests/api/isolated/cases/85-uploaded-asset-cleanup.case.mjs`
- Modify: `README.md`
- Modify: `todolist.md`
- Modify: `ENGINEERING_LOG.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Implement and run the full cleanup case**

```js
await seedExpiredStagedAsset({ path: '/upload/images/receipts/direct/orphan.png', expiresAt: past24h });
await seedAttachedReceiptAsset({ path: '/upload/images/receipts/direct/attached.png' });
await seedStaleSigningPendingSession({ createdAt: past72h });

const response = await postMaintenanceCleanup({ token: process.env.MAINTENANCE_JOB_TOKEN });
assert.equal(response.success, true);

const orphan = await prisma.uploadedAsset.findUnique({ where: { path: '/upload/images/receipts/direct/orphan.png' } });
assert.equal(orphan.status, 'DELETED');

const attached = await prisma.uploadedAsset.findUnique({ where: { path: '/upload/images/receipts/direct/attached.png' } });
assert.equal(attached.status, 'ATTACHED');

const staleSession = await prisma.receiptGeneratorSession.findUnique({ where: { id: staleSessionId } });
assert.equal(staleSession.status, 'CANCELLED');
```

- [ ] **Step 2: Run focused verification commands**

Run:
- `npm test -- --runInBand src/lib/uploaded-asset-service.test.ts`
- `npm test -- --runInBand src/lib/uploaded-asset-maintenance.test.ts`
- `npm test -- --runInBand src/lib/receipt-generator-service.test.ts`
- `npm run test:api:isolated -- 85-uploaded-asset-cleanup.case.mjs`

Expected: all PASS.

- [ ] **Step 3: Run full project verification**

Run:
- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- `npm run test:ci`

Expected: PASS with unit, isolated API, and isolated E2E all green.

- [ ] **Step 4: Update docs and version**

```bash
npm version 1.0.108 --no-git-tag-version
```

Document in:
- `README.md` user-facing note about safer temporary upload lifecycle
- `todolist.md` milestone note for orphan cleanup and signing pending cleanup
- `ENGINEERING_LOG.md` technical notes about `UploadedAsset`, maintenance route, Docker maintenance service, and no historical backfill

- [ ] **Step 5: Rebuild the local running service**

Run:
- `docker compose up -d --build`
- `docker exec trading-ledger-system-app-1 node -p "require('./package.json').version"`
- `curl -k -I https://localhost | head -n 1`

Expected:
- container version is `1.0.108`
- local HTTPS returns `HTTP/2 200`

- [ ] **Step 6: Commit and push**

```bash
git add README.md todolist.md ENGINEERING_LOG.md package.json package-lock.json tests/api/isolated/cases/85-uploaded-asset-cleanup.case.mjs
git commit -m "Add uploaded asset registry and automated cleanup"
git push origin main
```
