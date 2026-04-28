# Receipt Generator Template Fidelity And Mobile Signing Design

Date: 2026-04-28
Project: Trading-Ledger-System
Status: Draft for user review

## 1. Goal

Refine the existing signed-receipt generator so that:

- the final generated receipt visual output matches the provided `receipt_layout_editor.html` template as closely as possible
- the project stops using the current simplified custom canvas layout
- desktop keeps the dedicated signing window flow
- mobile signing becomes a focused full-screen signing experience
- mobile users can understand signature orientation without manual rotate controls

This is a refinement of the already-implemented signed-receipt generator, not a brand new feature.

## 2. Confirmed Product Decisions

These decisions are already confirmed by the user:

- Use the existing project-native two-stage flow, not an iframe embedding.
- Copy the final receipt template from `receipt_layout_editor.html` as closely as possible.
- Copy the confirmed receipt visual style completely:
  - text layout
  - spacing
  - borders
  - default embedded assets
  - logo / watermark / default base images
  - signature box positions
  - receipt content placement
- Do **not** copy the left debug/control panel from the original HTML.
- Keep both signatures:
  - receiver signature
  - payer signature
- Desktop keeps the separate signing window.
- Mobile uses the same-tab signing route.
- On mobile, tapping a signature area enters a focused full-screen signing mode for that specific signature.
- The mobile signing surface should be white and easy to understand.
- Add a light gray English signature watermark on the white signing surface so users can understand direction.
- Portrait mode is allowed.
- In portrait mode, show a fullscreen / landscape entry control at the top-left.
- When that control is used, the experience should switch into a landscape-oriented signing view as far as the browser allows.
- No manual `+90 / -90` rotate controls are needed in the new design.

## 3. Current Problem

The current implementation differs from the approved target in two important ways:

1. The receipt preview/export template is currently a simplified custom canvas renderer.
   - It does not match the provided HTML template's real positioning, visual hierarchy, or embedded assets.

2. Mobile signing is currently only "mobile-friendly", not "signature-first".
   - It shows inline signature pads and a landscape hint.
   - It does not provide the focused, near-native, full-screen signature mode the user expects.

## 4. Recommended Approach

### 4.1 Template fidelity

Replace the current handwritten receipt canvas layout with a fixed project template derived directly from the provided `receipt_layout_editor.html`.

The target is not "similar".
The target is "same visual output except for the removed debug panel".

Implementation rule:

- treat the provided HTML template as the source of truth for final receipt composition
- extract and freeze:
  - base page geometry
  - text blocks
  - default images
  - signature box geometry
  - font sizing
  - line rules
  - spacing rules
- keep the data-binding dynamic, but keep the visual shell static

### 4.2 Desktop signing

Desktop flow remains:

- Stage A launch form in Receipt Management
- create `SIGNING_PENDING` receipt and generator session
- open dedicated popup window
- show receipt preview + two signatures
- finalize, download PNG, notify opener, close popup, refresh receipts page

No major behavioral change is needed on desktop beyond updating the visual template and signature pad styling.

### 4.3 Mobile signing

Mobile flow changes from inline signing to focused per-signature signing mode.

Proposed behavior:

1. User reaches the mobile signing page for the generator session.
2. The page shows the receipt preview and the two signature placeholders.
3. Tapping a signature area opens a full-screen white signing mode for that specific signature.
4. The signing mode displays:
   - a white full-screen background
   - a light gray English signature watermark
   - clear title indicating which signature is being collected
   - confirm / clear / cancel controls
5. In portrait mode:
   - a top-left fullscreen / landscape action is shown
   - the app attempts fullscreen and landscape-friendly presentation
6. If browser orientation lock is unsupported:
   - continue using the full-screen white surface
   - keep the watermark and title readable in portrait
   - allow the user to sign without manual rotation controls
7. On confirm:
   - return to the parent signing page
   - update the selected signature preview

This avoids fragile popup behavior on phones and better matches signature apps commonly used in mobile browsers.

## 5. Full-Screen Signing Rules

### 5.1 Entering signature mode

On mobile, each signature area becomes an entry point:

- `receiver signature` area
- `payer signature` area

Entering signature mode should not open a new browser popup.
It should switch the current page into a dedicated full-screen overlay/state.

