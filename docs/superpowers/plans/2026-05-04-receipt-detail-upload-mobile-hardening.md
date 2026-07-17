# Receipt/Detail Upload Mobile Hardening Implementation Plan

> **Plan status:** `ARCHIVED_COMPLETED` as of 2026-07-17. The implementation is on `main`; unchecked boxes below are retained as the original execution checklist and are not active backlog. See [the status index](./README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make receipt/detail image uploads mobile-safe and weak-network-tolerant by adding per-user compression preferences, a shared upload/compression pipeline, and responsive receipt action/preview layouts.

**Architecture:** Add a dedicated user-preference persistence layer instead of overloading system config, then route receipt direct upload, receipt OCR upload, and payment-detail OCR upload through one shared front-end business-image pipeline. Keep server business endpoints stable, but unify timeout/error mapping and mobile preview behavior in the client so retry and compression behavior stop diverging between modules.

**Tech Stack:** Next.js App Router, React hooks, Zustand store, Prisma/MySQL, Jest, isolated API tests, isolated Playwright tests, Docker Compose.

---

## File Structure

### New files
- `prisma/migrations/<timestamp>_user_preference_image_compression/migration.sql` — create per-user preference table.
- `src/lib/user-preference-service.ts` — user-preference read/write logic and defaults.
- `src/lib/user-preference-service.test.ts` — service-level validation and authorization tests.
- `src/components/workspace/modules/settings/components/user-image-compression-card.tsx` — per-user compression settings card.
- `src/components/workspace/modules/settings/components/user-image-compression-card.test.tsx` — card interaction tests.
- `src/components/workspace/modules/shared/business-image-upload.ts` — shared browser upload/compression pipeline for business image flows.
- `src/components/workspace/modules/shared/business-image-upload.test.ts` — upload pipeline tests.

### Existing files to modify
- `prisma/schema.prisma` — add `UserPreference` model and relation.
- `src/app/api/settings/route.ts` — add user-preference read/update branches.
- `src/lib/settings-read-service.ts` — expose current-user preference payload.
- `src/lib/settings-write-service.ts` — validate/update current-user preference.
- `src/components/workspace/modules/settings/settings-manager.tsx` — load/save user preference data.
- `src/components/workspace/modules/settings/types.ts` — add per-user preference view types.
- `src/components/workspace/modules/settings/hooks/use-settings-actions.ts` — wire read/write actions.
- `src/components/workspace/api/client.ts` — extend upload client reuse points if needed by shared pipeline.
- `src/components/workspace/modules/receipts/utils/image-compression.ts` — split direct-only helper into shared compression primitives.
- `src/components/workspace/modules/receipts/components/receipt-direct-image-confirm-dialog.tsx` — mobile-safe sticky header + bounded preview.
- `src/components/workspace/modules/receipts/receipt-manager.tsx` — reorder and reflow top action buttons.
- `src/components/workspace/modules/receipts/hooks/use-receipt-forms.ts` — integrate shared pipeline state for receipt flows.
- `src/components/workspace/modules/receipts/hooks/use-receipt-actions.ts` — switch receipt OCR and direct upload to shared pipeline.
- `src/components/workspace/modules/receipts/components/receipt-upload-dialog.tsx` — show shared upload progress/status and mobile-friendly chooser behavior.
- `src/components/workspace/modules/receipts/components/receipt-direct-create-dialog.tsx` — consume unified upload states and per-user settings behavior.
- `src/components/workspace/modules/receipts/types.ts` — add shared upload state types.
- `src/components/workspace/modules/details/hooks/use-detail-forms.ts` — add OCR retry-safe state.
- `src/components/workspace/modules/details/hooks/use-detail-actions.ts` — migrate detail OCR upload to shared pipeline.
- `src/components/workspace/modules/details/components/detail-upload-dialog.tsx` — show upload pipeline states and retry-safe UX.
- `src/components/workspace/modules/details/types.ts` — add shared upload state types if needed.
- `tests/api/isolated/cases/...` or settings isolated case — extend settings API coverage for per-user preference.
- `tests/e2e/...` — extend receipt/detail mobile and retry coverage.
- `README.md` — document per-user compression settings and weak-network upload behavior.
- `todolist.md` — record milestone.
- `ENGINEERING_LOG.md` — record engineering note.
- `package.json` / `package-lock.json` — bump version.

---

### Task 1: Persist per-user compression preferences

**Files:**
- Create: `prisma/migrations/<timestamp>_user_preference_image_compression/migration.sql`
- Create: `src/lib/user-preference-service.ts`
- Test: `src/lib/user-preference-service.test.ts`
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/settings-read-service.ts`
- Modify: `src/lib/settings-write-service.ts`
- Modify: `src/app/api/settings/route.ts`

- [ ] **Step 1: Write the failing Prisma/service tests**

```ts
it('returns default image compression preferences when the user has no row', async () => {
  mockedDb.userPreference.findUnique.mockResolvedValue(null);

  const result = await getUserImageCompressionPreference({ id: 'u1', role: UserRole.SALES, email: 'a', name: null, level: 3 });

  expect(result).toEqual({
    enabled: true,
    qualityFloor: 0.3,
    ocrTargetMaxKb: 500,
  });
});

it('updates only the current user preference row', async () => {
  mockedDb.userPreference.upsert.mockResolvedValue({
    userId: 'u1',
    imageCompressionEnabled: false,
    imageCompressionQualityFloor: new Prisma.Decimal('0.45'),
    ocrTargetMaxKb: 800,
  });

  const result = await updateUserImageCompressionPreference(currentUser, {
    enabled: false,
    qualityFloor: 0.45,
    ocrTargetMaxKb: 800,
  });

  expect(mockedDb.userPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { userId: 'u1' },
  }));
  expect(result.ocrTargetMaxKb).toBe(800);
});

