# Excel ML Token API Design

## Purpose

MULEDGER needs a secure Excel lookup path so users can enter an order number such as `GANDO-10` and retrieve customer fields through an Excel function such as `=ML(A1, 2)`.

The feature must avoid exposing broad customer APIs to anyone who can reach the service. Each account gets its own API token, and token calls inherit that account's current permissions and customer visibility.

## Current Project Context

The project is a Next.js application with Prisma/MySQL, Caddy, Docker, and API routes under `src/app/api/*`.

Existing authentication uses `/api/auth` to issue the `tls_session` HttpOnly cookie. Existing server route guards use `withAuth` and `withRole`, backed by `CurrentUser` from `src/lib/request-auth.ts`.

Business visibility is already modeled through:

- `src/lib/user-hierarchy.ts` for account hierarchy and owner visibility.
- `src/lib/resource-visibility.ts` for invoice/order/receipt/detail/SWIFT visibility.
- `src/lib/customer-scope.ts` for customer owner rules.
- `src/lib/customer-matching.ts` for parsing order names from order numbers.
- `src/lib/invoice-read-service.ts#lookupInvoiceOrderContext` for existing order-context matching.

The Excel feature must reuse these concepts instead of creating a parallel permission model.

## User-Facing Excel Contract

The Excel add-in or macro will expose:

```text
=ML(orderNumberCell, fieldNumber)
```

Examples:

```text
=ML(A1, 1)  -> ORDER_NAME
=ML(A1, 2)  -> DISPLAY_NAME
=ML(A1, 3)  -> MARK
```

`orderNumberCell` is the uploaded or entered order number. It may be a concrete order number such as `GANDO-10`, not only a customer `ORDER_NAME`.

`fieldNumber` selects the returned field.

## Field Mapping

The initial numeric mapping is:

```text
1   ORDER_NAME        Customer.orderName
2   DISPLAY_NAME      Customer.companyName, falling back to Customer.name
3   MARK              Customer.mark
4   CUSTOMER_NAME     Customer.name
5   COMPANY_NAME      Customer.companyName
6   PHONE             Customer.phone
7   CITY              Customer.city
8   CONSIGNEE         Customer.consignee
9   COMPANY_ADDRESS   Customer.companyAddress
10  CREDIT            Customer.credit
11  CUSTOMER_ID       Customer.id
```

`CUSTOMER_NAME` means the `NAME` field shown in the web customer-management page.

Field `2` is the convenience field requested for spreadsheets: use `COMPANY_NAME` when present, otherwise use `CUSTOMER_NAME`.

Unknown field numbers return a validation error.

## Matching Rules

For input `GANDO-10`, the server must use existing matching behavior:

1. Normalize the raw order number with the same order helpers used by invoice/order flows.
2. Try existing visible orders and aliases first.
3. If a visible order is found and has a linked customer, return that linked customer's current record.
4. If no order/customer link is found, derive `ORDER_NAME` from the order number using the existing rule in `extractOrderNameFromOrderNo`: take the text before the last `-`, trim it, and collapse repeated whitespace.
5. Query visible customers by the derived `ORDER_NAME`.
6. If exactly one visible customer matches, return it.
7. If zero customers match, return not found.
8. If multiple customers match, return conflict. The service must not guess.

For an input without a valid derived name, such as a string without a usable `-`, the service returns not found unless an exact visible order/alias match already resolves to a linked customer.

## Permission Model

Each token maps to one account. Lookup calls build a `CurrentUser` from that account on every request, so changes to account role, parent, or visibility apply immediately.

Token calls use the current account's effective permissions:

- `ADMIN` can resolve customers visible to admins.
- `SALES` can resolve customers in that account's permitted customer scope.
- `USER` does not get elevated permissions. The Excel lookup will not call the existing manager-only customer list route. It will use a dedicated read-only resolver limited by the token account's `ownerVisibleIds`.

The Excel endpoint returns only the selected field and does not expose full customer lists.

## API Design

### Single-Field Text Endpoint

```text
GET /api/excel/ml?orderNo=GANDO-10&field=2
Authorization: Bearer <token>
```

Successful response:

```text
KIGNA SARL
```

The plain-text response is optimized for Excel cell functions.

### Debug JSON Endpoint

For automated tests and troubleshooting, support a JSON mode:

```text
GET /api/excel/ml?orderNo=GANDO-10&field=2&format=json
Authorization: Bearer <token>
```

Successful response:

```json
{
  "success": true,
  "data": {
    "value": "KIGNA SARL",
    "field": 2,
    "fieldKey": "DISPLAY_NAME",
    "orderNo": "GANDO-10",
    "derivedOrderName": "GANDO",
    "matchedBy": "linked-order|order-alias|derived-order-name",
    "customer": {
      "id": "customer-id",
      "mark": "KIGNA TEXTILE",
      "orderName": "GANDO",
      "name": "Mamadou Gando"
    }
  }
}
```

