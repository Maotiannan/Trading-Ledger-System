# Dashboard Layout Preferences Implementation Plan

> **Plan status:** `ARCHIVED_COMPLETED` as of 2026-07-17. The implementation is on `main`; unchecked boxes below are retained as the original execution checklist and are not active backlog. See [the status index](./README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add account-scoped Dashboard card visibility and ordering for the current eight cards and future registered cards.

**Architecture:** Extend the existing `UserPreference` table with a nullable JSON `dashboardLayout` field. Centralize Dashboard section/card IDs in a shared registry and pure normalizer, then make Settings and Dashboard consume the same normalized layout so future cards are added in one place.

**Tech Stack:** Next.js App Router, React client components, Prisma/MySQL, Jest + Testing Library, existing `/api/settings` user-preferences API.

---

## Files And Responsibilities

- Create `prisma/migrations/20260608090000_user_dashboard_layout_preference/migration.sql`: add nullable JSON preference column.
- Modify `prisma/schema.prisma`: add `dashboardLayout Json?` to `UserPreference`.
- Create `src/lib/dashboard-layout-preference.ts`: server/client-safe section/card registry, default layout, normalizers, validation, ordering helpers.
- Create `src/lib/dashboard-layout-preference.test.ts`: pure unit tests for defaulting, hiding, restoring, sorting, future card normalization, and invalid ID handling.
- Modify `src/lib/user-preference-service.ts`: include Dashboard layout in account-level preferences and update validation/save logic.
- Modify `src/lib/settings-read-service.ts`: rename/read full current user preferences while preserving old image compression behavior.
- Modify `src/lib/settings-write-service.ts`: update current user preferences with image compression and Dashboard layout together or separately.
- Modify `src/app/api/settings/route.ts`: return/save full user preferences through the existing `view=user-preferences` and `update-user-preferences` paths.
- Modify `src/app/api/settings/route.test.ts`: cover Dashboard preference GET/POST and invalid payload rejection.
- Modify `src/lib/settings-service.test.ts`: cover service-level default and saved Dashboard preference behavior.
- Modify `src/components/workspace/modules/settings/types.ts`: add Dashboard preference UI types while keeping image compression types.
- Modify `src/components/workspace/modules/settings/hooks/use-settings-forms.ts`: store full user preference draft and expose Dashboard layout updater.
- Modify `src/components/workspace/modules/settings/hooks/use-settings-actions.ts`: normalize, validate, load, and save full user preferences.
- Create `src/components/workspace/modules/settings/components/dashboard-settings-card.tsx`: Settings UI for section and card visibility/order using Up/Down buttons and switches.
- Modify `src/components/workspace/modules/settings/components/index.ts`: export the new card.
- Modify `src/components/workspace/modules/settings/settings-manager.tsx`: insert collapsible `Dashboard 设置 / Dashboard Settings` section.
- Modify `src/components/workspace/modules/settings/components/dashboard-settings-card.test.tsx`: component tests for toggles and Up/Down actions.
- Refactor `src/components/workspace/modules/dashboard/dashboard-view.tsx`: render sections/cards from normalized layout and wire hide confirmation/save.
- Modify `src/components/workspace/modules/dashboard/dashboard-view.test.tsx`: cover hidden cards, empty section hiding, and hide confirmation text.
- Modify `src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`: update existing `settings?view=user-preferences` mock payloads if shape changes.
- Modify `docs/backup/muledger-cos-backup.md`: record that `UserPreference.dashboardLayout` is MySQL-backed and included in database dumps.
- Modify `README.md`, `todolist.md`, and `ENGINEERING_LOG.md`: concise user-facing and engineering notes for this Dashboard setting.

---

### Task 1: Database Schema And Backup Gate

**Files:**
- Create: `prisma/migrations/20260608090000_user_dashboard_layout_preference/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/user-preference-schema.test.ts`
- Modify: `docs/backup/muledger-cos-backup.md`

- [ ] **Step 1: Write the schema contract test first**

Add these assertions to `src/lib/user-preference-schema.test.ts` inside the existing `describe('user preference schema contract', ...)` suite:

```ts
it('stores dashboard layout preferences on the account preference row', () => {
  const schema = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  const migration = fs.readFileSync(
    path.join(process.cwd(), 'prisma/migrations/20260608090000_user_dashboard_layout_preference/migration.sql'),
    'utf8',
  );

  expect(schema).toContain('dashboardLayout');
  expect(schema).toContain('dashboardLayout               Json?');
  expect(migration).toContain('ADD COLUMN `dashboardLayout` JSON NULL');
});
```

- [ ] **Step 2: Run the targeted schema test to verify it fails**

Run:

```bash
npm test -- --runInBand src/lib/user-preference-schema.test.ts
```

Expected: FAIL because the migration file and schema field do not exist yet.

- [ ] **Step 3: Add the Prisma schema field**

In `prisma/schema.prisma`, update `model UserPreference` to include the new nullable JSON field after `ocrTargetMaxKb`:

```prisma
model UserPreference {
  userId                        String
  imageCompressionEnabled       Boolean  @default(true)
  imageCompressionQualityFloor  Decimal  @default(0.30) @db.Decimal(3, 2)
  ocrTargetMaxKb                Int      @default(500)
  dashboardLayout               Json?
  createdAt                     DateTime @default(now())
  updatedAt                     DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId])
}
```

- [ ] **Step 4: Add the migration**

Create `prisma/migrations/20260608090000_user_dashboard_layout_preference/migration.sql` with exactly:

```sql
ALTER TABLE `UserPreference`
  ADD COLUMN `dashboardLayout` JSON NULL;
```

- [ ] **Step 5: Update backup documentation**

In `docs/backup/muledger-cos-backup.md`, under `## 1. Data Scope`, add this sentence after the MySQL bullet list:

```markdown
The MySQL dump includes account-level preferences such as `UserPreference.dashboardLayout`; no separate media backup path is required for Dashboard layout settings.
```

- [ ] **Step 6: Run schema test again**

Run:

```bash
npm test -- --runInBand src/lib/user-preference-schema.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit schema and backup changes**

```bash
git add prisma/schema.prisma prisma/migrations/20260608090000_user_dashboard_layout_preference/migration.sql src/lib/user-preference-schema.test.ts docs/backup/muledger-cos-backup.md
git commit -m "feat: add dashboard layout preference storage"
```

---

### Task 2: Shared Dashboard Layout Registry And Normalizer

**Files:**
- Create: `src/lib/dashboard-layout-preference.ts`
- Create: `src/lib/dashboard-layout-preference.test.ts`

- [ ] **Step 1: Write pure normalizer tests first**

Create `src/lib/dashboard-layout-preference.test.ts`:

```ts
import {
  DASHBOARD_CARD_REGISTRY,
  DEFAULT_DASHBOARD_LAYOUT,
  hideDashboardCard,
  moveDashboardCard,
  moveDashboardSection,
  normalizeDashboardLayoutPreference,
  restoreDashboardCard,
  validateDashboardLayoutPreferenceForSave,
} from '@/lib/dashboard-layout-preference';

describe('dashboard-layout-preference', () => {
  it('returns the current eight cards in the default section order', () => {
    const layout = normalizeDashboardLayoutPreference(null);
    expect(layout.sections.map((section) => section.id)).toEqual(['summary', 'analysis', 'recent']);
    expect(layout.sections.flatMap((section) => section.cards.map((card) => card.id))).toEqual([
      'invoice-balance',
      'pending-receipts',
      'waiting-swift',
      'pending-approvals',
      'released-unpaid-invoices',
      'customer-outstanding-ranking',
      'recent-receipts',
      'recent-payment-details',
    ]);
  });

  it('appends future missing cards from the registry into their default section', () => {
    const layout = normalizeDashboardLayoutPreference({
      sections: [
        { id: 'summary', visible: true, cards: [{ id: 'invoice-balance', visible: true }] },
      ],
    });
    expect(layout.sections.find((section) => section.id === 'summary')?.cards.map((card) => card.id)).toEqual([
      'invoice-balance',
      'pending-receipts',
      'waiting-swift',
      'pending-approvals',
    ]);
  });

  it('drops unknown section and card ids during normalization', () => {
    const layout = normalizeDashboardLayoutPreference({
      sections: [
        { id: 'unknown-section', visible: true, cards: [{ id: 'invoice-balance', visible: true }] },
        { id: 'summary', visible: true, cards: [{ id: 'unknown-card', visible: true }, { id: 'invoice-balance', visible: false }] },
      ],
    });
    expect(layout.sections.map((section) => section.id)).toEqual(['summary', 'analysis', 'recent']);
    expect(layout.sections[0].cards[0]).toEqual({ id: 'invoice-balance', visible: false });
  });

  it('rejects invalid saved layouts before writing to the database', () => {
    expect(() => validateDashboardLayoutPreferenceForSave({
      sections: [{ id: 'summary', visible: true, cards: [{ id: 'released-unpaid-invoices', visible: true }] }],
    })).toThrow('Dashboard card does not belong to this section');
  });

  it('hides and restores a card at the end of its owning section', () => {
    const hidden = hideDashboardCard(DEFAULT_DASHBOARD_LAYOUT, 'pending-receipts');
    expect(hidden.sections[0].cards.find((card) => card.id === 'pending-receipts')?.visible).toBe(false);
    const moved = moveDashboardCard(hidden, 'summary', 'pending-receipts', 'down');
    const restored = restoreDashboardCard(moved, 'pending-receipts');
    expect(restored.sections[0].cards.at(-1)).toEqual({ id: 'pending-receipts', visible: true });
  });

  it('moves sections and cards by one position while staying inside bounds', () => {
    expect(moveDashboardSection(DEFAULT_DASHBOARD_LAYOUT, 'analysis', 'up').sections.map((section) => section.id)).toEqual(['analysis', 'summary', 'recent']);
    expect(moveDashboardCard(DEFAULT_DASHBOARD_LAYOUT, 'summary', 'waiting-swift', 'up').sections[0].cards.map((card) => card.id)).toEqual([
      'invoice-balance',
      'waiting-swift',
      'pending-receipts',
      'pending-approvals',
    ]);
  });

  it('keeps every registered card in exactly one normalized location', () => {
    const layout = normalizeDashboardLayoutPreference({
      sections: [
        { id: 'summary', visible: true, cards: [{ id: 'invoice-balance', visible: true }, { id: 'invoice-balance', visible: false }] },
        { id: 'analysis', visible: true, cards: [{ id: 'released-unpaid-invoices', visible: true }] },
        { id: 'recent', visible: true, cards: [] },
      ],
    });
    const ids = layout.sections.flatMap((section) => section.cards.map((card) => card.id));
    expect(new Set(ids).size).toBe(DASHBOARD_CARD_REGISTRY.length);
    expect(ids.length).toBe(DASHBOARD_CARD_REGISTRY.length);
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
npm test -- --runInBand src/lib/dashboard-layout-preference.test.ts
```

Expected: FAIL because `src/lib/dashboard-layout-preference.ts` does not exist.

- [ ] **Step 3: Implement the registry and normalizer**

Create `src/lib/dashboard-layout-preference.ts` with these exports and behavior:

```ts
export const DASHBOARD_SECTION_REGISTRY = [
  { id: 'summary', defaultOrder: 10, zh: '摘要卡片', en: 'Summary Cards' },
  { id: 'analysis', defaultOrder: 20, zh: '分析卡片', en: 'Analysis Cards' },
  { id: 'recent', defaultOrder: 30, zh: '最近记录', en: 'Recent Activity' },
] as const;

export const DASHBOARD_CARD_REGISTRY = [
  { id: 'invoice-balance', sectionId: 'summary', defaultOrder: 10, zh: '账单余额', en: 'Invoice Balance' },
  { id: 'pending-receipts', sectionId: 'summary', defaultOrder: 20, zh: '待处理收据', en: 'Pending Receipts' },
  { id: 'waiting-swift', sectionId: 'summary', defaultOrder: 30, zh: '等待 SWIFT', en: 'Waiting SWIFT' },
  { id: 'pending-approvals', sectionId: 'summary', defaultOrder: 40, zh: '待审批', en: 'Pending Approvals' },
  { id: 'released-unpaid-invoices', sectionId: 'analysis', defaultOrder: 10, zh: '已放单未结清发票', en: 'Released Unpaid Invoices' },
  { id: 'customer-outstanding-ranking', sectionId: 'analysis', defaultOrder: 20, zh: '客户欠款排行', en: 'Customer Outstanding Ranking' },
  { id: 'recent-receipts', sectionId: 'recent', defaultOrder: 10, zh: '最近收据', en: 'Recent Receipts' },
  { id: 'recent-payment-details', sectionId: 'recent', defaultOrder: 20, zh: '最近付款明细', en: 'Recent Payment Details' },
] as const;

export type DashboardSectionId = typeof DASHBOARD_SECTION_REGISTRY[number]['id'];
export type DashboardCardId = typeof DASHBOARD_CARD_REGISTRY[number]['id'];
export type DashboardLayoutCardPreference = { id: DashboardCardId; visible: boolean };
export type DashboardLayoutSectionPreference = { id: DashboardSectionId; visible: boolean; cards: DashboardLayoutCardPreference[] };
export type DashboardLayoutPreference = { sections: DashboardLayoutSectionPreference[] };
export type DashboardMoveDirection = 'up' | 'down';

const sectionIds = new Set<string>(DASHBOARD_SECTION_REGISTRY.map((section) => section.id));
const cardIds = new Set<string>(DASHBOARD_CARD_REGISTRY.map((card) => card.id));
const cardSection = new Map<string, DashboardSectionId>(DASHBOARD_CARD_REGISTRY.map((card) => [card.id, card.sectionId]));

function cloneLayout(layout: DashboardLayoutPreference): DashboardLayoutPreference {
  return { sections: layout.sections.map((section) => ({ ...section, cards: section.cards.map((card) => ({ ...card })) })) };
}

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayoutPreference = Object.freeze({
  sections: DASHBOARD_SECTION_REGISTRY
    .slice()
    .sort((a, b) => a.defaultOrder - b.defaultOrder)
    .map((section) => ({
      id: section.id,
      visible: true,
      cards: DASHBOARD_CARD_REGISTRY
        .filter((card) => card.sectionId === section.id)
        .slice()
        .sort((a, b) => a.defaultOrder - b.defaultOrder)
        .map((card) => ({ id: card.id, visible: true })),
    })),
} as DashboardLayoutPreference);

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function normalizeDashboardLayoutPreference(value: unknown): DashboardLayoutPreference {
  const source = readObject(value);
  const rawSections = Array.isArray(source?.sections) ? source.sections : [];
  const usedSections = new Set<string>();
  const usedCards = new Set<string>();
  const normalizedSections: DashboardLayoutSectionPreference[] = [];

  for (const rawSection of rawSections) {
    const section = readObject(rawSection);
    const sectionId = String(section?.id || '') as DashboardSectionId;
    if (!sectionIds.has(sectionId) || usedSections.has(sectionId)) continue;
    usedSections.add(sectionId);
    const cards: DashboardLayoutCardPreference[] = [];
    const rawCards = Array.isArray(section?.cards) ? section.cards : [];
    for (const rawCard of rawCards) {
      const card = readObject(rawCard);
      const cardId = String(card?.id || '') as DashboardCardId;
      if (!cardIds.has(cardId) || usedCards.has(cardId)) continue;
      if (cardSection.get(cardId) !== sectionId) continue;
      usedCards.add(cardId);
      cards.push({ id: cardId, visible: typeof card?.visible === 'boolean' ? card.visible : true });
    }
    normalizedSections.push({ id: sectionId, visible: typeof section?.visible === 'boolean' ? section.visible : true, cards });
  }

  for (const defaultSection of DEFAULT_DASHBOARD_LAYOUT.sections) {
    let section = normalizedSections.find((item) => item.id === defaultSection.id);
    if (!section) {
      section = { id: defaultSection.id, visible: true, cards: [] };
      normalizedSections.push(section);
    }
    for (const defaultCard of defaultSection.cards) {
      if (usedCards.has(defaultCard.id)) continue;
      usedCards.add(defaultCard.id);
      section.cards.push({ id: defaultCard.id, visible: true });
    }
  }

  return { sections: normalizedSections };
}

export function validateDashboardLayoutPreferenceForSave(value: unknown): DashboardLayoutPreference {
  const source = readObject(value);
  if (!source || !Array.isArray(source.sections)) {
    throw new Error('Dashboard layout must include sections');
  }
  for (const rawSection of source.sections) {
    const section = readObject(rawSection);
    const sectionId = String(section?.id || '');
    if (!sectionIds.has(sectionId)) throw new Error('Unknown dashboard section');
    if (!Array.isArray(section?.cards)) throw new Error('Dashboard section must include cards');
    for (const rawCard of section.cards) {
      const card = readObject(rawCard);
      const cardId = String(card?.id || '');
      if (!cardIds.has(cardId)) throw new Error('Unknown dashboard card');
      if (cardSection.get(cardId) !== sectionId) throw new Error('Dashboard card does not belong to this section');
      if (typeof card?.visible !== 'boolean') throw new Error('Dashboard card visibility must be boolean');
    }
  }
  return normalizeDashboardLayoutPreference(value);
}

function moveIndex<T>(items: T[], index: number, direction: DashboardMoveDirection): T[] {
  const nextIndex = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return items;
  const next = items.slice();
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

export function moveDashboardSection(layout: DashboardLayoutPreference, sectionId: DashboardSectionId, direction: DashboardMoveDirection): DashboardLayoutPreference {
  const next = cloneLayout(normalizeDashboardLayoutPreference(layout));
  next.sections = moveIndex(next.sections, next.sections.findIndex((section) => section.id === sectionId), direction);
  return next;
}

export function moveDashboardCard(layout: DashboardLayoutPreference, sectionId: DashboardSectionId, cardId: DashboardCardId, direction: DashboardMoveDirection): DashboardLayoutPreference {
  const next = cloneLayout(normalizeDashboardLayoutPreference(layout));
  const section = next.sections.find((item) => item.id === sectionId);
  if (section) section.cards = moveIndex(section.cards, section.cards.findIndex((card) => card.id === cardId), direction);
  return next;
}

export function hideDashboardCard(layout: DashboardLayoutPreference, cardId: DashboardCardId): DashboardLayoutPreference {
  const next = cloneLayout(normalizeDashboardLayoutPreference(layout));
  for (const section of next.sections) {
    section.cards = section.cards.map((card) => card.id === cardId ? { ...card, visible: false } : card);
  }
  return next;
}

export function restoreDashboardCard(layout: DashboardLayoutPreference, cardId: DashboardCardId): DashboardLayoutPreference {
  const next = cloneLayout(normalizeDashboardLayoutPreference(layout));
  const sectionId = cardSection.get(cardId);
  if (!sectionId) return next;
  const section = next.sections.find((item) => item.id === sectionId);
  if (!section) return next;
  section.cards = section.cards.filter((card) => card.id !== cardId);
  section.cards.push({ id: cardId, visible: true });
  return next;
}
```

- [ ] **Step 4: Run the pure tests**

Run:

```bash
npm test -- --runInBand src/lib/dashboard-layout-preference.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit registry and normalizer**

```bash
git add src/lib/dashboard-layout-preference.ts src/lib/dashboard-layout-preference.test.ts
git commit -m "feat: add dashboard layout preference model"
```

---

### Task 3: Backend User Preference Service And API

**Files:**
- Modify: `src/lib/user-preference-service.ts`
- Modify: `src/lib/settings-read-service.ts`
- Modify: `src/lib/settings-write-service.ts`
- Modify: `src/app/api/settings/route.ts`
- Modify: `src/lib/settings-service.test.ts`
- Modify: `src/app/api/settings/route.test.ts`

- [ ] **Step 1: Add service tests for full user preferences**

In `src/lib/settings-service.test.ts`, add tests near the existing user preference tests:

```ts
it('returns default dashboard layout with image preferences for the current user', async () => {
  mockDb.userPreference.findUnique.mockResolvedValueOnce(null);

  const result = await getCurrentUserPreferences(makeUser({ id: 'user-without-dashboard-preference' }));

  expect(result.imageCompressionEnabled).toBe(true);
  expect(result.dashboardLayout.sections.map((section) => section.id)).toEqual(['summary', 'analysis', 'recent']);
  expect(result.dashboardLayout.sections[0].cards.map((card) => card.id)).toContain('invoice-balance');
});

it('updates dashboard layout without resetting image compression preferences', async () => {
  mockDb.userPreference.findUnique.mockResolvedValueOnce({
    userId: 'user-with-dashboard-preference',
    imageCompressionEnabled: false,
    imageCompressionQualityFloor: '0.75',
    ocrTargetMaxKb: 800,
    dashboardLayout: null,
  });
  mockDb.userPreference.upsert.mockResolvedValueOnce({
    userId: 'user-with-dashboard-preference',
    imageCompressionEnabled: false,
    imageCompressionQualityFloor: '0.75',
    ocrTargetMaxKb: 800,
    dashboardLayout: {
      sections: [{ id: 'summary', visible: true, cards: [{ id: 'invoice-balance', visible: false }] }],
    },
  });

  const result = await updateCurrentUserPreferences(makeUser({ id: 'user-with-dashboard-preference' }), {
    dashboardLayout: {
      sections: [{ id: 'summary', visible: true, cards: [{ id: 'invoice-balance', visible: false }] }],
    },
  });

  expect(result.preferences.imageCompressionEnabled).toBe(false);
  expect(result.preferences.imageCompressionQualityFloor).toBe(0.75);
  expect(result.preferences.dashboardLayout.sections[0].cards[0]).toEqual({ id: 'invoice-balance', visible: false });
  expect(mockDb.userPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { userId: 'user-with-dashboard-preference' },
    update: expect.objectContaining({ dashboardLayout: expect.any(Object) }),
  }));
});

it('rejects dashboard layouts that move a card into the wrong section', async () => {
  mockDb.userPreference.findUnique.mockResolvedValueOnce(null);

  await expect(updateCurrentUserPreferences(makeUser(), {
    dashboardLayout: {
      sections: [{ id: 'summary', visible: true, cards: [{ id: 'released-unpaid-invoices', visible: true }] }],
    },
  })).rejects.toMatchObject({
    status: 400,
    code: 'BAD_REQUEST',
  });
});
```

Update imports in the test file from `getCurrentUserImageCompressionPreferences` / `updateCurrentUserImageCompressionPreferences` to include `getCurrentUserPreferences` / `updateCurrentUserPreferences` after those functions are added.

- [ ] **Step 2: Run service tests to verify they fail**

Run:

```bash
npm test -- --runInBand src/lib/settings-service.test.ts
```

Expected: FAIL because the new service functions do not exist.

- [ ] **Step 3: Extend `src/lib/user-preference-service.ts` types and row normalization**

Add imports:

```ts
import { Prisma } from '@prisma/client';
import {
  normalizeDashboardLayoutPreference,
  validateDashboardLayoutPreferenceForSave,
  type DashboardLayoutPreference,
} from '@/lib/dashboard-layout-preference';
```

Replace `UserImageCompressionPreference` with a full preference type while keeping the old type name exported for compatibility:

```ts
export type UserImageCompressionPreference = {
  imageCompressionEnabled: boolean;
  imageCompressionQualityFloor: number;
  ocrTargetMaxKb: number;
};

export type UserPreferenceSettings = UserImageCompressionPreference & {
  dashboardLayout: DashboardLayoutPreference;
};
```

Update `normalizePreferenceRow` to return `UserPreferenceSettings`:

```ts
function normalizePreferenceRow(row: {
  imageCompressionEnabled: boolean;
  imageCompressionQualityFloor: unknown;
  ocrTargetMaxKb: number;
  dashboardLayout?: Prisma.JsonValue | null;
}): UserPreferenceSettings {
  return {
    imageCompressionEnabled: row.imageCompressionEnabled,
    imageCompressionQualityFloor: Number(row.imageCompressionQualityFloor),
    ocrTargetMaxKb: row.ocrTargetMaxKb,
    dashboardLayout: normalizeDashboardLayoutPreference(row.dashboardLayout ?? null),
  };
}
```

Add a full default constant:

```ts
export const DEFAULT_USER_PREFERENCE_SETTINGS: UserPreferenceSettings = Object.freeze({
  ...DEFAULT_USER_IMAGE_COMPRESSION_PREFERENCE,
  dashboardLayout: normalizeDashboardLayoutPreference(null),
});
```

- [ ] **Step 4: Add full read/update service functions**

In `src/lib/user-preference-service.ts`, add these functions and keep the existing image-only functions as wrappers:

```ts
export async function getUserPreferences(currentUser: CurrentUser): Promise<UserPreferenceSettings> {
  const preference = await db.userPreference.findUnique({
    where: { userId: currentUser.id },
  });
  if (!preference) return DEFAULT_USER_PREFERENCE_SETTINGS;
  return normalizePreferenceRow(preference);
}

export async function getUserImageCompressionPreference(currentUser: CurrentUser): Promise<UserImageCompressionPreference> {
  const preference = await getUserPreferences(currentUser);
  return {
    imageCompressionEnabled: preference.imageCompressionEnabled,
    imageCompressionQualityFloor: preference.imageCompressionQualityFloor,
    ocrTargetMaxKb: preference.ocrTargetMaxKb,
  };
}

export async function updateUserPreferences(
  currentUser: CurrentUser,
  input: Partial<UserImageCompressionPreference & { dashboardLayout: unknown }>,
): Promise<UserPreferenceSettings> {
  const currentPreference = await getUserPreferences(currentUser);
  const nextPreference: UserPreferenceSettings = {
    imageCompressionEnabled: Object.prototype.hasOwnProperty.call(input, 'imageCompressionEnabled')
      ? validateImageCompressionEnabled(input.imageCompressionEnabled)
      : currentPreference.imageCompressionEnabled,
    imageCompressionQualityFloor: Object.prototype.hasOwnProperty.call(input, 'imageCompressionQualityFloor')
      ? validateImageCompressionQualityFloor(input.imageCompressionQualityFloor)
      : currentPreference.imageCompressionQualityFloor,
    ocrTargetMaxKb: Object.prototype.hasOwnProperty.call(input, 'ocrTargetMaxKb')
      ? validateOcrTargetMaxKb(input.ocrTargetMaxKb)
      : currentPreference.ocrTargetMaxKb,
    dashboardLayout: Object.prototype.hasOwnProperty.call(input, 'dashboardLayout')
      ? validateDashboardLayoutPreferenceForSave(input.dashboardLayout)
      : currentPreference.dashboardLayout,
  };

  const savedPreference = await db.userPreference.upsert({
    where: { userId: currentUser.id },
    create: {
      userId: currentUser.id,
      imageCompressionEnabled: nextPreference.imageCompressionEnabled,
      imageCompressionQualityFloor: nextPreference.imageCompressionQualityFloor,
      ocrTargetMaxKb: nextPreference.ocrTargetMaxKb,
      dashboardLayout: nextPreference.dashboardLayout as unknown as Prisma.InputJsonValue,
    },
    update: {
      imageCompressionEnabled: nextPreference.imageCompressionEnabled,
      imageCompressionQualityFloor: nextPreference.imageCompressionQualityFloor,
      ocrTargetMaxKb: nextPreference.ocrTargetMaxKb,
      dashboardLayout: nextPreference.dashboardLayout as unknown as Prisma.InputJsonValue,
    },
  });

  return normalizePreferenceRow(savedPreference);
}

export async function updateUserImageCompressionPreference(
  currentUser: CurrentUser,
  input: UpdateUserImageCompressionPreferenceInput,
): Promise<UserImageCompressionPreference> {
  const preference = await updateUserPreferences(currentUser, input);
  return {
    imageCompressionEnabled: preference.imageCompressionEnabled,
    imageCompressionQualityFloor: preference.imageCompressionQualityFloor,
    ocrTargetMaxKb: preference.ocrTargetMaxKb,
  };
}
```

- [ ] **Step 5: Update settings read/write services**

In `src/lib/settings-read-service.ts`, import and export full preferences:

```ts
import {
  getUserImageCompressionPreference,
  getUserPreferences,
  type UserImageCompressionPreference,
  type UserPreferenceSettings,
} from '@/lib/user-preference-service';

export async function getCurrentUserPreferences(currentUser: CurrentUser): Promise<UserPreferenceSettings> {
  return getUserPreferences(currentUser);
}
```

Keep `getCurrentUserImageCompressionPreferences` for existing callers.

In `src/lib/settings-write-service.ts`, import full update service and add:

```ts
export async function updateCurrentUserPreferences(
  currentUser: CurrentUser,
  payload: unknown,
): Promise<{
  message: string;
  preferences: UserPreferenceSettings;
}> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createApiError({ code: 'BAD_REQUEST', status: 400, message: '用户偏好格式错误', detail: { payload } });
  }
  try {
    const preferences = await updateUserPreferences(currentUser, payload as Partial<UserPreferenceSettings>);
    return { message: '用户偏好已更新', preferences };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Dashboard')) {
      throw createApiError({ code: 'BAD_REQUEST', status: 400, message: error.message });
    }
    throw error;
  }
}
```

Keep `updateCurrentUserImageCompressionPreferences` as a wrapper if existing tests or components still import it.

- [ ] **Step 6: Update settings API route**

In `src/app/api/settings/route.ts`:

- Replace `getCurrentUserImageCompressionPreferences` with `getCurrentUserPreferences` for `view=user-preferences`.
- Replace `updateCurrentUserImageCompressionPreferences` with `updateCurrentUserPreferences` for `action === 'update-user-preferences'`.

The route response shape must remain:

```ts
return createApiSuccessResponse({
  message: result.message,
  data: result.preferences,
}, request);
```

- [ ] **Step 7: Update API route tests**

In `src/app/api/settings/route.test.ts`, extend mocks and expectations so `GET /api/settings?view=user-preferences` returns:

```ts
{
  imageCompressionEnabled: true,
  imageCompressionQualityFloor: 0.3,
  ocrTargetMaxKb: 500,
  dashboardLayout: expect.objectContaining({ sections: expect.any(Array) }),
}
```

Add one POST test with a body containing only `dashboardLayout`, and assert the route calls `updateCurrentUserPreferences` with the full payload object.

- [ ] **Step 8: Run backend/API tests**

Run:

```bash
npm test -- --runInBand src/lib/dashboard-layout-preference.test.ts src/lib/settings-service.test.ts src/app/api/settings/route.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit backend preference API**

```bash
git add src/lib/user-preference-service.ts src/lib/settings-read-service.ts src/lib/settings-write-service.ts src/app/api/settings/route.ts src/lib/settings-service.test.ts src/app/api/settings/route.test.ts
git commit -m "feat: expose dashboard layout preferences"
```

---

### Task 4: Settings UI For Dashboard Layout

**Files:**
- Modify: `src/components/workspace/modules/settings/types.ts`
- Modify: `src/components/workspace/modules/settings/hooks/use-settings-forms.ts`
- Modify: `src/components/workspace/modules/settings/hooks/use-settings-actions.ts`
- Create: `src/components/workspace/modules/settings/components/dashboard-settings-card.tsx`
- Create: `src/components/workspace/modules/settings/components/dashboard-settings-card.test.tsx`
- Modify: `src/components/workspace/modules/settings/components/index.ts`
- Modify: `src/components/workspace/modules/settings/settings-manager.tsx`
- Modify: `src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`

- [ ] **Step 1: Write Dashboard settings card component tests**

Create `src/components/workspace/modules/settings/components/dashboard-settings-card.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardSettingsCard } from './dashboard-settings-card';
import { DEFAULT_DASHBOARD_LAYOUT } from '@/lib/dashboard-layout-preference';

const tx = (zh: string, en: string) => en;

describe('DashboardSettingsCard', () => {
  it('renders sections, cards, and visibility switches', () => {
    render(
      <DashboardSettingsCard
        loading={false}
        saving={false}
        layout={DEFAULT_DASHBOARD_LAYOUT}
        tx={tx}
        onLayoutChange={jest.fn()}
        onSavePreferences={jest.fn()}
      />,
    );
    expect(screen.getByText('Summary Cards')).toBeInTheDocument();
    expect(screen.getByText('Invoice Balance')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Invoice Balance' })).toBeChecked();
  });

  it('moves a card down and saves the changed layout', async () => {
    const user = userEvent.setup();
    const onLayoutChange = jest.fn();
    render(
      <DashboardSettingsCard
        loading={false}
        saving={false}
        layout={DEFAULT_DASHBOARD_LAYOUT}
        tx={tx}
        onLayoutChange={onLayoutChange}
        onSavePreferences={jest.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Move Invoice Balance down' }));
    expect(onLayoutChange).toHaveBeenCalledWith(expect.objectContaining({ sections: expect.any(Array) }));
  });

  it('toggles card visibility without removing it from settings', async () => {
    const user = userEvent.setup();
    const onLayoutChange = jest.fn();
    render(
      <DashboardSettingsCard
        loading={false}
        saving={false}
        layout={DEFAULT_DASHBOARD_LAYOUT}
        tx={tx}
        onLayoutChange={onLayoutChange}
        onSavePreferences={jest.fn()}
      />,
    );
    await user.click(screen.getByRole('switch', { name: 'Invoice Balance' }));
    const nextLayout = onLayoutChange.mock.calls.at(-1)?.[0];
    expect(nextLayout.sections[0].cards.find((card: { id: string }) => card.id === 'invoice-balance').visible).toBe(false);
  });
});
```

- [ ] **Step 2: Run the component test to verify it fails**

Run:

```bash
npm test -- --runInBand src/components/workspace/modules/settings/components/dashboard-settings-card.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Extend Settings types**

In `src/components/workspace/modules/settings/types.ts`, import Dashboard types and add:

```ts
import type { DashboardLayoutPreference } from '@/lib/dashboard-layout-preference';

export type UserPreferenceSettings = UserImageCompressionPreference & {
  dashboardLayout: DashboardLayoutPreference;
};

export type UserPreferenceSettingsDraft = UserImageCompressionPreferenceDraft & {
  dashboardLayout: DashboardLayoutPreference;
};
```

Replace state type usages of `UserImageCompressionPreferenceDraft` with `UserPreferenceSettingsDraft` in the next steps.

- [ ] **Step 4: Update Settings forms state**

In `src/components/workspace/modules/settings/hooks/use-settings-forms.ts`, initialize `userPreferences` with the default Dashboard layout:

```ts
import { DEFAULT_DASHBOARD_LAYOUT, type DashboardLayoutPreference } from '@/lib/dashboard-layout-preference';
import type { UserPreferenceSettingsDraft } from '../types';

const defaultUserPreferenceSettingsDraft: UserPreferenceSettingsDraft = {
  ...defaultUserImageCompressionPreferenceDraft,
  dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
};
```

Change state:

```ts
const [userPreferences, setUserPreferences] = useState<UserPreferenceSettingsDraft>(defaultUserPreferenceSettingsDraft);
```

Add an updater:

```ts
const updateDashboardLayoutPreference = (dashboardLayout: DashboardLayoutPreference) => {
  setUserPreferences((prev) => ({ ...prev, dashboardLayout }));
};
```

Return `updateDashboardLayoutPreference` from the hook.

- [ ] **Step 5: Update Settings actions normalization and validation**

In `src/components/workspace/modules/settings/hooks/use-settings-actions.ts`, import:

```ts
import {
  normalizeDashboardLayoutPreference,
  validateDashboardLayoutPreferenceForSave,
} from '@/lib/dashboard-layout-preference';
import type { UserPreferenceSettings, UserPreferenceSettingsDraft } from '../types';
```

Update `SettingsActionDeps.userPreferences` and `setUserPreferences` to use `UserPreferenceSettingsDraft`.

Update `normalizeUserPreferences` to include:

```ts
dashboardLayout: normalizeDashboardLayoutPreference((source as Partial<UserPreferenceSettings>).dashboardLayout),
```

Update `validateUserPreferences` to return `UserPreferenceSettings` and include:

```ts
let dashboardLayout;
try {
  dashboardLayout = validateDashboardLayoutPreferenceForSave(preferences.dashboardLayout);
} catch {
  return { ok: false, error: tx('Dashboard 设置格式错误', 'Dashboard settings are invalid') };
}

return {
  ok: true,
  value: {
    imageCompressionEnabled: preferences.imageCompressionEnabled,
    imageCompressionQualityFloor: Number(qualityFloor.toFixed(2)),
    ocrTargetMaxKb,
    dashboardLayout,
  },
};
```

Keep the existing image compression validation unchanged.

- [ ] **Step 6: Create `DashboardSettingsCard`**

Create `src/components/workspace/modules/settings/components/dashboard-settings-card.tsx` with a focused UI using existing components:

```tsx
'use client';

import { ArrowDown, ArrowUp, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  DASHBOARD_CARD_REGISTRY,
  DASHBOARD_SECTION_REGISTRY,
  moveDashboardCard,
  moveDashboardSection,
  normalizeDashboardLayoutPreference,
  type DashboardCardId,
  type DashboardLayoutPreference,
  type DashboardSectionId,
} from '@/lib/dashboard-layout-preference';

export type DashboardSettingsCardProps = {
  loading: boolean;
  saving: boolean;
  layout: DashboardLayoutPreference;
  tx: (zh: string, en: string) => string;
  onLayoutChange: (layout: DashboardLayoutPreference) => void;
  onSavePreferences: () => void;
};

function labelForSection(id: DashboardSectionId, tx: DashboardSettingsCardProps['tx']): string {
  const section = DASHBOARD_SECTION_REGISTRY.find((item) => item.id === id);
  return section ? tx(section.zh, section.en) : id;
}

function labelForCard(id: DashboardCardId, tx: DashboardSettingsCardProps['tx']): string {
  const card = DASHBOARD_CARD_REGISTRY.find((item) => item.id === id);
  return card ? tx(card.zh, card.en) : id;
}

export function DashboardSettingsCard({ loading, saving, layout, tx, onLayoutChange, onSavePreferences }: DashboardSettingsCardProps) {
  const disabled = loading || saving;
  const normalizedLayout = normalizeDashboardLayoutPreference(layout);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx('Dashboard 设置', 'Dashboard Settings')}</CardTitle>
        <CardDescription>{tx('调整当前账号 Dashboard 卡片的显示、隐藏和顺序。', 'Control Dashboard card visibility and order for your account only.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {normalizedLayout.sections.map((section, sectionIndex) => (
          <div key={section.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
              <h3 className="font-semibold">{labelForSection(section.id, tx)}</h3>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={disabled || sectionIndex === 0} aria-label={`Move ${labelForSection(section.id, tx)} up`} onClick={() => onLayoutChange(moveDashboardSection(normalizedLayout, section.id, 'up'))}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={disabled || sectionIndex === normalizedLayout.sections.length - 1} aria-label={`Move ${labelForSection(section.id, tx)} down`} onClick={() => onLayoutChange(moveDashboardSection(normalizedLayout, section.id, 'down'))}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {section.cards.map((card, cardIndex) => {
                const label = labelForCard(card.id, tx);
                return (
                  <div key={card.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/30 p-3">
                    <div className="flex items-center gap-3">
                      <Switch checked={card.visible} disabled={disabled} aria-label={label} onCheckedChange={(checked) => onLayoutChange({
                        sections: normalizedLayout.sections.map((row) => row.id === section.id ? {
                          ...row,
                          cards: row.cards.map((item) => item.id === card.id ? { ...item, visible: checked } : item),
                        } : row),
                      })} />
                      <Label>{label}</Label>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={disabled || cardIndex === 0} aria-label={`Move ${label} up`} onClick={() => onLayoutChange(moveDashboardCard(normalizedLayout, section.id, card.id, 'up'))}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="outline" size="sm" disabled={disabled || cardIndex === section.cards.length - 1} aria-label={`Move ${label} down`} onClick={() => onLayoutChange(moveDashboardCard(normalizedLayout, section.id, card.id, 'down'))}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex justify-end">
          <Button onClick={onSavePreferences} disabled={disabled}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4" />
            {tx('保存个人偏好', 'Save Personal Preferences')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: Export and mount Dashboard Settings**

In `src/components/workspace/modules/settings/components/index.ts`, add:

```ts
export * from './dashboard-settings-card';
```

In `src/components/workspace/modules/settings/settings-manager.tsx`, import `DashboardSettingsCard` and add this collapsible section after image compression:

```tsx
<CollapsibleSettingsSection title={tx('Dashboard 设置', 'Dashboard Settings')}>
  <DashboardSettingsCard
    loading={userPreferencesLoading}
    saving={savingUserPreferences}
    layout={userPreferences.dashboardLayout}
    tx={tx}
    onLayoutChange={updateDashboardLayoutPreference}
    onSavePreferences={handleSaveUserPreferences}
  />
</CollapsibleSettingsSection>
```

Also destructure `updateDashboardLayoutPreference` from `useSettingsForms()`.

- [ ] **Step 8: Update existing user preference mocks**

In `src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`, any mock response for `apiCall('settings?view=user-preferences')` should include a Dashboard layout:

```ts
{
  imageCompressionEnabled: true,
  imageCompressionQualityFloor: 0.3,
  ocrTargetMaxKb: 500,
  dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
}
```

Import `DEFAULT_DASHBOARD_LAYOUT` where needed.

- [ ] **Step 9: Run Settings frontend tests**

Run:

```bash
npm test -- --runInBand \
  src/components/workspace/modules/settings/components/dashboard-settings-card.test.tsx \
  src/components/workspace/modules/settings/hooks/use-settings-forms.test.tsx \
  src/components/workspace/modules/settings/hooks/use-settings-actions.test.tsx \
  src/components/workspace/modules/settings/settings-manager.test.tsx \
  src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit Settings UI**

```bash
git add src/components/workspace/modules/settings src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx
git commit -m "feat: add dashboard layout settings UI"
```

---

### Task 5: Dashboard Rendering From Preferences And Hide Button

**Files:**
- Modify: `src/components/workspace/modules/dashboard/dashboard-view.tsx`
- Modify: `src/components/workspace/modules/dashboard/dashboard-view.test.tsx`

- [ ] **Step 1: Add Dashboard behavior tests first**

In `src/components/workspace/modules/dashboard/dashboard-view.test.tsx`, add tests:

```tsx
it('does not render hidden dashboard cards or empty sections', async () => {
  mockApiCall.mockImplementation(async (endpoint: string) => {
    if (endpoint === 'dashboard?action=summary') return { success: true, data: buildDashboardSummary() };
    if (endpoint === 'settings?view=user-preferences') return {
      success: true,
      data: {
        imageCompressionEnabled: true,
        imageCompressionQualityFloor: 0.3,
        ocrTargetMaxKb: 500,
        dashboardLayout: {
          sections: [
            { id: 'summary', visible: true, cards: [
              { id: 'invoice-balance', visible: false },
              { id: 'pending-receipts', visible: false },
              { id: 'waiting-swift', visible: false },
              { id: 'pending-approvals', visible: false },
            ] },
            { id: 'analysis', visible: true, cards: [
              { id: 'released-unpaid-invoices', visible: true },
              { id: 'customer-outstanding-ranking', visible: false },
            ] },
            { id: 'recent', visible: true, cards: [
              { id: 'recent-receipts', visible: false },
              { id: 'recent-payment-details', visible: false },
            ] },
          ],
        },
      },
    };
    return { success: false };
  });

  render(<Dashboard />);

  expect(await screen.findByText('Released Unpaid Invoices')).toBeInTheDocument();
  expect(screen.queryByText(/Invoice Balance/)).not.toBeInTheDocument();
  expect(screen.queryByText('Customer Outstanding Ranking')).not.toBeInTheDocument();
  expect(screen.queryByText('Recent Receipts')).not.toBeInTheDocument();
});

it('confirms before hiding a card and saves the changed account preference', async () => {
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  mockApiCall.mockImplementation(async (endpoint: string, options?: RequestInit) => {
    if (endpoint === 'dashboard?action=summary') return { success: true, data: buildDashboardSummary() };
    if (endpoint === 'settings?view=user-preferences') return {
      success: true,
      data: {
        imageCompressionEnabled: true,
        imageCompressionQualityFloor: 0.3,
        ocrTargetMaxKb: 500,
        dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
      },
    };
    if (endpoint === 'settings' && options?.method === 'POST') return {
      success: true,
      data: {
        imageCompressionEnabled: true,
        imageCompressionQualityFloor: 0.3,
        ocrTargetMaxKb: 500,
        dashboardLayout: hideDashboardCard(DEFAULT_DASHBOARD_LAYOUT, 'invoice-balance'),
      },
    };
    return { success: false };
  });

  const user = userEvent.setup();
  render(<Dashboard />);
  await user.click(await screen.findByRole('button', { name: 'Hide Invoice Balance' }));

  expect(confirmSpy).toHaveBeenCalledWith('Hide this card? You can restore it in Settings.');
  expect(mockApiCall).toHaveBeenCalledWith('settings', expect.objectContaining({
    method: 'POST',
    body: expect.stringContaining('dashboardLayout'),
  }));
  confirmSpy.mockRestore();
});
```

Ensure the test imports:

```ts
import userEvent from '@testing-library/user-event';
import { DEFAULT_DASHBOARD_LAYOUT, hideDashboardCard } from '@/lib/dashboard-layout-preference';
```

Use existing test helpers in the file for `mockApiCall` and `buildDashboardSummary`; if helper names differ, align the test with current helpers while preserving the same assertions.

- [ ] **Step 2: Run Dashboard tests to verify they fail**

Run:

```bash
npm test -- --runInBand src/components/workspace/modules/dashboard/dashboard-view.test.tsx
```

Expected: FAIL because Dashboard does not load or apply user preferences yet.

- [ ] **Step 3: Add Dashboard preference loading state**

In `src/components/workspace/modules/dashboard/dashboard-view.tsx`, import:

```ts
import { X } from 'lucide-react';
import {
  DASHBOARD_CARD_REGISTRY,
  hideDashboardCard,
  normalizeDashboardLayoutPreference,
  type DashboardCardId,
  type DashboardLayoutPreference,
  type DashboardSectionId,
} from '@/lib/dashboard-layout-preference';
import { getApiErrorMessage } from '@/components/workspace/shared';
```

Add state:

```ts
const [dashboardLayout, setDashboardLayout] = useState<DashboardLayoutPreference>(() => normalizeDashboardLayoutPreference(null));
```

Add loader inside `Dashboard`:

```ts
const loadDashboardPreferences = useCallback(async () => {
  const result = await apiCall('settings?view=user-preferences');
  if (result.success && result.data) {
    setDashboardLayout(normalizeDashboardLayoutPreference((result.data as { dashboardLayout?: unknown }).dashboardLayout));
  }
}, []);

useEffect(() => {
  void loadDashboardPreferences();
}, [loadDashboardPreferences]);
```

- [ ] **Step 4: Add hide-save handler**

Add helper labels and save logic:

```ts
const dashboardCardLabel = useCallback((cardId: DashboardCardId) => {
  const card = DASHBOARD_CARD_REGISTRY.find((item) => item.id === cardId);
  return card ? tx(card.zh, card.en) : cardId;
}, [tx]);

const handleHideDashboardCard = useCallback(async (cardId: DashboardCardId) => {
  const confirmed = window.confirm(tx('是否隐藏此卡片？隐藏后可在设置中恢复。', 'Hide this card? You can restore it in Settings.'));
  if (!confirmed) return;
  const nextLayout = hideDashboardCard(dashboardLayout, cardId);
  try {
    const result = await apiCall('settings', {
      method: 'POST',
      body: JSON.stringify({ action: 'update-user-preferences', preferences: { dashboardLayout: nextLayout } }),
    });
    if (result.success) {
      setDashboardLayout(normalizeDashboardLayoutPreference((result.data as { dashboardLayout?: unknown })?.dashboardLayout ?? nextLayout));
    } else {
      alert(getApiErrorMessage(result, tx('保存 Dashboard 设置失败', 'Failed to save Dashboard settings')));
    }
  } catch (error) {
    alert(getApiErrorMessage(error, tx('保存 Dashboard 设置失败', 'Failed to save Dashboard settings')));
  }
}, [dashboardLayout, tx]);
```

- [ ] **Step 5: Add a reusable card frame**

Inside `dashboard-view.tsx`, add a local helper component above `return` or below imports:

```tsx
function DashboardCardShell({
  cardId,
  label,
  children,
  onHide,
}: {
  cardId: DashboardCardId;
  label: string;
  children: React.ReactNode;
  onHide: (cardId: DashboardCardId) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Hide ${label}`}
        className="absolute right-2 top-2 z-10 rounded-full p-1 text-muted-foreground/50 transition hover:bg-muted hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onHide(cardId)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
      {children}
    </div>
  );
}
```

- [ ] **Step 6: Render cards from visible layout sections**

Replace the current fixed Dashboard layout with render maps that preserve existing card JSX. Use this structure:

```ts
const visibleSections = dashboardLayout.sections
  .map((section) => ({ ...section, cards: section.cards.filter((card) => card.visible) }))
  .filter((section) => section.visible && section.cards.length > 0);

const renderCard = (cardId: DashboardCardId) => {
  const label = dashboardCardLabel(cardId);
  const wrap = (node: React.ReactNode) => (
    <DashboardCardShell key={cardId} cardId={cardId} label={label} onHide={handleHideDashboardCard}>{node}</DashboardCardShell>
  );
  switch (cardId) {
    case 'invoice-balance':
      return wrap(<Card>...</Card>);
    case 'pending-receipts':
      return wrap(<Card>...</Card>);
    case 'waiting-swift':
      return wrap(<Card>...</Card>);
    case 'pending-approvals':
      return wrap(<Card>...</Card>);
    case 'released-unpaid-invoices':
      return wrap(<Card>...</Card>);
    case 'customer-outstanding-ranking':
      return wrap(<Card>...</Card>);
    case 'recent-receipts':
      return wrap(<Card>...</Card>);
    case 'recent-payment-details':
      return wrap(<Card>...</Card>);
    default:
      return null;
  }
};
```

Move the existing JSX for each current card into the corresponding switch case without changing business content.

Then render each section in current preference order:

```tsx
{visibleSections.map((section) => {
  if (section.id === 'summary') {
    return <div key={section.id} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">{section.cards.map((card) => renderCard(card.id))}</div>;
  }
  if (section.id === 'analysis') {
    return <div key={section.id} className="grid grid-cols-1 gap-6 xl:grid-cols-2">{section.cards.map((card) => renderCard(card.id))}</div>;
  }
  if (section.id === 'recent') {
    return <div key={section.id} className="grid grid-cols-1 lg:grid-cols-2 gap-6">{section.cards.map((card) => renderCard(card.id))}</div>;
  }
  return null;
})}
```

This keeps the existing three visual skeletons and allows section ordering.

- [ ] **Step 7: Run Dashboard tests**

Run:

```bash
npm test -- --runInBand src/components/workspace/modules/dashboard/dashboard-view.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Dashboard rendering**

```bash
git add src/components/workspace/modules/dashboard/dashboard-view.tsx src/components/workspace/modules/dashboard/dashboard-view.test.tsx
git commit -m "feat: apply dashboard layout preferences"
```

---

### Task 6: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `todolist.md`
- Modify: `ENGINEERING_LOG.md`

- [ ] **Step 1: Update user-facing README concisely**

In `README.md`, add one concise bullet under the Dashboard or Settings feature area:

```markdown
- Dashboard cards can be hidden, restored, and reordered per account from Settings.
```

Do not add technical migration details to README.

- [ ] **Step 2: Update engineering log**

In `ENGINEERING_LOG.md`, add an entry:

```markdown
## 2026-06-08 Dashboard Layout Preferences

- Added account-scoped Dashboard card visibility and ordering design/implementation.
- Persistence lives in MySQL `UserPreference.dashboardLayout`; backup remains covered by the `trading_ledger` dump.
- Future Dashboard cards must be registered in `src/lib/dashboard-layout-preference.ts` so Settings and Dashboard stay in sync.
```

- [ ] **Step 3: Update `todolist.md` milestone state**

Add or update a short user-readable milestone:

```markdown
- Dashboard personalization: users can hide, restore, and reorder Dashboard cards from Settings.
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- --runInBand \
  src/lib/user-preference-schema.test.ts \
  src/lib/dashboard-layout-preference.test.ts \
  src/lib/settings-service.test.ts \
  src/app/api/settings/route.test.ts \
  src/components/workspace/modules/settings/components/dashboard-settings-card.test.tsx \
  src/components/workspace/modules/settings/hooks/use-settings-forms.test.tsx \
  src/components/workspace/modules/settings/hooks/use-settings-actions.test.tsx \
  src/components/workspace/modules/settings/settings-manager.test.tsx \
  src/components/workspace/modules/dashboard/dashboard-view.test.tsx \
  src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run project quality gates**

Run:

```bash
npm run typecheck
npm run lint
git diff --check
```

Expected: all commands pass with exit code 0.

- [ ] **Step 6: Commit docs and test cleanup**

```bash
git add README.md todolist.md ENGINEERING_LOG.md
git commit -m "docs: document dashboard personalization"
```

- [ ] **Step 7: Push branch**

```bash
git push
```

Expected: push succeeds to the current feature branch.

- [ ] **Step 8: Ask before Docker rebuild**

Because this feature includes a database migration, do not silently rebuild the local Docker service. Report that code/tests/docs are complete and ask whether to run the safe local rebuild script:

```bash
scripts/rebuild-local-app.sh
```

If the user requests rebuild, run the script and report any error with full phase, exit code, relevant logs, and data-risk assessment according to `AGENTS.md`.

---

## Plan Self-Review

Spec coverage:

- Account-scoped persistence is covered by Tasks 1 and 3.
- Current eight cards and future card registry are covered by Task 2.
- Section and card ordering are covered by Tasks 2, 4, and 5.
- Persistent `x` hide button and localized confirmation are covered by Task 5.
- Settings restore/visibility controls and Up/Down ordering are covered by Task 4.
- Empty hidden sections are covered by Task 5 tests.
- Backup documentation is covered by Tasks 1 and 6.
- Automated API/component tests are covered by Tasks 1 through 6.

Type consistency:

- `DashboardLayoutPreference`, `DashboardSectionId`, and `DashboardCardId` are defined once in `src/lib/dashboard-layout-preference.ts` and reused everywhere.
- The backend full preference type is `UserPreferenceSettings`; the old image-only type remains available for compatibility.
- `dashboardLayout` is the Prisma field, API response property, frontend draft property, and request payload property.

Implementation sequence:

- The database field lands before service code that reads it.
- The pure model lands before backend and frontend consumers.
- Settings UI lands before Dashboard hide-save behavior uses the same API shape.
- Docker rebuild is explicitly gated because this feature includes a migration.