it('rejects an out-of-range quality floor', async () => {
  await expect(updateUserImageCompressionPreference(currentUser, {
    enabled: true,
    qualityFloor: 0.1,
    ocrTargetMaxKb: 500,
  })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/lib/user-preference-service.test.ts
```

Expected: FAIL with missing `userPreference` model/service exports.

- [ ] **Step 3: Add Prisma model and migration**

```prisma
model UserPreference {
  id                           String   @id @default(cuid())
  userId                       String   @unique
  imageCompressionEnabled      Boolean  @default(true)
  imageCompressionQualityFloor Decimal  @default(0.30) @db.Decimal(3, 2)
  ocrTargetMaxKb               Int      @default(500)
  createdAt                    DateTime @default(now())
  updatedAt                    DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

```sql
CREATE TABLE `UserPreference` (
  `id` varchar(191) NOT NULL,
  `userId` varchar(191) NOT NULL,
  `imageCompressionEnabled` tinyint(1) NOT NULL DEFAULT 1,
  `imageCompressionQualityFloor` decimal(3,2) NOT NULL DEFAULT 0.30,
  `ocrTargetMaxKb` int NOT NULL DEFAULT 500,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UserPreference_userId_key` (`userId`),
  CONSTRAINT `UserPreference_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
);
```

- [ ] **Step 4: Implement service defaults and validation**

```ts
export const DEFAULT_USER_IMAGE_COMPRESSION_PREFERENCE = {
  enabled: true,
  qualityFloor: 0.3,
  ocrTargetMaxKb: 500,
} as const;

export async function getUserImageCompressionPreference(currentUser: CurrentUser) {
  const row = await db.userPreference.findUnique({ where: { userId: currentUser.id } });
  if (!row) return { ...DEFAULT_USER_IMAGE_COMPRESSION_PREFERENCE };
  return {
    enabled: row.imageCompressionEnabled,
    qualityFloor: Number(row.imageCompressionQualityFloor),
    ocrTargetMaxKb: row.ocrTargetMaxKb,
  };
}

export async function updateUserImageCompressionPreference(currentUser: CurrentUser, input: unknown) {
  const payload = normalizeUserImageCompressionPayload(input);
  return db.userPreference.upsert({
    where: { userId: currentUser.id },
    create: {
      userId: currentUser.id,
      imageCompressionEnabled: payload.enabled,
      imageCompressionQualityFloor: payload.qualityFloor,
      ocrTargetMaxKb: payload.ocrTargetMaxKb,
    },
    update: {
      imageCompressionEnabled: payload.enabled,
      imageCompressionQualityFloor: payload.qualityFloor,
      ocrTargetMaxKb: payload.ocrTargetMaxKb,
    },
  }).then(toPreferenceDto);
}
```

- [ ] **Step 5: Expose settings API branches**

```ts
if (view === 'user-preferences') {
  const data = await getUserImageCompressionPreference(currentUser);
  return createApiSuccessResponse({ data, message: '用户图片压缩设置已加载' }, _request);
}

if (action === 'update-user-preferences') {
  const data = await updateUserImageCompressionPreference(currentUser, body?.preferences);
  return createApiSuccessResponse({ data, message: '用户图片压缩设置已保存' }, request);
}
```

- [ ] **Step 6: Run focused tests and Prisma generation**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npx prisma generate
npm test -- --runInBand src/lib/user-preference-service.test.ts src/lib/settings-service.test.ts
```

Expected: PASS for new service tests and no regressions in settings tests.

- [ ] **Step 7: Commit**

```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
git add prisma/schema.prisma prisma/migrations src/lib/user-preference-service.ts src/lib/user-preference-service.test.ts src/lib/settings-read-service.ts src/lib/settings-write-service.ts src/app/api/settings/route.ts
git commit -m "Add per-user image compression preferences"
```

---

### Task 2: Add user-level compression settings UI

**Files:**
- Create: `src/components/workspace/modules/settings/components/user-image-compression-card.tsx`
- Test: `src/components/workspace/modules/settings/components/user-image-compression-card.test.tsx`
- Modify: `src/components/workspace/modules/settings/settings-manager.tsx`
- Modify: `src/components/workspace/modules/settings/hooks/use-settings-actions.ts`
- Modify: `src/components/workspace/modules/settings/types.ts`

- [ ] **Step 1: Write the failing component/action tests**

```tsx
it('renders current-user compression settings and saves updated values', async () => {
  render(
    <UserImageCompressionCard
      preference={{ enabled: true, qualityFloor: 0.3, ocrTargetMaxKb: 500 }}
      saving={false}
      tx={(zh, en) => en}
      onChange={onChange}
      onSave={onSave}
    />
  );

  await user.type(screen.getByLabelText('OCR target max size (KB)'), '{selectall}800');
  await user.click(screen.getByRole('button', { name: 'Save image compression settings' }));

  expect(onSave).toHaveBeenCalled();
});

it('loads user preferences from settings api view=user-preferences', async () => {
  mockedApiCall.mockResolvedValue({ success: true, data: { enabled: true, qualityFloor: 0.3, ocrTargetMaxKb: 500 } });
  await loadUserImageCompressionPreference();
  expect(mockedApiCall).toHaveBeenCalledWith('settings?view=user-preferences');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/components/workspace/modules/settings/components/user-image-compression-card.test.tsx src/components/workspace/modules/settings/hooks/use-settings-actions.test.tsx
```

Expected: FAIL with missing component/state wiring.

- [ ] **Step 3: Add settings UI component**

```tsx
export function UserImageCompressionCard({ preference, saving, tx, onChange, onSave }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx('图片压缩设置', 'Image Compression Settings')}</CardTitle>
        <CardDescription>{tx('仅影响当前账号上传图片时的压缩行为。', 'Only affects image uploads for the current account.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={preference.enabled}
            onChange={(e) => onChange({ ...preference, enabled: e.target.checked })}
          />
          {tx('启用图片压缩', 'Enable image compression')}
        </Label>
        <div>
          <Label>{tx('压缩质量下限', 'Compression quality floor')}</Label>
          <Input type="number" min="0.3" max="1" step="0.05" value={preference.qualityFloor} onChange={...} />
        </div>
        <div>
          <Label>{tx('OCR目标大小（KB）', 'OCR target max size (KB)')}</Label>
          <Input type="number" min="100" max="5000" step="50" value={preference.ocrTargetMaxKb} onChange={...} />
        </div>
        <div className="flex justify-end">
          <Button onClick={onSave} disabled={saving}>{tx('保存图片压缩设置', 'Save image compression settings')}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Wire state into settings manager/actions**

```ts
const [userImageCompressionPreference, setUserImageCompressionPreference] = useState(DEFAULT_USER_IMAGE_COMPRESSION_PREFERENCE);

const loadUserImageCompressionPreference = async () => {
  const result = await apiCall('settings?view=user-preferences');
  if (result.success) setUserImageCompressionPreference(result.data);
};

const saveUserImageCompressionPreference = async () => {
  const result = await apiCall('settings', {
    method: 'POST',
    body: JSON.stringify({ action: 'update-user-preferences', preferences: userImageCompressionPreference }),
  });
  if (!result.success) throw result;
};
```

- [ ] **Step 5: Run targeted tests**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/components/workspace/modules/settings/components/user-image-compression-card.test.tsx src/components/workspace/modules/settings/hooks/use-settings-actions.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
git add src/components/workspace/modules/settings/components/user-image-compression-card.tsx src/components/workspace/modules/settings/components/user-image-compression-card.test.tsx src/components/workspace/modules/settings/settings-manager.tsx src/components/workspace/modules/settings/hooks/use-settings-actions.ts src/components/workspace/modules/settings/types.ts
 git commit -m "Add user image compression settings UI"
```

---

### Task 3: Build the shared business image upload pipeline

**Files:**
- Create: `src/components/workspace/modules/shared/business-image-upload.ts`
- Test: `src/components/workspace/modules/shared/business-image-upload.test.ts`
- Modify: `src/components/workspace/modules/receipts/utils/image-compression.ts`
- Modify: `src/components/workspace/api/client.ts`

- [ ] **Step 1: Write the failing pipeline tests**

```ts
it('compresses files using the provided user preference before OCR upload', async () => {
  mockedCompress.mockResolvedValue({ file: compressedFile, compressed: true, qualityUsed: 0.35 });
  mockedUpload.mockResolvedValue({ success: true, data: { ocrResult: { invNo: 'INV-1' }, image: { path: '/upload/x.jpg', name: 'x.jpg' } } });

  const result = await runBusinessImageUpload({
    file: originalFile,
    mode: 'ocr-receipt',
    preference: { enabled: true, qualityFloor: 0.35, ocrTargetMaxKb: 500 },
  });

  expect(mockedCompress).toHaveBeenCalledWith(originalFile, expect.objectContaining({ targetMaxKb: 500 }));
  expect(result.stage).toBe('success');
});

it('maps idle timeout to a retryable upload error', async () => {
  mockedUpload.mockRejectedValue(new WorkspaceApiError('上传空闲超时', { code: 'UPLOAD_IDLE_TIMEOUT' }));

  await expect(runBusinessImageUpload(...)).rejects.toMatchObject({ code: 'UPLOAD_IDLE_TIMEOUT' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/components/workspace/modules/shared/business-image-upload.test.ts
```

Expected: FAIL with missing module/export.

- [ ] **Step 3: Generalize image compression helper**

```ts
export type CompressionPreference = {
  enabled: boolean;
  qualityFloor: number;
  targetMaxKb: number;
};

export async function compressBusinessImage(file: File, preference: CompressionPreference) {
  if (!preference.enabled) {
    return { file, compressed: false, qualityUsed: null };
  }
  // reuse bitmap/canvas flow and stop shrinking once <= targetMaxKb or qualityFloor is reached
}
```

- [ ] **Step 4: Implement shared pipeline module**

```ts
export async function runBusinessImageUpload(input: {
  file: File;
  endpoint: 'receipt' | 'detail';
  preference: CompressionPreference;
  tx: (zh: string, en: string) => string;
  onStageChange?: (state: UploadPipelineState) => void;
}) {
  const compressed = await compressBusinessImage(input.file, {
    ...input.preference,
    targetMaxKb: input.preference.targetMaxKb,
  });

  const formData = new FormData();
  formData.append('file', compressed.file);
  formData.append('action', 'recognize');

  const result = await apiUploadCall(input.endpoint, formData, {
    method: 'POST',
    idleTimeoutMs: DEFAULT_UPLOAD_IDLE_TIMEOUT_MS,
    hardTimeoutMs: DEFAULT_UPLOAD_HARD_TIMEOUT_MS,
    onUploadProgress: ({ percent }) => input.onStageChange?.({ stage: 'uploading', percent }),
    onUploadStageChange: (stage) => input.onStageChange?.({ stage, percent: 100 }),
  });

  return {
    compressed,
    result,
  };
}
```

- [ ] **Step 5: Run targeted tests**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/components/workspace/modules/shared/business-image-upload.test.ts src/components/workspace/modules/receipts/utils/image-compression.test.ts src/components/workspace/api/client.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
git add src/components/workspace/modules/shared/business-image-upload.ts src/components/workspace/modules/shared/business-image-upload.test.ts src/components/workspace/modules/receipts/utils/image-compression.ts src/components/workspace/api/client.ts
 git commit -m "Add shared business image upload pipeline"
```

---

### Task 4: Fix receipt mobile layout and direct-image preview confirm

**Files:**
- Modify: `src/components/workspace/modules/receipts/components/receipt-direct-image-confirm-dialog.tsx`
- Modify: `src/components/workspace/modules/receipts/receipt-manager.tsx`
- Test: `src/components/workspace/modules/receipts/components/receipt-direct-image-confirm-dialog.test.tsx`
- Test: `src/components/workspace/modules/receipts/receipt-manager.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing layout tests**

```tsx
it('keeps confirm action visible in portrait preview mode', () => {
  render(<ReceiptDirectImageConfirmDialog selection={selection} ... />);
  expect(screen.getByRole('button', { name: 'Confirm Upload' })).toBeVisible();
});

it('renders receipt actions in upload/direct/generator order', () => {
  render(<ReceiptManager />);
  const buttons = screen.getAllByRole('button').map((b) => b.textContent);
  expect(buttons).toEqual(expect.arrayContaining([
    'Upload Receipt',
    'Create Directly',
    'Generate Signed Receipt',
  ]));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/components/workspace/modules/receipts/components/receipt-direct-image-confirm-dialog.test.tsx src/components/workspace/modules/receipts/receipt-manager.test.tsx
```

Expected: FAIL on current ordering/layout assumptions.

- [ ] **Step 3: Update the preview dialog for portrait-safe header + bounded preview**

```tsx
<div className="flex h-full min-h-0 flex-col bg-background">
  <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b bg-background px-3 py-3 sm:px-4">
    ...buttons...
  </div>
  <div className="min-h-0 flex-1 overflow-auto bg-muted/30 px-3 py-3 sm:p-6">
    <div className="mx-auto flex max-w-[min(100%,48rem)] justify-center">
      <img className="block max-h-[calc(100dvh-9rem)] w-auto max-w-full object-contain rounded-lg shadow-sm" ... />
    </div>
  </div>
</div>
```

- [ ] **Step 4: Reorder and wrap receipt action buttons**

```tsx
<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
  <Button onClick={() => handleShowUploadChange(true)}>...</Button>
  <Button variant="outline" onClick={() => handleShowDirectCreateChange(true)}>...</Button>
  {canUseReceiptGenerator && <Button variant="outline" onClick={() => setShowGeneratorLaunch(true)}>...</Button>}
</div>
```

- [ ] **Step 5: Run targeted tests**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/components/workspace/modules/receipts/components/receipt-direct-image-confirm-dialog.test.tsx src/components/workspace/modules/receipts/receipt-manager.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
git add src/components/workspace/modules/receipts/components/receipt-direct-image-confirm-dialog.tsx src/components/workspace/modules/receipts/components/receipt-direct-image-confirm-dialog.test.tsx src/components/workspace/modules/receipts/receipt-manager.tsx src/components/workspace/modules/receipts/receipt-manager.test.tsx
 git commit -m "Fix receipt mobile action and preview layout"
```

---

### Task 5: Migrate receipt OCR upload to the shared pipeline

**Files:**
- Modify: `src/components/workspace/modules/receipts/hooks/use-receipt-actions.ts`
- Modify: `src/components/workspace/modules/receipts/hooks/use-receipt-forms.ts`
- Modify: `src/components/workspace/modules/receipts/components/receipt-upload-dialog.tsx`
- Modify: `src/components/workspace/modules/receipts/types.ts`
- Test: `src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`
- Test: `src/components/workspace/modules/receipts/hooks/use-receipt-forms.test.tsx`

- [ ] **Step 1: Write failing receipt OCR retry/compression tests**

```ts
it('uses user compression preference before receipt OCR recognize upload', async () => {
  mockedRunBusinessImageUpload.mockResolvedValue({
    compressed: { compressed: true, qualityUsed: 0.35 },
    result: { success: true, data: { ocrResult: { invNo: 'L1' }, image: { path: '/upload/r.jpg', name: 'r.jpg' } } },
  });

  await result.current.handleFileSelect(makeFileChangeEvent(file));

  expect(mockedRunBusinessImageUpload).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'receipt' }));
});

it('clears uploading state and allows retry after failed to fetch', async () => {
  mockedRunBusinessImageUpload.mockRejectedValue(new WorkspaceApiError('Network error', { code: 'UPLOAD_ABORTED' }));

  await result.current.handleFileSelect(makeFileChangeEvent(file));

  expect(result.current.uploading).toBe(false);
  expect(setError).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx src/components/workspace/modules/receipts/hooks/use-receipt-forms.test.tsx
```

Expected: FAIL because raw fetch path is still in place.

- [ ] **Step 3: Add shared upload state to receipt forms/types**

```ts
export type OcrUploadState = {
  stage: 'idle' | 'compressing' | 'uploading' | 'saving' | 'success' | 'failed';
  message: string | null;
  progress: number | null;
};
```

```ts
const [ocrUploadState, setOcrUploadState] = useState<OcrUploadState>({ stage: 'idle', message: null, progress: null });
```

- [ ] **Step 4: Replace raw OCR fetch with shared pipeline**

```ts
const upload = await runBusinessImageUpload({
  file,
  endpoint: 'receipt',
  preference: currentUserCompressionPreference,
  tx,
  onStageChange: ({ stage, percent }) => {
    setOcrUploadState({ stage, progress: percent ?? null, message: stageToMessage(stage, percent) });
  },
});

if (upload.result.success) {
  setOcrResult(upload.result.data.ocrResult);
  setSavedImagePath(upload.result.data.image || null);
  setOcrUploadState({ stage: 'success', message: tx('识别完成', 'Recognition completed'), progress: 100 });
} else {
  // unreachable if apiUploadCall throws, but keep defensive mapping
}
```

- [ ] **Step 5: Update upload dialog UX**

```tsx
{uploading && (
  <div className="space-y-2 py-4 text-sm">
    <div>{ocrUploadState.message || tx('AI识别中...', 'AI recognizing...')}</div>
    {typeof ocrUploadState.progress === 'number' && <div>{ocrUploadState.progress}%</div>}
  </div>
)}
```

- [ ] **Step 6: Run targeted receipt tests**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx src/components/workspace/modules/receipts/hooks/use-receipt-forms.test.tsx src/components/workspace/modules/receipts/components/receipt-upload-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
git add src/components/workspace/modules/receipts/hooks/use-receipt-actions.ts src/components/workspace/modules/receipts/hooks/use-receipt-forms.ts src/components/workspace/modules/receipts/components/receipt-upload-dialog.tsx src/components/workspace/modules/receipts/types.ts src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx src/components/workspace/modules/receipts/hooks/use-receipt-forms.test.tsx
 git commit -m "Migrate receipt OCR upload to shared pipeline"
```

---

### Task 6: Migrate payment-detail OCR upload to the shared pipeline

**Files:**
- Modify: `src/components/workspace/modules/details/hooks/use-detail-actions.ts`
- Modify: `src/components/workspace/modules/details/hooks/use-detail-forms.ts`
- Modify: `src/components/workspace/modules/details/components/detail-upload-dialog.tsx`
- Modify: `src/components/workspace/modules/details/types.ts`
- Test: `src/components/workspace/modules/details/hooks/use-detail-actions.test.tsx`

- [ ] **Step 1: Write failing detail OCR tests**

```ts
it('compresses payment detail image before OCR upload', async () => {
  mockedRunBusinessImageUpload.mockResolvedValue({
    compressed: { compressed: true, qualityUsed: 0.4 },
    result: { success: true, data: { ocrResult: { items: [] }, image: { path: '/upload/d.jpg', name: 'd.jpg' } } },
  });

  await result.current.handleFileSelect(makeFileChangeEvent(file));

  expect(mockedRunBusinessImageUpload).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'detail' }));
});

it('restores retryable state after failed detail OCR upload', async () => {
  mockedRunBusinessImageUpload.mockRejectedValue(new WorkspaceApiError('Network error', { code: 'UPLOAD_ABORTED' }));

  await result.current.handleFileSelect(makeFileChangeEvent(file));

  expect(result.current.uploading).toBe(false);
  expect(setSavedImagePath).toHaveBeenCalledWith(null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/components/workspace/modules/details/hooks/use-detail-actions.test.tsx
```

Expected: FAIL while still using raw fetch.

- [ ] **Step 3: Mirror the shared upload state in detail forms/types**

```ts
const [ocrUploadState, setOcrUploadState] = useState<OcrUploadState>({ stage: 'idle', message: null, progress: null });
```

- [ ] **Step 4: Replace raw detail OCR fetch with shared pipeline**

```ts
const upload = await runBusinessImageUpload({
  file,
  endpoint: 'detail',
  preference: currentUserCompressionPreference,
  tx,
  onStageChange: ({ stage, percent }) => setOcrUploadState({ stage, progress: percent ?? null, message: stageToMessage(stage, percent) }),
});

setOcrResult(upload.result.data.ocrResult);
setSavedImagePath(upload.result.data.image || null);
```

- [ ] **Step 5: Update detail upload dialog status display**

```tsx
{uploading && (
  <div className="flex flex-col items-center justify-center gap-2 py-8">
    <Loader2 className="h-8 w-8 animate-spin" />
    <span>{ocrUploadState.message || tx('AI识别中...', 'AI recognizing...')}</span>
    {typeof ocrUploadState.progress === 'number' && <span>{ocrUploadState.progress}%</span>}
  </div>
)}
```

- [ ] **Step 6: Run targeted detail tests**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npm test -- --runInBand src/components/workspace/modules/details/hooks/use-detail-actions.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
git add src/components/workspace/modules/details/hooks/use-detail-actions.ts src/components/workspace/modules/details/hooks/use-detail-forms.ts src/components/workspace/modules/details/components/detail-upload-dialog.tsx src/components/workspace/modules/details/types.ts src/components/workspace/modules/details/hooks/use-detail-actions.test.tsx
 git commit -m "Migrate detail OCR upload to shared pipeline"
```

---

### Task 7: Full verification, docs, version, and local service sync

**Files:**
- Modify: `README.md`
- Modify: `todolist.md`
- Modify: `ENGINEERING_LOG.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/api/isolated/...`
- Test: `tests/e2e/...`

- [ ] **Step 1: Extend isolated API coverage for user preference endpoints**

```js
const pref = await authedJson('/api/settings?view=user-preferences');
assert.equal(pref.success, true);
assert.equal(pref.data.ocrTargetMaxKb, 500);

const updated = await authedJson('/api/settings', {
  method: 'POST',
  body: JSON.stringify({
    action: 'update-user-preferences',
    preferences: { enabled: true, qualityFloor: 0.45, ocrTargetMaxKb: 800 },
  }),
});
assert.equal(updated.success, true);
```

- [ ] **Step 2: Extend browser coverage for mobile receipt actions / preview visibility / OCR retry**

```ts
await page.setViewportSize({ width: 390, height: 844 });
await expect(page.getByRole('button', { name: /upload receipt/i })).toBeVisible();
await expect(page.getByRole('button', { name: /create directly/i })).toBeVisible();

await page.getByRole('button', { name: /from gallery/i }).click();
await expect(page.getByRole('button', { name: /confirm upload/i })).toBeVisible();
```

- [ ] **Step 3: Run the full verification suite**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
npx tsc --noEmit
npm run build
npm run test:ci
```

Expected:
- TypeScript passes
- Build passes
- Jest suites pass
- isolated API cases pass
- isolated Playwright tests pass

- [ ] **Step 4: Update docs and version**

```md
- README: note per-user image compression settings and OCR upload hardening.
- todolist: add v1.0.110 milestone for receipt/detail mobile upload hardening.
- engineering log: record shared upload pipeline + per-user preference architecture.
```

```json
{
  "version": "1.0.110"
}
```

- [ ] **Step 5: Rebuild local Docker service**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
docker compose up -d --build
curl -k -I https://localhost | head -n 1
```

Expected:
- containers rebuild successfully
- local HTTPS returns `HTTP/2 200`

- [ ] **Step 6: Commit and push**

```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
git add README.md todolist.md ENGINEERING_LOG.md package.json package-lock.json tests src
git commit -m "Harden receipt/detail mobile image upload flows"
git push origin main
```

- [ ] **Step 7: Watch GitHub Actions to completion**

Run:
```bash
cd /Users/maotiannan/dev/docker/Trading-Ledger-System
gh run list --limit 3 --json databaseId,displayTitle,status,conclusion,url
```

Expected: latest run for the push reaches `success`.

---

## Self-Review

### Spec coverage
- Mobile-safe `Create Directly` preview: Task 4.
- Receipt top-button reorder and mobile responsiveness: Task 4.
- Receipt OCR compression + weak-network hardening: Task 5.
- Detail OCR compression + weak-network hardening: Task 6.
- Per-user persisted settings: Tasks 1 and 2.
- Shared upload pipeline reuse: Task 3.
- Retry-safe `failed to fetch` recovery: Tasks 5 and 6.
- Docs/version/docker/git sync: Task 7.

### Placeholder scan
- No `TODO/TBD` placeholders remain.
- Each task includes concrete files, test examples, commands, and commit steps.

### Type consistency
- User preference fields are consistently named:
  - `enabled`
  - `qualityFloor`
  - `ocrTargetMaxKb`
- Shared upload state uses one `stage/message/progress` shape across receipt/detail tasks.
- Shared compression path consistently refers to `targetMaxKb` for upload behavior.
