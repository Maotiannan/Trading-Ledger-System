# Receipt/Detail Upload Mobile Hardening Design

## Summary

This spec hardens three related image-driven flows in the receipt and payment-detail modules:

1. `Receipt Management -> Create Directly` image preview/confirm on mobile.
2. `Receipt Management -> Upload Receipt` OCR upload path.
3. `Payment Detail Management -> Upload Payment Detail` OCR upload path.

The goals are:

- make the mobile preview/confirm UX usable in portrait mode;
- remove horizontal scrolling for receipt action buttons on mobile;
- unify business image upload/compression behavior across receipt/detail flows;
- add per-user persisted compression settings;
- eliminate fragile OCR upload behavior under weak-network conditions;
- fix `failed to fetch` flows so users can retry without getting stuck in a disabled state.

This work does **not** introduce asynchronous OCR jobs, chunked upload, or a new storage backend. It hardens the current synchronous flow first.

## Current Problems

### 1. Create Directly preview confirm is not mobile-safe

After selecting an image for `Create Receipt Directly`, the project shows an in-app preview-confirm screen. On narrow portrait screens, large images can push the confirm action off-screen. The header actions are not consistently pinned, so users can fail to see or tap `Confirm` unless they rotate the phone.

### 2. Receipt action buttons are not responsive on mobile

`Receipt Management` currently renders three actions in a horizontal row. On phone portrait screens, users must horizontally drag the container to reveal all actions. That is not acceptable for a primary workflow.

Required mobile order is:

1. `Upload Receipt`
2. `Create Directly`
3. `Generate Signed Receipt`

### 3. OCR upload paths are inconsistent with direct-upload hardening

`Create Receipt Directly` already has a stronger upload path with:

- local image compression;
- progress;
- timeout behavior;
- clearer upload state.

`Upload Receipt` and `Upload Payment Detail` do **not** use that same path. They still use raw `fetch(FormData)` submission for OCR recognition, so they lack:

- shared compression policy;
- consistent progress and stage reporting;
- unified timeout handling;
- unified weak-network error mapping.

### 4. `failed to fetch` leaves OCR flows in a bad state

Under weak networks or tunnel interruptions, the current OCR upload flows can fail with a browser-level `failed to fetch`. Users then report that confirm becomes greyed out or the dialog becomes unusable on repeated attempts. The failure handling is not strong enough.

### 5. Compression settings need to be per-user, not system-wide

The user explicitly wants image compression settings to persist **per account**. Existing settings infrastructure is system-wide/admin-oriented. This requires a separate user-preference storage boundary.

## Goals

### Functional

1. Make `Create Directly` preview confirmation usable on phone portrait screens.
2. Reorder and reflow receipt management top actions for mobile.
3. Add OCR pre-compression for receipt OCR uploads.
4. Add OCR pre-compression for payment-detail OCR uploads.
5. Persist compression preferences per user account.
6. Apply one unified compression configuration source to all business image upload flows.
7. Fix retry behavior after OCR upload failure.

### Non-Functional

1. Reuse shared upload/compression logic instead of duplicating per module.
2. Preserve existing NAS-backed storage behavior.
3. Keep synchronous OCR request/response semantics.
4. Keep the UI bilingual and fully localized.
5. Prefer API-testable behavior where possible.

## Non-Goals

This work does **not** include:

- chunked upload;
- resumable upload;
- background OCR queues;
- replacing Cloudflare tunnel transport;
- adding admin UI for uploaded asset cleanup;
- changing signed receipt generation flow beyond shared config reuse where appropriate.

## User Experience Design

### A. Create Directly image preview confirm

The image preview confirm experience becomes a fixed-structure mobile-safe overlay:

- a sticky header with `Back` on the left and `Confirm Upload` on the right;
- the image preview displayed inside a constrained viewport;
- the image always scaled proportionally;
- the preview never allowed to push the header actions off-screen;
- portrait mode must remain fully usable without rotating the device.

Behavioral rules:

- the header stays visible while the preview scrolls if needed;
- image max width and max height are capped relative to viewport;
- the preview can letterbox or whitespace-pad, but must not overflow the action bar.

