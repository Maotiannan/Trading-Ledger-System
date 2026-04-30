# Receipt Direct Upload Hardening Design

Date: 2026-04-30
Project: Trading-Ledger-System
Status: Draft for user review

## 1. Goal

Stabilize `Receipt Management -> Create Receipt Directly` for weak-network mobile usage, especially overseas mobile browsers, without changing the core business flow.

This work must:
- improve upload success rate for direct receipt images under poor network conditions
- make upload success and failure states explicit inside the dialog
- auto-fill `INV NO`, `MARK`, `PHONE`, and `PAYER` after entering `ORDER NO`
- improve phone and payer suggestions using the existing customer/invoice matching path
- improve mobile image picking UX so users can go straight to camera or photo library instead of generic file lists
- preserve the current protected upload path, NAS storage path, permissions, and audit boundaries
- stay compatible with existing API automation, versioning, Docker, and CI conventions

## 2. Approved Product Decisions

The following decisions are already confirmed:
- Use the enhanced current upload path rather than redesigning to chunked upload or direct-to-storage now.
- Compression should prioritize readable text over aggressive size reduction.
- Compression quality must not go below `0.30`.
- `payer` auto-fill rule:
  - first use `COMPANY_NAME`
  - if empty, fall back to `NAME`
- `phone` auto-fill should use customer `PHONE`.
- Mobile image selection should favor direct camera or photo library entry points.

## 3. Problem Summary

The current direct-create image upload path has two different weaknesses.

### 3.1 Transport weakness

Real production logs show `ECONNRESET` and Cloudflare Tunnel request cancellation for `/api/upload-image` during mobile uploads. This means weak-network uploads can terminate before the file is fully read server-side.

### 3.2 Product feedback weakness

The direct-create upload handler sets an error state on failure, but the direct-create dialog does not render that error. Users can therefore wait a long time, see the loading state end, and get no explicit success or failure message.

Together these create a bad failure mode:
- upload takes a long time
- upload fails in transport
- dialog returns to normal idle state
- user cannot tell whether the system accepted the image

## 4. Recommended Approach

### 4.1 Preferred option

Keep the existing protected upload API and strengthen it in three places:
- client-side compression before upload
- explicit user-facing upload status and error rendering
- better server/client logging and error mapping

This is the recommended option because it fixes the observed weak-network failure mode without introducing a new storage architecture or a second upload system.

### 4.2 Alternatives considered

#### Option A: compression only
- smallest code change
- improves upload success rate
- does not fix silent failure feedback or observability

Rejected because it leaves the main user-facing failure unresolved.

#### Option B: compression + UX/status + logging hardening
- moderate scope
- directly addresses both network fragility and silent failure
- preserves current API and NAS storage model

Recommended.

#### Option C: chunked upload / direct upload redesign
- architecturally stronger for very poor networks
- much larger change surface
- requires new storage contract, upload resume policy, auth surface, cleanup policy, and more testing

Rejected for now as over-scope for the current production issue.

## 5. Frontend Design

### 5.1 Direct-create image upload states

The direct-create dialog should explicitly render upload state instead of only changing the button text.

Required dialog-visible states:
- idle, no image selected
- compressing
- uploading
- upload success
- upload failed

The dialog must keep user-entered form values intact when upload fails.

On upload failure:
- keep the dialog open
- keep the current `ORDER NO`, `INV NO`, `MARK`, `PHONE`, `PAYER`, `USD`, and other fields
- clear only the failed uploaded image path/name
- show a visible inline error message

On upload success:
- show the uploaded file name
- show a small success indicator/message
- keep the file association ready for final direct-create submit

### 5.2 Client-side compression

Compression should happen before calling `/api/upload-image`.

Recommended policy:
- if the image is already small enough, keep the original file
- otherwise resize to a receipt-friendly max dimension
- prefer JPEG output for non-transparent images
- use iterative quality targeting but never below `0.30`
- preserve enough sharpness for printed or reviewed text

The compression policy is not intended to maximize savings at all costs. It is intended to reduce payload size enough to improve weak-network success while keeping business text legible.

### 5.3 Order-driven auto-fill

`Create Receipt Directly` already uses `ORDER NO` to resolve:
- `INV NO`
- `MARK`

This should be extended so the same lookup also resolves:
- `PHONE`
- `PAYER`

Resolved values should be filled as suggestions, not hard-locked values. Users may still override them manually.

