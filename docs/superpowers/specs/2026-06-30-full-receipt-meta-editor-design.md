# Full Receipt Meta Editor Design

## Goal

Provide a standalone local HTML editor that displays the complete current generated receipt while allowing only the `No`, `Date`, and `Tél` labels and values to move or resize.

## Scope

- Keep the complete receipt visible as a locked background.
- Keep logos, company text, title, currency boxes, detail box, watermark, receiver block, and signature areas unchanged and non-interactive.
- Make these six layers interactive:
  - `receiptNoLabel`
  - `receiptNoValue`
  - `dateLabel`
  - `dateValue`
  - `telLabel`
  - `telValue`
- Do not change the production receipt template until the operator exports and approves a new full-receipt JSON layout.
- Remove the rejected partial-stage integration before committing the editor.

## Coordinate System

- Use the generated receipt's native `720px` width.
- Use absolute `x`, `y`, `w`, and `h` values relative to the complete receipt, not a separate `250x120` area.
- Keep exported coordinates independent of display zoom.
- Scale the whole stage for smaller screens without changing native coordinates.

## Background Fidelity

- Generate the locked background from the current production receipt Canvas with the six meta layers hidden.
- Preserve the current positions and appearance of every other receipt element.
- Embed the generated background into the standalone HTML so the editor opens without a server or network access.
- Do not manually recreate the full receipt using approximate HTML/CSS.

## Editor Controls

- Drag a selected layer to move it.
- Drag a resize handle to change width and height.
- Edit `x`, `y`, `w`, `h`, `fontSize`, and `fontWeight` numerically.
- Provide Reset, Import JSON, Export JSON, and Copy controls.
- Show the sample values `0010000`, `30/06/2026`, and `+224 622 05 71 47`; production values remain dynamic.
- Keep receipt number orange and other meta text in the existing receipt color.

## Output

Export:

```json
{
  "schema": "RECEIPT_META_ABSOLUTE_LAYOUT",
  "version": 1,
  "stage": {
    "width": 720,
    "height": 507
  },
  "layers": {
    "receiptNoLabel": {},
    "receiptNoValue": {},
    "dateLabel": {},
    "dateValue": {},
    "telLabel": {},
    "telValue": {}
  }
}
```

The final stage height must match the generated locked background and may be greater than `507` if the current receipt content requires it.

## Verification

- Open the standalone file directly with `file://`.
- Confirm the complete receipt background is visible.
- Confirm only six meta layers can be selected, moved, resized, and edited.
- Confirm export/import round-trips without coordinate changes.
- Confirm zoom does not alter exported coordinates.
- Capture a browser screenshot for visual verification.

## Approved Production Layout

The operator-approved `RECEIPT_META_ABSOLUTE_LAYOUT` is now the single source for the six production Canvas layers. Labels use the stored sample text; receipt number, date, and telephone values remain dynamic. Telephone text stays on one line and shrinks to fit its approved width instead of wrapping.
