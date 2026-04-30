# Uploaded Asset Cleanup Design

Date: 2026-04-30
Project: Trading-Ledger-System
Status: Draft for user review

## 1. Goal

Add a durable, auditable cleanup model for uploaded business images so the system can safely remove orphaned files without guessing from the filesystem alone.

This work must:
- track uploaded image assets at the time the server actually writes them to NAS
- distinguish between temporary staged uploads and files already attached to business records
- clean up orphaned staged assets every 24 hours
- keep signed receipt workflow separate from generic upload cleanup, because `SIGNING_PENDING` is a business state, not just a storage state
- preserve current NAS storage, existing protected image paths, and current data access model
- stay compatible with current Docker, API automation, docs, versioning, and CI expectations

## 2. Confirmed Product Decisions

The following decisions are already confirmed:
- cleanup should run every 24 hours
- cleanup target is files with no business association
- current direct-create image confirmation flow should remain as implemented
- `SIGNING_PENDING` records must not be treated the same as generic staged uploads
- signed-receipt pending records should have their own cleanup policy, not be deleted together with 24-hour temporary image cleanup

## 3. Current Behavior and Problem Summary

### 3.1 Where files are stored today

In the current Docker deployment, uploaded and generated images are stored on NAS through a bind mount:
- container path: `/app/upload`
- host path: `${UPLOAD_HOST_DIR}`
- current default example: `/Volumes/团队文件-DAINTY_SHIPMENT/docker/trading-ledger-system/upload`

This means any image successfully written by the backend survives browser refreshes and container restarts.

### 3.2 Which flows currently create orphan risk

#### A. `Create Receipt Directly`

Two phases now exist:
- before user clicks "confirm upload": image exists only in browser memory, no orphan risk
- after user confirms upload but before user clicks final `Create`: image is already written to NAS, but may never be attached to a `Receipt`

This phase can leave orphan files.

#### B. OCR recognize flows

The following routes write uploaded images immediately during recognition, before final user confirmation:
- `/api/receipt` action `recognize`
- `/api/detail` action `recognize`
- `/api/swift` action `recognize`

If the user closes the dialog, refreshes, or abandons the flow after recognition, those images remain on NAS and may never attach to business data.

#### C. Signed receipt generator

`/api/receipt-generator` does not create the final receipt PNG or signature PNGs until `finalize`.

So there are two different concerns:
- finalized generator assets are real attached business artifacts
- unfinished `SIGNING_PENDING` receipts are business records that may linger, but are not the same as generic orphan uploads

### 3.3 Why pure filesystem scanning is not enough

A daily job that only scans folders and cross-checks paths against a few current DB fields would be fragile:
- it would depend on directory naming conventions staying stable forever
- it would not explicitly know whether a file is still in a temporary pre-confirm stage
- it would not distinguish abandoned staged uploads from deliberately preserved generated assets
- future upload sources would need special-case logic every time

This is not a strong engineering base for a long-lived business system.

## 4. Recommended Approach

### 4.1 Preferred option

Introduce a first-class uploaded asset registry in the database and make every server-side write path register an asset record.

Each asset starts as staged, then moves to attached when a business record actually adopts it.

A daily cleanup job should delete only:
- staged assets
- older than 24 hours
- still unattached
- still present on disk

This is the recommended approach because it removes guesswork and turns file lifecycle into explicit state.

### 4.2 Alternatives considered

#### Option A: filesystem-only garbage collector
- simpler initial code
- no schema change
- weak auditability
- fragile when directories or workflows evolve

Rejected.

#### Option B: asset registry + scheduled cleanup
- explicit lifecycle
- auditable
- stable across future upload sources
- clean separation between staged and attached assets

Recommended.

#### Option C: delay all writes until final confirmation
- reduces orphan files
- would require reworking current OCR flows and image preview assumptions
- increases memory-only client state and user risk on refresh

Rejected for now because it would widen behavior change unnecessarily.

## 5. Data Model

### 5.1 New table: `UploadedAsset`

Add a new persistent table:

- `id`
- `path`
- `name`
- `category`
- `mimeType`
- `sizeBytes`
- `createdBy`
- `status`
- `attachedType`
- `attachedId`
- `expiresAt`
- `createdAt`
- `updatedAt`
- optional `deletedAt`

### 5.2 Status enum

Use explicit lifecycle states:
- `STAGED`
- `ATTACHED`
- `DELETED`

`STAGED` means the image exists on NAS but is not yet attached to a business record.

`ATTACHED` means the image is actively referenced by a business object and must not be touched by orphan cleanup.

`DELETED` means the cleanup job or business cleanup already removed it from disk and logically retired the registry record.

### 5.3 Attachment identity

`attachedType` should support current business consumers:
- `RECEIPT`
- `DETAIL`
- `SWIFT`
- `RECEIPT_GENERATOR_SESSION`

`attachedId` stores the matching row id.

This lets one registry serve both direct/OCR uploads and generated signed receipt artifacts.

## 6. Asset Lifecycle Rules

### 6.1 Generic upload staging

Whenever the backend successfully writes a file to NAS through the generic upload path, it must immediately create an `UploadedAsset` row with:
- `status = STAGED`
- `expiresAt = now + 24h`
- `attachedType = null`
- `attachedId = null`

This applies to:
- `Create Receipt Directly` uploaded images
- OCR-recognized receipt images
- OCR-recognized detail images
- OCR-recognized swift images

### 6.2 Attachment on final business confirmation

When final business confirmation happens, the relevant asset should be promoted to:
- `status = ATTACHED`
- `attachedType = ...`
- `attachedId = ...`
- `expiresAt = null`