Mapping:
- `phone` => customer `PHONE`
- `payer` => customer `COMPANY_NAME`; if empty, customer `NAME`

If multiple invoice hits exist for the same exact `ORDER`:
- keep current behavior of selecting the latest invoice
- keep the warning/highlight behavior
- use the customer linked to that latest invoice for suggested `MARK / PHONE / PAYER`

If no exact invoice context is available but a unique inferred customer is available:
- still populate `MARK / PHONE / PAYER`
- leave `INV NO` empty

### 5.4 Mobile picker UX

On mobile, the dialog should expose image entry in a way that prefers:
- camera capture
- photo library selection

Recommended UI:
- one action for taking a photo
- one action for choosing from gallery

Implementation should still end in the same upload handler and API path.

The goal is not to guarantee OS behavior beyond browser capability, but to strongly bias the device toward camera/gallery instead of generic file browsing.

## 6. API and Service Design

### 6.1 Upload API

Keep:
- `POST /api/upload-image`
- category `receipt-direct`

No new endpoint is required for this phase.

### 6.2 Error classification

The upload route should log and surface clearer categories for:
- client aborted / connection reset
- request too large
- upload rate limited
- invalid file format
- storage write failure

The client should map these into clearer direct-create dialog messages.

Examples:
- transport aborted => "Upload interrupted. Please try again on a more stable network."
- too large => "Image too large. Please choose a smaller image."
- rate limited => "Too many upload attempts. Please wait and retry."

### 6.3 Lookup response surface

The existing order-context lookup should be extended so the client does not need separate follow-up calls just to derive `PHONE` and `PAYER`.

The lookup contract should include:
- latest exact invoice suggestion
- matched customer mark
- matched customer display name
- matched customer id
- matched customer phone
- matched customer payer suggestion

This keeps the direct-create dialog logic parallel to the current `INV NO` and `MARK` suggestion flow.

## 7. Data Flow

### 7.1 Direct image upload flow

1. User chooses image from camera or gallery.
2. Client validates basic file presence/type.
3. Client compresses when needed.
4. Client uploads compressed file to `/api/upload-image` with category `receipt-direct`.
5. Server stores image under existing direct receipt NAS directory.
6. Server returns `{ path, name }`.
7. Client stores returned image reference in direct-create form state.
8. Final `direct-create` submit sends the stored `imagePath / imageName`.

### 7.2 Order suggestion flow

1. User enters `ORDER NO`.
2. Client debounces and calls existing order context lookup.
3. Lookup returns invoice suggestion + customer suggestion.
4. Client updates:
   - `INV NO`
   - `MARK`
   - `PHONE`
   - `PAYER`
5. User may override any of these before final submit.

## 8. Error Handling

### 8.1 Client behavior

The direct-create dialog must render inline error messages for upload failures.

Failures must not silently reset the user’s mental context.

Specifically:
- keep dialog open
- keep typed fields intact
- reset only failed image binding
- show exact mapped error message

### 8.2 Server behavior

The upload route should preserve current security and validation boundaries, but logs should distinguish transport interruption from business validation failures.

This is important because the current production issue is not primarily a validation failure; it is a broken transport path under weak networks.

## 9. Testing

### 9.1 Unit / hook tests

Add or extend tests for:
- direct-create upload success state
- direct-create upload failure visible state
- compression path chooses compressed file when above threshold
- no destructive state reset on upload failure
- `ORDER NO` auto-fills `INV NO / MARK / PHONE / PAYER`
- payer fallback from `COMPANY_NAME` to `NAME`

### 9.2 API tests

Add or extend isolated API tests for:
- upload route failure mapping
- request-too-large response
- invalid file type response
- order-context payload includes `phone` and payer suggestion fields

### 9.3 Browser tests

Add or extend Playwright coverage for:
- direct-create dialog shows upload failure message
- direct-create dialog shows success state after upload
- mobile render exposes camera/gallery-oriented controls
- `ORDER NO` suggestion fills `INV NO`, `MARK`, `PHONE`, and `PAYER`

## 10. Rollout and Compatibility

This change should be fully backward-compatible with:
- existing receipt direct-create records
- existing NAS upload directory layout
- existing protected upload-image read path
- existing receipt business flow after `direct-create`

No data migration is required.

## 11. Out of Scope

This phase does not include:
- chunked upload
- resumable upload
- direct-to-object-storage upload
- replacing the existing NAS-backed upload persistence model
- redesigning OCR upload flow outside the direct-create dialog
