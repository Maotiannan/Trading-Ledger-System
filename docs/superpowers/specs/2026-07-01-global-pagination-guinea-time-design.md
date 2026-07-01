# Global Pagination And Guinea Time Design

## Goal
Unify list pagination UI for Payment Detail and SWIFT, and standardize system-created/updated time display and generated receipt dates on Guinea time.

## Scope
- Add a reusable pagination component for list pages.
- Replace Payment Detail Management, SWIFT Management, and Receipt Management bottom pagination with the shared component.
- Add a global app time utility using `Africa/Conakry`.
- Keep database timestamps stored as UTC/Date values. Only display and generated document formatting use Guinea time.
- Update the signed receipt generator date formatter from the current hard-coded Shanghai timezone to the global app timezone.

## Pagination Behavior
- Keep the page-size select control.
- Receipt Management uses the global `5 / 10 / 20 / 50` page-size options, defaults to `20`, and persists the selected size with the current account.
- Do not show visible `Rows per page` or `每页条数` text.
- Keep accessible labels for page size and previous/next controls.
- Previous and next visible labels are `←` and `→`.
- Page summary format is `current / total (count)`, for example `1 / 2 (15)`.
- Keep the page-size select, previous arrow, page summary, and next arrow on one non-wrapping row on mobile.
- The component accepts injected text via the existing `tx(zh, en)` pattern.

## Time Behavior
- `APP_TIME_ZONE` is `Africa/Conakry`.
- `formatAppDate` returns a Guinea-time date label.
- `formatAppDateTime` returns a Guinea-time date-time label.
- Invalid or empty values return `-` or caller-provided fallback.
- Business-entered dates remain date-only display values; this change targets created/updated/requested/reviewed system timestamps and generated receipt date output.

## Non-Goals
- Do not migrate or rewrite existing database timestamp values.
- Do not change invoice/payment/receipt business date storage.
- Do not rebuild Docker as part of implementation unless explicitly requested after verification.
