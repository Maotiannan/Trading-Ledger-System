# MU Contract Full Reconcile Preview Conflict Count Design

## Problem

MU Contract keeps inactive PI rows as synchronization history. When an ORDER NO is recreated, the snapshot can therefore contain one inactive PI and one active PI for the same normalized ORDER NO. The current Full Reconcile preview counts every duplicate source row as a conflict, so the valid replacement pair is reported as two conflicts even after the active PI has taken over successfully.

## Approved Behavior

- Duplicate conflict detection considers active source rows only.
- One inactive historical PI plus one active PI for the same ORDER NO is not a conflict.
- Two or more active PIs for the same ORDER NO remain conflicts and keep the existing per-source-row count.
- Apply behavior, source history, Orders data, financial data, and synchronization persistence are unchanged.

## Verification

- Regression test reproduces the `IB-56` inactive/active replacement pair and expects zero preview conflicts.
- Existing safety behavior is covered by a test with two active PIs and expects two preview conflicts.
- Targeted integration tests, type checking, linting, and production build must pass before release.

## Data And Backup Impact

This is a read-only preview calculation change. It adds no schema, migration, database write path, upload path, generated file, Docker volume, or external persistent data. Existing MySQL and NAS backup coverage is unchanged.
