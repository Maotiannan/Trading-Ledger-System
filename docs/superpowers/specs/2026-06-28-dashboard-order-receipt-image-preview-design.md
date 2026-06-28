# Dashboard Order Receipt Image Preview Design

## Goal

In the Dashboard `Order Receipt Search` card, make each result row's `ORDER NO` open the same receipt image preview used by `Receipt Management` when that receipt has an attached image.

## Confirmed Behavior

- If a receipt search result has an image, its `ORDER NO` is blue/clickable and opens the preview dialog.
- If a receipt search result has no image, its `ORDER NO` remains normal text and does not open a dialog.
- The preview dialog is the existing `ReceiptImagePreviewDialog`, so it shows the same binding metadata as Receipt Management:
  - Bound ORDER NO
  - Bound invoice
  - Creator
  - Receipt image
- No new preview layout, no new API endpoint, no database schema change, no NAS/COS path change.

## Data Flow

1. `searchDashboardReceiptsByOrderNo()` continues to match the input with the shared ORDER NO matcher.
2. The service includes image preview fields in each item:
   - `imageUrl`
   - `imageName`
   - `invNo`
   - `creatorName`
   - `creatorEmail`
   - invoice number from the linked order, if available.
3. Dashboard renders `ORDER NO` as a button only when `imageUrl` exists.
4. Clicking the button sets local `ReceiptImagePreviewInfo` state and opens `ReceiptImagePreviewDialog`.

## Testing

- Service test verifies receipt image metadata is returned.
- Dashboard test verifies clicking an image-backed `ORDER NO` opens the receipt image preview metadata.
- Dashboard test verifies a row without `imageUrl` is not clickable.
