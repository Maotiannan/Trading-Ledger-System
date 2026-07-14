# Orders Confirmed Date Design

**Date:** 2026-07-14
**Status:** Approved for planning

## Goal

Add a `CONFIRMED DATE` column immediately after `DEPOSIT` on the Orders page. The value must represent the day on which the current `OrderTracker` status most recently entered `Confirmed`, rather than the row's general last-modified time.

## Confirmed Business Rules

- Persist a dedicated nullable confirmation timestamp on `OrderTracker`.
- Display the timestamp as `DD/MM/YYYY` in the existing `Africa/Conakry` application timezone.
- Display `-` when no confirmation timestamp exists.
- Creating a tracker directly with status `Confirmed` records the creation time as its confirmation timestamp.
- Changing a tracker from any non-`Confirmed` status to `Confirmed` records the current time.
- Updating remarks, PI status, system notes, or saving `Confirmed` as `Confirmed` does not change the existing confirmation timestamp.
- Changing a tracker from `Confirmed` to any other status clears the confirmation timestamp.
- Changing it back to `Confirmed` records a new timestamp.
- Existing rows whose current status is `Confirmed` are backfilled once from their existing `updatedAt` value. This is an accepted historical approximation because the exact past transition time was not stored.
- Existing rows whose current status is not `Confirmed` remain null.

## Data Model And Migration

Add `confirmedAt DateTime?` to the Prisma `OrderTracker` model and a matching nullable MySQL column.

The migration performs these steps:

1. Add the nullable column without altering existing status values.
2. Backfill `confirmedAt = updatedAt` only where `status = 'Confirmed'`.
3. Leave all other rows null.

The column remains nullable so clearing a confirmation date is explicit. No new table, index, media path, scheduled job, or external storage is required.

## Write Flow

The service computes the confirmation timestamp in the same database write as the status update:

- Create: set the timestamp only when the sanitized initial status is `Confirmed`.
- Update to `Confirmed` from another status: set it to the current server timestamp.
- Update away from `Confirmed`: set it to null.
- No actual status transition: do not include the timestamp in the update payload.

This prevents unrelated edits from moving the confirmation date. Audit metadata for status-changing writes records the previous status, next status, and confirmation timestamp before and after the change.

## Read API And UI

- The existing Orders list API returns the nullable timestamp with each row.
- The shared `OrderTrackerRow` frontend type includes the field.
- The Orders table adds `CONFIRMED DATE` immediately after `DEPOSIT` and before `Customer`.
- The cell uses the existing `formatAppDate` helper, which formats dates in `Africa/Conakry`.
- The empty-table `colSpan` is increased for the new column.
- No new user setting is required because the column is part of the fixed business record and the date format already follows the global application timezone.

## Permissions And Error Handling

Existing Orders permissions remain unchanged. Any account currently allowed to change base status can trigger the timestamp transition. The client never submits or edits the confirmation timestamp directly; the server owns it completely.

If a status update fails, neither status nor confirmation timestamp changes because both values are part of one database update. Existing readable API error handling is reused.

## Tests

Use test-first implementation and cover:

- Creating `Confirmed` sets a confirmation timestamp.
- Creating another status leaves it null.
- Non-confirmed to `Confirmed` sets the timestamp.
- `Confirmed` to `Confirmed` preserves the timestamp.
- `Confirmed` to another status clears it.
- Returning to `Confirmed` sets a new timestamp.
- Remark-only and admin-field-only edits preserve it.
- Audit metadata contains before/after status and timestamp for actual status transitions.
- The Orders list serializes the timestamp.
- The UI renders `CONFIRMED DATE` after `DEPOSIT` using Guinea date formatting and renders `-` for null.
- An isolated API migration case verifies historical backfill and a live status transition against a temporary database.

## Backup, Deployment, And Rollback

This is durable MySQL schema data. The existing `trading_ledger` `mariadb-dump` automatically includes the new column, so no new COS or NAS path is needed. The implementation must update `docs/backup/muledger-cos-backup.md` to state that Orders confirmation timestamps are covered by the database dump.

Before applying the migration to the running service:

- verify the backup job/preflight and current database connectivity;
- confirm the migration SQL and backfill predicate against an isolated database;
- run the normal isolated API tests;
- use the project's safe rebuild flow only after code and CI pass.

Rollback should first revert application code while leaving the nullable column in place, which is backward compatible. Dropping the column would destroy confirmation history and must not be done without an explicit backup and approval.
