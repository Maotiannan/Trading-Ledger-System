# Sidebar, Receipt Meta Layout, and Customer Company Files Implementation Plan

> **Plan status:** `ARCHIVED_COMPLETED` as of 2026-07-17. The implementation is on `main`; unchecked boxes below are retained as the original execution checklist and are not active backlog. See [the status index](./README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the workspace sidebar fixed, provide a receipt `No/Date/Tél` layout editor, and add customer company-file upload/OCR with append-only file binding and explicit per-field overwrite confirmation.

**Architecture:** Reuse the existing workspace shell, receipt canvas conventions, OCR provider, uploaded asset registry, NAS-backed upload directory, and customer access scope. Customer company files are stored as `UploadedAsset` records with `CUSTOMER_FILE` category/attachment type and attached to the customer id; no separate file table is needed.

**Tech Stack:** Next.js App Router, React, Prisma/MySQL, existing OCR provider in `src/lib/ocr.ts`, existing upload helpers in `src/lib/upload.ts`, Jest/Testing Library.

## Global Constraints

- Do not delete existing business data or Docker volumes.
- New customer files append to the customer; they never overwrite old files.
- Deleting a customer file must delete the database attachment marker and the NAS source file.
- OCR results never silently overwrite existing `COMPANY_NAME`, `COMPANY_ADDRESS`, or `CITY`; non-empty old values require per-field confirmation in one dialog.
- Images/PDF/TXT can be OCR-recognized; Office files are saved and attached but return a clear unsupported-recognition note until a parser dependency is intentionally added.
- Update backup documentation because a new persistent upload category is added.

---

### Task 1: Fixed Workspace Sidebar

**Files:**
- Modify: `src/app/(workspace)/layout.tsx`
- Modify: `src/components/workspace/chrome/sidebar.tsx`

**Interfaces:**
- Produces: a shell where the sidebar is fixed/sticky on the left and only the main content scrolls.

- [ ] Write or update a layout test if an existing workspace layout test exists; otherwise verify by class-level component test for sidebar root.
- [ ] Change workspace shell to `h-dvh min-h-dvh overflow-hidden` and main column to `min-h-0` with `main` using `h-full overflow-auto`.
- [ ] Change sidebar root to `sticky top-0 h-dvh max-h-dvh shrink-0 overflow-hidden` and make the nav area scroll internally.
- [ ] Run targeted tests and typecheck.

### Task 2: Receipt Meta Layout Editor

> Superseded by `tools/receipt-full-meta-layout-editor.html`, which uses the complete generated receipt as a locked background and exports absolute receipt coordinates.

**Files:**
- Create: `tools/receipt-meta-layout-editor.html`
- Modify: `README.md` only if needed to point human operators to the editor.

**Interfaces:**
- Produces: JSON schema `RECEIPT_META_ROW_LAYOUT` with layers for `receiptNoLabel`, `receiptNoValue`, `dateLabel`, `dateValue`, `telLabel`, `telValue`.

- [ ] Create a standalone HTML editor with draggable/resizable layer boxes and numeric inputs.
- [ ] Include import/export JSON buttons.
- [ ] Use a stage sized to the receipt right-header area, not the full receipt.
- [ ] Verify the file opens and exports valid JSON.

### Task 3: Customer File Persistence and API

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260630120000_customer_file_assets/migration.sql`
- Modify: `src/lib/uploaded-asset-service.ts`
- Modify: `src/app/api/upload-image/route.ts`
- Create: `src/lib/customer-company-file-service.ts`
- Modify: `src/app/api/customer/route.ts`
- Modify: `docs/backup/muledger-cos-backup.md`

**Interfaces:**
- Produces API actions:
  - `GET /api/customer?action=company-files&customerId=<id>` returns attached files.
  - `POST /api/customer` multipart `action=recognize-company-file`, `customerId`, `file` saves and recognizes.
  - `POST /api/customer` JSON `action=delete-company-file`, `assetId` deletes DB marker and NAS source.

- [ ] Add Prisma enum values `UploadedAssetAttachmentType.CUSTOMER_FILE` and `UploadedAssetCategory.CUSTOMER_FILE`.
- [ ] Add upload subdir `customers/files` and mark this category as generic files.
- [ ] Add customer-file service with access checks based on `customerAccessWhere`.
- [ ] Add OCR wrapper that recognizes company name/address/city for images/PDF/TXT and returns unsupported message for Office files.
- [ ] Add API routes and upload-image read permission for customer files.
- [ ] Update backup doc to include `images/customers/files/`.
- [ ] Run Prisma generate and targeted service/API tests.

### Task 4: Customer Edit UI Integration

**Files:**
- Modify: `src/components/workspace/modules/customers/components/customer-form-dialog.tsx`
- Modify: `src/components/workspace/modules/customers/customer-manager.tsx`
- Modify: `src/components/workspace/modules/customers/types.ts`
- Test: `src/components/workspace/modules/customers/components/customer-form-dialog.test.tsx`

**Interfaces:**
- Consumes customer-file API actions from Task 3.
- Produces an edit dialog section listing files, adding upload input, deleting files, and showing one overwrite confirmation dialog with three independently selectable fields.

- [ ] Extend customer form dialog props with file list, upload state, delete handler, and OCR overwrite proposal.
- [ ] Add upload input only for editing an existing customer.
- [ ] On recognition, empty fields are filled directly; non-empty conflicting fields show one dialog with three rows, each row can be accepted/rejected.
- [ ] Save remains the only action that persists field changes.
- [ ] File delete button calls API and removes the NAS source through the backend.
- [ ] Add Chinese/English UI copy.
- [ ] Run component tests.

### Task 5: Verification, Version, Git

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: docs as needed.

**Interfaces:**
- Produces a committed, pushed branch-ready change set after verification.

- [ ] Bump app version from current version.
- [ ] Run `npx prisma generate`.
- [ ] Run targeted tests first, then `npm run typecheck`, `npm run lint`, `npm test -- --runInBand`, and `npm run build` if scope allows.
- [ ] Run `git diff --check`.
- [ ] Commit and push.
- [ ] Ask user before local Docker rebuild unless explicitly requested.
