# Approval, Search, and Composite ORDER Follow-ups Plan

> **Plan status:** `ARCHIVED_COMPLETED` as of 2026-07-17. The implementation is on `main`; unchecked boxes below are retained as the original execution checklist and are not active backlog. See [the status index](./README.md).

1. Extend the order matching kernel to understand `/`-delimited composite ORDER numbers and add targeted tests.
2. Wire composite-order support into invoice order-context lookup and any exact-order helper used by receipt direct/OCR flows.
3. Rename the Deletion Approval surface to Approval and aggregate receipt/detail/swift edit request sections into it.
4. Remove duplicate edit-request tables from Receipt/Detail/SWIFT pages once the centralized Approval page renders parity behavior.
5. Remove the Payment Detail direct-only export restriction in API and UI.
6. Introduce a shared latest-request gate for live search pages and migrate list loaders module by module.
7. Run targeted tests for matching, approval UI/API, detail export, and search race handling.
8. Run `npm run build` and `npm run test:ci`, then update version/docs/Docker/Git if green.