### B. Receipt management top actions

Receipt management top actions are reordered and rendered responsively.

Required order:

1. `Upload Receipt`
2. `Create Directly`
3. `Generate Signed Receipt`

Layout rules:

- desktop/tablet wide: single row is fine;
- mobile portrait: actions wrap into stacked rows or a single column;
- horizontal scrolling for these primary actions is not allowed.

### C. OCR upload dialogs

`Upload Receipt` and `Upload Payment Detail` dialogs remain modal workflows, but now use the shared upload pipeline.

Expected UX states:

- `Compressing...`
- `Uploading... xx%`
- `Saving...`
- success
- failure with a localized, specific message

Failure must not destroy the user’s ability to retry.

### D. Per-user compression settings UI

A new user-level settings section is added under the settings page.

This is **not** part of system config.

Proposed fields:

- `Enable image compression`
- `Compression quality floor`
- `OCR target max size (KB)`

Behavior:

- each user reads/writes only their own preference;
- defaults are auto-seeded if no user preference exists;
- changes persist and follow that user account.

## Architecture

## 1. New user preference storage boundary

Introduce a dedicated per-user preference record instead of overloading system settings.

Recommended model shape:

- `UserPreference`
  - `id`
  - `userId` unique
  - `imageCompressionEnabled`
  - `imageCompressionQualityFloor`
  - `ocrTargetMaxKb`
  - timestamps

Rationale:

- system settings are admin/global;
- this requirement is explicitly account-scoped;
- keeping user preferences separate avoids permission confusion and future schema drift.

## 2. Shared business image upload pipeline

Introduce a shared front-end pipeline for business image uploads.

Responsibilities:

- accept a selected file;
- optionally compress it based on current user preference;
- produce preview metadata;
- perform upload/OCR request with upload progress;
- apply idle timeout and hard timeout;
- normalize error mapping;
- return state in a reusable form for receipt/detail modules.

This shared pipeline is used by:

- receipt direct image upload;
- receipt OCR upload;
- payment detail OCR upload.

Swift OCR can be attached later with minimal incremental work.

## 3. Shared compression policy

Compression settings are read once from user preference and passed into the shared pipeline.

Defaults:

- enabled: `true`
- quality floor: current direct-upload default baseline
- OCR target max size: `500 KB`

Rules:

- quality must not drop below the stored floor;
- OCR uploads attempt to compress to <= configured target size where possible;
- if original file is already smaller and acceptable, avoid unnecessary recompression;
- text readability is prioritized over aggressive size reduction.

## 4. Shared timeout/error behavior

Receipt/detail OCR flows adopt the same timeout strategy already agreed for business uploads:

- idle timeout: `15s`
- hard timeout: `120s`

Timeout semantics:

- low throughput with ongoing progress is not idle timeout;
- idle timeout only triggers when uploaded bytes stop advancing;
- hard timeout is a safety cap.

Error mapping must distinguish at least:

- upload aborted/interrupted;
- idle timeout;
- hard timeout;
- generic network failure;
- OCR endpoint application failure.

## 5. OCR state recovery

Receipt/detail OCR dialogs must recover cleanly after failure.

Requirements:

- failure must not leave the dialog stuck in `uploading/submitting`;
- users must be able to retry the same file;
- `Confirm Create` remains disabled only when OCR result is actually absent, not because of stale failure state;
- selected preview can remain visible after failure where practical.

## API Design

## 1. User preference endpoints

Extend settings API with user-preference actions rather than introducing a completely separate page.

Recommended additions under `/api/settings`:

- `GET /api/settings?view=user-preferences`
- `POST /api/settings` with action such as `update-user-preferences`

Permission model:

- authenticated user can read/update only their own preference;
- admin privileges are not required;
- no user can update another user’s preference through this endpoint.

## 2. OCR endpoints

Do not change the high-level business endpoints:

- `/api/receipt` OCR recognize path remains the same;
- `/api/detail` OCR recognize path remains the same.

Changes are client-side pipeline hardening plus improved error observability.