### Batch Endpoint

Add a batch endpoint for future Excel performance:

```text
POST /api/excel/ml/batch
Authorization: Bearer <token>
Content-Type: application/json

{
  "lookups": [
    { "orderNo": "GANDO-10", "field": 2 },
    { "orderNo": "IB-01", "field": 3 }
  ]
}
```

The batch endpoint returns per-row results and errors without failing the whole batch when one row fails.

## Token Storage

Add a Prisma model for per-account Excel tokens.

Fields:

- `id`
- `userId`
- `name`
- `tokenPrefix`
- `tokenHash`
- `lastUsedAt`
- `lastUsedIp`
- `revokedAt`
- `expiresAt`
- `createdAt`
- `updatedAt`

The raw token is shown only once at generation time.

The server stores only a hash. A token format with a stable prefix should be used so the server can locate candidate token rows efficiently, then verify the hash with constant-time comparison.

Suggested raw token format:

```text
ml_<publicId>_<secret>
```

The displayed token must be long enough for online use. The secret should use cryptographically strong random bytes.

## Token Management

Expose management actions through authenticated session APIs, not through token-auth APIs:

- Generate or rotate current user's token.
- List current user's token metadata, never the raw token.
- Revoke current user's token.

Admins can manage their own token through the same path. Any later "admin revoke subordinate token" capability should be separate and audited explicitly.

The Settings page gets an "Excel API Token" card showing:

- Whether a token exists.
- Token prefix.
- Created time.
- Last used time.
- Expiration, if configured.
- Generate/rotate button.
- Revoke button.
- One-time copy area after generation.

## Audit

Add audit actions:

- `EXCEL_TOKEN_CREATE`
- `EXCEL_TOKEN_REVOKE`
- `EXCEL_TOKEN_LIST`
- `EXCEL_ML_LOOKUP`
- `EXCEL_ML_LOOKUP_CONFLICT`
- `EXCEL_ML_LOOKUP_NOT_FOUND`

Lookup audit metadata should include token id, user id, order number, field, match mode, and result status. It should not log the raw token.

## Rate Limiting

Add a dedicated rate-limit bucket for Excel lookups. Defaults should be configurable through settings:

- `EXCEL_LOOKUP_RATE_LIMIT_WINDOW_MS`
- `EXCEL_LOOKUP_RATE_LIMIT_MAX`

The bucket key should include token id and client IP. This keeps one spreadsheet refresh from affecting unrelated users.

## Error Semantics

Plain-text mode should return useful HTTP statuses:

- `401` for missing, invalid, expired, or revoked token.
- `400` for invalid order number or field.
- `404` for no matching customer.
- `409` for multiple matching customers.
- `429` for rate limit.

JSON mode uses the standard API error response shape.

The Excel wrapper can convert these statuses into friendly cell text such as blank, `#ML_NOT_FOUND`, or `#ML_CONFLICT`.

## Tests

Add service tests for:

- Token generation stores only hash and returns raw token once.
- Token verification rejects missing, malformed, expired, revoked, or wrong tokens.
- Field mapping returns the expected values.
- Field `2` falls back from `companyName` to `name`.
- Order number parsing uses the existing `extractOrderNameFromOrderNo` behavior.
- Multiple customer matches produce conflict.

Add isolated API tests for:

- Unauthenticated Excel lookup returns `401`.
- Generated token can resolve `GANDO-10` to field `1`, `2`, and `3`.
- Token belonging to one account cannot read another account's customer.
- Revoked token no longer works.
- Batch endpoint returns mixed success/error rows.

Run at minimum:

```bash
npx tsc --noEmit
npm run lint
npm test -- --runInBand
npm run test:api:isolated
```

If the running local Docker service should reflect the change, rebuild with:

```bash
docker compose up -d --build
```

## Documentation And Versioning

Implementation must update:

- `README.md` for user-facing Excel token usage and field mapping.
- `todolist.md` for current status.
- `docs/API_TESTING.md` for token lookup examples.
- `CHANGE_CHECKLIST.md` only if the change adds durable process rules.
- `package.json#version`, keeping `APP_VERSION` as the single frontend source.

The API catalog under `src/lib/api-catalog.ts` should include the new token-management and Excel lookup routes.

## Open Decisions Resolved

- Customer name is `Customer.name`, the `NAME` field in web customer management.
- Input is order number such as `GANDO-10`, not only `ORDER_NAME`.
- Every account gets an independent token.
- Token permissions follow the account's current configured permissions.
- Field `2` returns `COMPANY_NAME` with fallback to `CUSTOMER_NAME`.
