# Dependency Security Maintenance Plan

> **Plan status:** `ACTIVE` as of 2026-09-05.

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
- [ ] Synchronize latest remote `main`, commit, push a PR, and wait for the final GitHub Actions result.
- [ ] Merge only after review and CI, then run the app-only safe rebuild if the user approves deployment.
- [ ] Verify the running version, health, migrations, logs, and unchanged data mounts; archive this plan after closure.

## Residual Risk

Both audit scopes currently report the same three entries from one Prisma CLI configuration chain: `prisma -> @prisma/config -> deepmerge-ts`. The vulnerable behavior requires a recursive object graph supplied to the configuration merge path, while this deployment reads local trusted Prisma configuration during build/startup. Keep the CLI chain monitored and adopt the first compatible Prisma release that removes the advisory.