### 5.2 Surface design

The full-screen signature surface must be:

- white background
- minimal chrome
- no receipt preview behind it
- no extra card layout that wastes space
- large enough for finger signing

### 5.3 Orientation guidance

The bottom or center watermark should read in English, lightly, such as:

- `SIGN HERE`
or
- `SIGNATURE AREA`

The watermark must be visually subtle:

- light gray
- low emphasis
- large enough to indicate direction

This watermark is not part of the exported receipt.
It is only part of the signing UI.

### 5.4 Portrait behavior

Portrait mode remains usable.

Top-left should provide a control such as:

- `Fullscreen`
or
- `Landscape`

Behavior:

- attempt `requestFullscreen()`
- attempt `screen.orientation.lock('landscape')` when supported
- if not supported, remain in fullscreen or near-fullscreen portrait mode without blocking signature input

The flow must degrade gracefully on Safari / iOS where orientation APIs are inconsistent.

## 6. Template Fidelity Rules

The project must stop approximating the original template and instead codify it.

### 6.1 What must match

These must follow the provided HTML template closely:

- overall document aspect and page framing
- header positioning
- `RECU / RECEIPT` area
- receipt number / date positioning
- data rows
- line separators
- signature titles and signature box placement
- default image assets
- white background export behavior

### 6.2 What must not be copied

These are excluded:

- left-side debug panel
- upload controls
- test buttons
- next-number debug controls
- manual development utilities

### 6.3 Source-of-truth strategy

Do not keep "template geometry" scattered across multiple React components.

Recommended internal structure:

- one template definition module describing:
  - canvas size
  - image placements
  - text anchors
  - signature box placements
- one renderer module that paints from that definition

This keeps later corrections manageable if the template needs one more pixel-level adjustment.

## 7. Impacted Frontend Components

Primary components to change:

- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/receipt-canvas.tsx`
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/signature-pad.tsx`
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/signing-view.tsx`
- `/Users/maotiannan/dev/docker/Trading-Ledger-System/src/components/workspace/modules/receipts/generator/mobile-orientation-hint.tsx`

Recommended new modules:

- template asset module
- template geometry/view-model module
- dedicated mobile fullscreen signature overlay component

## 8. Testing Requirements

### 8.1 Unit / component coverage

Add or update tests for:

- mobile signature mode state transitions
- per-signature full-screen entry/exit
- fullscreen fallback when orientation lock is unavailable
- template view-model integrity
- receipt export still succeeds with the new template

### 8.2 API stability

No API contract change is required for this refinement.

The existing generator API should continue to work:

- session creation
- session fetch
- finalize with receipt image + two signatures

### 8.3 End-to-end coverage

At minimum, Playwright should cover:

1. desktop popup flow still works
2. final receipt is generated and attached
3. mobile-viewport flow enters full-screen signature mode
4. mobile flow can sign receiver then payer, finalize, and return to receipts list

## 9. Risks And Constraints

### 9.1 Browser full-screen limitations

Mobile browsers, especially iOS Safari, may not consistently honor:

- true fullscreen
- orientation lock
- popup sizing

Therefore the design intentionally avoids popup dependence on mobile and uses an in-page full-screen state instead.

### 9.2 Pixel-perfect export vs responsive UI

The exported receipt must be fixed and template-accurate.
The signing UI can be responsive.

These are different concerns and must remain separated:

- export renderer = fixed template
- signing UX = adaptive

### 9.3 Asset management

If the HTML contains embedded base64 images, they should be extracted and frozen into project-managed assets or equivalent persistent template constants.

They should not remain buried inside a long ad hoc component string.

## 10. Success Criteria

This refinement is complete only when all of the following are true:

- exported receipt image matches the provided HTML template closely enough that the user recognizes it as the same receipt style
- desktop popup flow still works
- mobile signing no longer relies on inline signature pads only
- mobile tapping a signature area opens a focused full-screen white signing surface
- the surface includes a light gray English watermark for directional guidance
- portrait mode remains usable
- top-left fullscreen / landscape affordance exists on phone
- final generated PNG still saves to NAS, downloads locally, and attaches to the receipt record
- the new flow passes automated regression tests
