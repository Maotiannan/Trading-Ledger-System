# Dashboard Order Receipt Image Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Dashboard `Order Receipt Search` rows open the existing receipt image preview when the searched receipt has an image.

**Architecture:** Keep search matching unchanged. Extend the dashboard receipt-search service result with existing receipt image metadata, then reuse `ReceiptImagePreviewDialog` in Dashboard instead of creating a second preview UI.

**Tech Stack:** Next.js, React, TypeScript, Jest, Prisma.

## Global Constraints

- No database schema change.
- No new media path, upload path, NAS/COS path, or backup scope change.
- Only rows with `imageUrl` become clickable; rows without images remain normal text.
- Reuse the Receipt Management preview dialog and metadata labels.

---

### Task 1: Search Service Preview Metadata

**Files:**
- Modify: `src/lib/dashboard-receipt-search-service.ts`
- Test: `src/lib/dashboard-receipt-search-service.test.ts`

**Interfaces:**
- Produces: `DashboardReceiptSearchItem` fields `invNo`, `boundInvNo`, `imageUrl`, `imageName`, `creatorName`, `creatorEmail`.
- Consumes: existing ORDER NO matching and receipt query flow.

- [x] **Step 1: Write the failing service test**

Add expectations that a searched receipt includes image URL, image name, bound invoice, and creator metadata.

- [x] **Step 2: Run the service test and verify it fails**

Run: `npm test -- src/lib/dashboard-receipt-search-service.test.ts --runInBand`
Expected: FAIL before production code because selected/mapped fields are missing.

- [x] **Step 3: Add minimal service fields**

Select `invNo`, `imageUrl`, `imageName`, `creator`, and linked order invoice number, then map them into `DashboardReceiptSearchItem`.

- [x] **Step 4: Run the service test and verify it passes**

Run: `npm test -- src/lib/dashboard-receipt-search-service.test.ts --runInBand`
Expected: PASS.

### Task 2: Dashboard Click Preview

**Files:**
- Modify: `src/components/workspace/modules/dashboard/dashboard-view.tsx`
- Test: `src/components/workspace/modules/dashboard/dashboard-view.test.tsx`

**Interfaces:**
- Consumes: `DashboardReceiptSearchItem.imageUrl`, `boundInvNo`, `creatorName`, `creatorEmail`.
- Consumes: `ReceiptImagePreviewDialog` and `ReceiptImagePreviewInfo` from Receipt Management.

- [ ] **Step 1: Write the failing dashboard test**

Mock the receipt image preview dialog. Make one search result include `imageUrl` and one omit it. Assert that clicking the image-backed `ORDER NO` opens the dialog and that the no-image row is not rendered as a button.

- [ ] **Step 2: Run the dashboard test and verify it fails**

Run: `npm test -- src/components/workspace/modules/dashboard/dashboard-view.test.tsx --runInBand`
Expected: FAIL because the ORDER NO cell is not clickable yet.

- [ ] **Step 3: Add minimal Dashboard UI logic**

Add local preview state, render `ORDER NO` as a button only when `imageUrl` exists, and render `ReceiptImagePreviewDialog` with bound ORDER NO, bound invoice, creator, and image URL.

- [ ] **Step 4: Run the dashboard test and verify it passes**

Run: `npm test -- src/components/workspace/modules/dashboard/dashboard-view.test.tsx --runInBand`
Expected: PASS.

### Task 3: Version, Docs, Verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `ENGINEERING_LOG.md`

**Interfaces:**
- Produces: version `1.0.185` and user-facing/engineering release note.

- [ ] **Step 1: Bump version**

Run: `npm version --no-git-tag-version 1.0.185`

- [ ] **Step 2: Update concise docs**

Update README current version/recent update and ENGINEERING_LOG top entry.

- [ ] **Step 3: Run verification**

Run targeted tests, typecheck, lint, full Jest, and build.

- [ ] **Step 4: Commit, push, and watch CI**

Commit logical changes, push to GitHub, and watch the triggered CI run to completion.