## Data Model

Add one new Prisma model for per-user preferences.

Suggested fields:

- `userId` unique FK to `User`
- `imageCompressionEnabled Boolean`
- `imageCompressionQualityFloor Decimal or Float-safe numeric`
- `ocrTargetMaxKb Int`
- timestamps

Validation rules:

- quality floor constrained to a sane range, e.g. `0.30` to `1.00`;
- target max KB constrained to a sane range, e.g. `100` to `5000`;
- absent row means “use defaults”.

## Module Changes

### Receipt module

- reorder top action buttons;
- make them responsive on mobile;
- refactor direct image confirm preview layout for portrait safety;
- switch OCR upload path to shared upload pipeline;
- keep current `ORDER NO` suggestion/backfill behavior intact.

### Detail module

- switch OCR upload path to shared upload pipeline;
- preserve current OCR confirm flow but fix failure-state recovery.

### Settings module

- add user-preference card for image compression;
- read/write current user preference;
- keep separate from admin-only system config.

### Shared workspace client layer

- centralize upload progress + timeout + error mapping behavior so receipt/detail do not maintain divergent implementations.

## Error Handling

### User-visible messages

Localize clear messages for at least:

- compression failed;
- upload interrupted;
- upload idle timeout;
- upload total timeout;
- OCR request failed;
- OCR returned invalid response;
- save failed;
- retry available.

### Logging

Strengthen logs for OCR upload failures to distinguish:

- browser/network fetch failure;
- request aborted;
- timeout type;
- server-side OCR failure response.

The goal is to make future field reports diagnosable without guessing.

## Testing

### API / service tests

Add tests for:

- default user preference read path;
- user preference update validation;
- only current user preference is mutated;
- OCR error mapping contract where applicable.

### Frontend tests

Add tests for:

- receipt management button order;
- mobile layout wrap/stack behavior;
- direct-image preview header actions remaining visible in portrait mode;
- receipt OCR upload pipeline using compression settings;
- detail OCR upload pipeline using compression settings;
- failure recovery leaves dialog retryable;
- confirm button state resets correctly after failed OCR upload.

### End-to-end / isolated verification

Prefer browser/API automation over manual validation where feasible:

- receipt OCR upload with compressed file;
- detail OCR upload with compressed file;
- weak-network or synthetic timeout behavior where the existing test harness can simulate it;
- settings update -> upload path consumes the new preference.

## Rollout / Migration

1. Add Prisma model + migration.
2. Seed implicit defaults via application logic, not bulk DB backfill.
3. Add settings read/write support.
4. Refactor shared upload/compression client utilities.
5. Migrate receipt OCR and detail OCR to shared pipeline.
6. Update receipt direct preview/mobile layout.
7. Update receipt button layout.
8. Run full automated verification.
9. Rebuild local Docker and update running service.
10. Push and watch GitHub Actions.

## Risks and Mitigations

### Risk: Over-compression harms OCR accuracy

Mitigation:

- enforce quality floor;
- prioritize text clarity;
- allow user-specific tuning;
- skip recompression when not beneficial.

### Risk: Per-user settings complicate settings model

Mitigation:

- keep user preferences in a dedicated table and endpoint branch;
- do not overload admin system config.

### Risk: Receipt/direct and OCR flows diverge again later

Mitigation:

- require all business image upload entry points to use the shared pipeline;
- keep compression and timeout logic outside module-local hooks.

## Success Criteria

This work is successful when all of the following are true:

1. On phone portrait, `Create Directly` preview confirm actions are always visible.
2. Receipt top actions no longer require horizontal drag on mobile and appear in the requested order.
3. Receipt OCR uploads and detail OCR uploads both pre-compress images and honor the same per-user compression settings.
4. OCR target size defaults to `500 KB`.
5. Users can change compression preference in settings and the change persists per account.
6. Weak-network failures no longer leave OCR dialogs stuck in unusable states.
7. `failed to fetch` scenarios surface clearer messages and allow retry.
8. Local Docker, docs, tests, version, and Git state are updated together.
