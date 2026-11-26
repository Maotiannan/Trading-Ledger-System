Maintain one long-lived branch, `main`. Open short-lived PR branches from the current main, require CI, and delete them after merge. A PR is not permission to deploy. Never commit site-specific overrides, credentials, customer data, media, or incident recovery material.

## Essential commands

- Use Node 22 and npm (`npm ci`, `package-lock.json`). Run targeted Jest tests first. CI runs `npm run test:ci`: typecheck, lint, unit/coverage, isolated API, browser and database reliability suites. Use clean test directories, synthetic data, separate ports and volumes, and disable external sending.
- Approval or financial transaction changes require `npm run test:reliability:isolated`. Keep the decision, business mutation and strict audit in one transaction; test conflicting writers, concurrent reviewers and audit rollback.
- Before any authorized local release, run `bash scripts/rebuild-local-app.sh --check-only` from the maintained main checkout. A refusal is a stop, not permission to use raw Compose or change the version. Follow the active private deployment record and the [fixed-image guide](docs/pinned-site-release.md). A backup job's checkout is not evidence of the deployed source. Report stage, exit code, sanitized output/logs, and database/volume/NAS impact on failure.
- For persistence, retention or scheduler changes, follow the [backup and recovery runbook](docs/backup/muledger-local-backup.md). Keep frozen releases, historical checkouts and shared Git metadata intact. Keep credentials, site overrides, cutover/rollback evidence and real snapshots outside Git.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
