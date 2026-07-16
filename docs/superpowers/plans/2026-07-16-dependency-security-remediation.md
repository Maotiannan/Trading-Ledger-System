# Dependency Security Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the current `npm audit` result from 24 known vulnerabilities to zero without changing MULEDGER business behavior or persistent data.

**Architecture:** Upgrade one dependency family per release so every change has an independent Git commit, pull request, CI result, rollback point, and local app rebuild. Business rules, Prisma schema, MySQL data, Docker volumes, and NAS/COS media paths remain unchanged; each batch must pass automated tests and an isolated runtime gate before it can replace the running app image.

**Tech Stack:** Node.js 22, npm lockfile v3, Next.js 16, React 19, Prisma 6, Jest, Playwright, Docker Compose, GitHub Actions.

## Global Constraints

- Never run `npm audit fix --force`.
- Never run destructive database, migration-reset, Docker-volume, or NAS cleanup commands.
- Keep Prisma 6 unless a later major upgrade is separately designed and approved.
- Use the minimum safe compatible version when a patch release is available.
- After every batch: run targeted tests, typecheck, lint, full Jest, production build, isolated API/E2E tests, `npm audit`, GitHub Actions, and `scripts/rebuild-local-app.sh`.
- A batch may be merged and deployed only when its audit count does not increase and all gates pass.
- If the rebuilt app health check fails, collect the complete script output and app logs; roll back the app code/image without touching MySQL or NAS data.

---

### Task 1: Next.js Security Patch

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `ENGINEERING_LOG.md`
- Modify: `todolist.md`

- [x] Upgrade `next` and `eslint-config-next` together from `16.1.6` to `16.2.10`.
- [x] Confirm no source or configuration migration is required by typecheck, lint, full Jest, production build, isolated API, and isolated E2E.
- [x] Record before/after audit counts, release `1.0.198`, push, merge after CI, rebuild app-only, and verify health/version/logs.

### Task 2: Internationalization Security Patch

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: localization integration only if the compatible update requires it
- Modify: release documentation

- [x] Upgrade `next-intl` to a safe 4.x release and keep locale behavior unchanged.
- [x] Run localization, route, API, full-suite, build, isolated runtime, audit, CI, merge, and app-only rebuild gates.

### Task 3: Prisma 6 Security Patch

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: generated Prisma client artifacts only at build time
- Modify: release documentation

- [x] Upgrade `prisma` and `@prisma/client` together from `6.19.2` to `6.19.3`.
- [x] Run `prisma generate` and confirm `prisma/schema.prisma` plus migration history are unchanged.
- [x] Run service/API/full-suite/build/isolated runtime/audit/CI gates, merge, and rebuild app-only.

### Task 4: Editor And Syntax Rendering Security Updates

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: editor or syntax-rendering imports only if required
- Modify: release documentation

- [x] Remove the unused `@mdxeditor/editor` dependency and its transitive packages instead of introducing an unnecessary major upgrade.
- [x] Remove the unused `react-syntax-highlighter` dependency and its transitive packages instead of introducing an unnecessary major upgrade.
- [x] For each release, run focused UI tests plus all standard gates before merge and app-only rebuild.

### Task 5: Excel And UUID Security Updates

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: Excel import/export code only if compatibility tests require it
- Modify: release documentation

- [x] Remove the unused direct `uuid` declaration instead of retaining an unnecessary direct dependency.
- [x] Resolve ExcelJS nested `uuid` and `tmp` advisories with tested targeted overrides rather than downgrading ExcelJS.
- [x] Run all Excel import/export unit and isolated API tests, then all standard gates, merge, and app-only rebuild.

### Task 6: Remaining Transitive Advisories

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: release documentation

- [x] Re-run `npm audit` and map every remaining package to its direct parent with `npm explain`.
- [x] Prefer a compatible parent update; use the narrowest tested npm override only where the parent has not released a safe dependency range.
- [x] Verify `npm audit` reports zero vulnerabilities in both complete and production-only scans.
- [ ] Run all standard gates, merge, rebuild app-only, verify public route and authenticated health behavior, and record the final audit evidence.

### Task 7: Final Operational Closure

**Files:**
- Modify: `README.md`
- Modify: `ENGINEERING_LOG.md`
- Modify: `todolist.md`

- [ ] Confirm `main` and `origin/main` match, the worktree is clean, and the running app version matches `package.json`.
- [ ] Confirm app, maintenance, and Caddy containers are running with no new startup errors.
- [ ] Confirm no Prisma migration, MySQL data write, Docker volume removal, NAS/COS path change, or backup-scope change occurred.
- [ ] Record residual risk if an upstream package cannot safely reach zero audit findings.
