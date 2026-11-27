Maintain one long-lived branch, `main`. Open short-lived PR branches from the current main, require CI, and delete them after merge. A PR is not permission to deploy. Never commit site-specific overrides, credentials, customer data, media, or incident recovery material.

## Essential commands

- Use Node 22 and npm (`npm ci`, `package-lock.json`). Run targeted Jest tests first. CI runs `npm run test:ci`: typecheck, lint, unit/coverage, isolated API, browser and database reliability suites. Use clean test directories, synthetic data, separate ports and volumes, and disable external sending.
- Approval or financial transaction changes require `npm run test:reliability:isolated`. Keep the decision, business mutation and strict audit in one transaction; test conflicting writers, concurrent reviewers and audit rollback.
- Before any authorized local release, run `bash scripts/rebuild-local-app.sh --check-only` from the maintained main checkout. A refusal is a stop, not permission to use raw Compose or change the version. Follow the active private deployment record and the [fixed-image guide](docs/pinned-site-release.md). A backup job's checkout is not evidence of the deployed source. Report stage, exit code, sanitized output/logs, and database/volume/NAS impact on failure.
- For persistence, retention or scheduler changes, follow the [backup and recovery runbook](docs/backup/muledger-local-backup.md). Keep frozen releases, historical checkouts and shared Git metadata intact. Keep credentials, site overrides, cutover/rollback evidence and real snapshots outside Git.

- Follow the [maintenance register](docs/maintenance.md); update affected live guides rather than a dated plan. Pin cross-project wire fixtures and run them offline and in isolated API CI. List task-owned resources before cleanup; keep shared resources, the active .next, release images and backup schedules unless individually authorized.

## Task resource inventory

From the task checkout: `python3 scripts/backup/task-resources.py --directory out/lab`. This read-only command lists registered Git worktrees, temp/build directories, offsite-labelled containers and volumes, and named volumes those containers reference. For a recovery drill, append its printed `--task TOKEN --directory PATH`. Without a token or checkout marker, Docker discovery is limited to the offsite label family.

At creation, reuse the exact task token in the private linked checkout and new scratch directories (`.muledger-offsite-task` file) and on Docker resources (`muledger.offsite.task` label). A filename, branch name or mount is not proof of ownership. Do not mark existing shared resources. Worktrees, directories and volumes are **always list-only**. Only an explicitly authorized `--clean --task TOKEN` can remove exactly labelled, exited containers with no non-tmpfs mounts.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
