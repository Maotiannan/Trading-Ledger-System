# Production Dependency Security Maintenance

Status: ARCHIVED_COMPLETED. Scope is the six production audit entries reported during v1.0.225 deployment.

## Findings And Changes

- `next` 16.3.4 -> 16.3.8, with matching `eslint-config-next`: GHSA-vcvr-r3jv-pc5j affects Node `next/og` ImageResponse with attacker-controlled SVG. No application import of that API was found; update the installed vulnerable component anyway.
- `brace-expansion` 1.1.18 -> 1.1.21 and 2.1.4 -> 2.1.7 (5.0.9 -> 5.0.12 in development chains): recursive/quadratic expansion denial of service, including GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7 and GHSA-6j4f-fj2g-mc7p. Production chain includes ExcelJS archiver/readdir-glob; retain compatible major versions.
- `source-map-js` 1.2.1 -> 1.2.2: GHSA-68fv-2mgg-jv7q, indexed source-map offsets causing denial of service. Used by PostCSS; no customer source-map ingestion found.
- `prisma -> @prisma/config -> deepmerge-ts` accounts for three entries, not three independent attack paths. Keep Prisma/client 6.19.3 and scope an exact deepmerge-ts 8.0.0 override to `@prisma/config@6.19.3`. GHSA-ggr8-5vv4-36mx is reproduced as RangeError with circular inputs on 7.1.5 and resolved by 8.0.0.

## Scoped Override Rationale

Prisma 6.19.3 configuration uses only the named `deepmerge` export through its local c12 loader, with remote extension disabled. This repository has no custom Prisma configuration, Map-valued configuration or direct deepmerge imports. Version 8 changes deep Map merging, type aliases and deepmergeInto mutation behavior; these are not used by the project. Tests cover plain objects/arrays, circular graphs and the real Prisma configuration loader with temporary files. Do not copy this override to unrelated consumers. Reassess/remove it when upgrading Prisma.

The September decision not to force a global incompatible override is preserved: this is a newly validated, narrowly scoped exception, not an automatic audit-force upgrade or Prisma downgrade.

## Validation And Release Gates

- Production audit after installation: zero findings. Development-inclusive audit still reports 38 entries; these are not included in the production image and are outside this six-entry remediation. Do not describe all dependency scopes as clean.
- Regression tests: `scripts/production-dependency-security.test.ts`.
- Run Prisma validate/generate, typecheck, lint, full unit tests, isolated API/browser regression, production image build and container smoke checks.
- Review dependency-only diff, push PR, wait for CI, merge and wait for main CI before safe local rebuild.
- No business code, schema, migrations, storage paths or sending switches changed. Existing database/media backup scope remains unchanged.
- Rollback restores the prior application image/code and lockfile; no database restoration is necessary.

## Release Evidence

- PR #44 merged as `2e80245`; PR CI `37459113183` and main CI `37472673677` passed.
- Local verification: 235 suites / 1558 tests, Prisma validate/generate, typecheck and lint passed. CI also ran isolated API and browser suites.
- Deployed v1.0.226 with Next.js 16.3.8. Production-pruned image audit reported zero vulnerabilities. Network-disabled, unmounted candidate smoke check passed (home 200, unauthenticated health 401, real Prisma configuration validation).
- Initial Docker npm downloads repeatedly failed with ECONNRESET (exit 1), including proxy retries. Failed builds did not replace the running application or touch business storage. Recovery seeded BuildKit's npm cache from the host's `_cacache`, retained lockfile integrity verification, and fetched remaining Linux dependencies via the existing proxy.
- The temporary Dockerfile changed only installation network/cache options. A temporary Compose build override supplied that Dockerfile and cache context to the existing `scripts/rebuild-local-app.sh`; no production environment or repository Dockerfile was changed. Final safe rebuild completed successfully.
- Runtime verification: public HTTP 200, maintenance/sync endpoint checks passed, no pending migrations, existing NAS upload mount unchanged. Database/media backup scope unchanged.
- Rebuild logs on the deployment host: `/tmp/muledger-rebuild-dependency-security.log` (failed), `/tmp/muledger-security-seeded.log` (successful candidate), `/tmp/muledger-security-deploy-final.log` (successful deployment). Development-only findings remain separate backlog; do not claim zero findings for the full development dependency tree.

## Advisory References

- https://github.com/advisories/GHSA-vcvr-r3jv-pc5j
- https://github.com/advisories/GHSA-ggr8-5vv4-36mx
- https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0
- https://github.com/advisories/GHSA-68fv-2mgg-jv7q
