# Production Dependency Security Maintenance

Status: ACTIVE. Scope is the six production audit entries reported during v1.0.225 deployment.

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

## Sources

- https://github.com/advisories/GHSA-vcvr-r3jv-pc5j
- https://github.com/advisories/GHSA-ggr8-5vv4-36mx
- https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0
- https://github.com/advisories/GHSA-68fv-2mgg-jv7q
