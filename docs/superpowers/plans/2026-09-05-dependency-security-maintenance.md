# Dependency Security Maintenance Plan

> **Plan status:** `ARCHIVED_COMPLETED` as of 2026-09-05.

**Goal:** Fix every newly reported dependency advisory that has a compatible upgrade, reduce production image attack surface, and preserve all MULEDGER business and persistent data behavior.

## Constraints

- Do not use `npm audit fix --force`.
- Do not downgrade Prisma or force an incompatible `deepmerge-ts` major version.
- Do not modify Prisma schema, migrations, MySQL data, Docker volumes, NAS/COS media, or the running business service during isolated verification.
- Build and test a disposable image before any user-approved app-only deployment.

## Checklist

- [x] Confirm the new full and production audit baselines and trace every finding to its parent dependency.
- [x] Upgrade Next.js, Sharp, PostCSS, nanoid, brace-expansion, and affected development-only transitive dependencies within compatible ranges.
- [x] Change Docker installation to `npm ci`, prune development dependencies, and add a Dockerfile contract regression test.
- [x] Pass typecheck, lint, Prisma validation/generation, full Jest, isolated API, isolated Playwright, production build, audit, and disposable-image runtime checks.
- [x] Record the residual Prisma configuration advisory and why an automatic downgrade or incompatible override is rejected.
- [x] Synchronize latest remote `main`, commit, push PR #31, and wait for GitHub Actions `validate` run `33925150369` to pass.
- [x] Merge PR #31 as `b31b7fb` after CI, then run the user-approved app-only safe rebuild.
- [x] Verify v1.0.217, local and public HTTP, migration status, startup logs, and the unchanged read-write NAS upload mount; archive this plan after closure.

## Residual Risk

Both audit scopes currently report the same three entries from one Prisma CLI configuration chain: `prisma -> @prisma/config -> deepmerge-ts`. The vulnerable behavior requires a recursive object graph supplied to the configuration merge path, while this deployment reads local trusted Prisma configuration during build/startup. Keep the CLI chain monitored and adopt the first compatible Prisma release that removes the advisory.

## Closure Evidence

- PR #31 merged to `main` with merge commit `b31b7fb` after the required GitHub Actions check passed.
- The merged result passed 208 Jest suites / 1382 tests, 24 isolated API cases, and 13 isolated Playwright tests.
- `scripts/rebuild-local-app.sh` completed successfully and deployed v1.0.217 without rebuilding the database or changing persistent storage.
- Prisma reported 28 migrations with no pending migration; local and public home pages returned HTTP 200, and the unauthenticated health endpoint returned the expected HTTP 401.
- `/app/upload` remained a read-write bind mount to the existing NAS path, and recent application startup logs contained no errors.