Examples:
- direct-create receipt submit attaches the staged receipt image to the created `Receipt`
- receipt OCR confirm attaches the staged image to the confirmed `Receipt`
- detail OCR confirm attaches the staged image to the confirmed `Detail` or to the linked receipt image according to the existing detail service logic
- swift OCR confirm attaches the staged image to `Swift`

### 6.3 Signed receipt generator assets

Signed receipt generator artifacts should also be registered in `UploadedAsset`, but not under the same orphan cleanup assumptions.

Rules:
- final receipt PNG created by generator finalize should be registered as `ATTACHED`
- receiver signature PNG and payer signature PNG should be registered as `ATTACHED` to `RECEIPT_GENERATOR_SESSION`
- no generator artifact should remain `STAGED` after successful finalize

### 6.4 Browser-only pending images

The new client-side preview-confirm step in `Create Receipt Directly` stays browser-only until the user presses `Confirm Upload`.

That means there is no registry row and no cleanup requirement before confirm-upload.

## 7. Scheduled Cleanup Design

### 7.1 Orphan asset cleanup job

Run once every 24 hours.

The job should:
1. query `UploadedAsset` rows where:
   - `status = STAGED`
   - `expiresAt <= now`
2. for each row:
   - verify no attachment exists in registry state
   - resolve the absolute NAS path from its public path
   - if the file exists, delete it from disk
   - mark the asset row `DELETED`
   - record `deletedAt`
3. if the file is already missing:
   - still mark registry row `DELETED`
   - do not fail the entire job

This job should be idempotent.

### 7.2 Failure behavior

If deletion of one asset fails:
- log the asset id, path, and error
- continue processing other assets
- keep failed asset as `STAGED` so it can be retried on the next run

### 7.3 Logging requirements

Cleanup job logs should distinguish:
- staged assets found
- deleted successfully
- already missing on disk
- delete failed

This should make weak-NAS or permission issues visible without stopping all cleanup.

## 8. `SIGNING_PENDING` Separate Policy

`SIGNING_PENDING` receipt records are not generic orphan uploads. They are incomplete business objects.

They need a separate policy.

### 8.1 Recommended policy

Add a second scheduled job or a second stage in the same maintenance job that targets stale signing sessions, not generic staged uploads.

Recommended threshold:
- `72h` after session creation with no finalize

Recommended action:
- mark stale signing session as expired/cancelled
- delete the linked `SIGNING_PENDING` receipt if and only if it has not entered any later state and still has no finalized image
- register any future cleanup in audit logs

This policy is intentionally separate from the 24-hour upload asset cleanup.

### 8.2 Why not 24h for signing sessions

Users may start a signed receipt flow on mobile and complete it later the same day or next day.

Deleting those records under the same 24-hour policy as temporary uploads would be too aggressive and could destroy valid in-progress business work.

## 9. API and Service Boundaries

### 9.1 New service layer

Introduce a dedicated service for asset lifecycle management.

Suggested responsibilities:
- register staged asset after write
- attach asset to business object after confirm
- mark asset deleted after cleanup
- resolve public path to disk path safely
- centralize category-specific expiry defaults

### 9.2 Existing services that must integrate

Integrate the registry with:
- generic upload route `/api/upload-image`
- receipt OCR recognize/confirm
- detail OCR recognize/confirm
- swift OCR recognize/confirm
- signed receipt generator finalize

This should happen in service paths, not in UI components.

### 9.3 No user-facing manual cleanup endpoint in phase 1

Phase 1 should be server-owned cleanup only.

Do not add a manual admin UI for orphan cleanup yet.

The objective is to stabilize lifecycle semantics first.

## 10. Testing Strategy

### 10.1 Unit tests

Add unit coverage for:
- staged asset registration
- staged -> attached promotion
- staged -> deleted cleanup
- missing file on disk during cleanup
- failed deletion logging path
- signed receipt finalize asset registration

### 10.2 API/service integration tests

Add automated integration coverage for:
- direct-create upload without final create leaves staged asset
- final create attaches staged asset to `Receipt`
- OCR recognize without confirm leaves staged asset
- OCR confirm promotes staged asset to attached
- 24h cleanup deletes expired staged assets only
- attached assets survive cleanup
- stale `SIGNING_PENDING` policy is handled separately

### 10.3 Operational verification

After implementation, verify locally:
- files still write to NAS mount, not container ephemeral storage
- cleanup deletes staged assets from NAS path
- business-attached files remain accessible through protected image read endpoints

## 11. Rollout Notes

### 11.1 Migration safety

Existing production files already on disk will predate the new registry.

Phase 1 should not try to retroactively register all historical files automatically unless a safe backfill plan is added.

Recommended rollout:
- start registering new uploads only
- cleanup job acts only on assets present in registry
- leave historical unmanaged files untouched for now

This avoids accidental deletion of old business assets.

### 11.2 Future backfill

A later maintenance task can optionally backfill historical disk files into the registry if needed, but that is not required to safely launch this phase.

## 12. Scope Summary

This design includes:
- new `UploadedAsset` registry table
- explicit staged/attached/deleted lifecycle
- 24-hour orphan cleanup for unattached staged uploads
- separate stale `SIGNING_PENDING` session cleanup policy
- service-level integration across receipt/detail/swift/upload/generator flows

This design does not include:
- filesystem-only best-effort cleanup without registry state
- immediate retroactive backfill of all historical images
- direct user/admin cleanup UI
- upload architecture redesign such as chunked upload
