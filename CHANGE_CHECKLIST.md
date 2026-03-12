# Engineering Change Checklist

This file defines what must be done together when the project changes.

The goal is simple:
- avoid one-sided changes
- keep code, docs, tests, version, docker, and git in sync
- make future maintenance predictable

## 1. Rules That Apply To Any Change

Every non-trivial change should check these items:
- decide whether the new rule or threshold should be configurable in `Settings`
- decide whether the change belongs in `service / transaction / audit / catalog` instead of route or page code
- update or add automated tests before relying on manual verification
- update `README.md`
- update `todolist.md`
- commit and push to git
- if the local service is already running and the change affects the running app, rebuild the local service

Minimum expectation by change type:
- backend or API change: API or service-level automated tests
- frontend interaction change: automated browser check or targeted hook/component test
- data/migration change: isolated DB/API verification

## 2. If Business Logic Changes

Examples:
- matching logic
- ownership or visibility rules
- status transitions
- deletion or approval rules
- import behavior

Must do:
- keep logic in `src/lib/*-service.ts` or other reusable domain layer, not only inside route/page files
- add or update `ApiError` / success catalog entries if request semantics change
- add or update transaction boundaries when the change touches multiple tables
- add or update audit logging when the change affects important state
- add service/unit tests
- add isolated API regression tests
- update README behavior notes
- update `todolist.md`

Should also do:
- check whether thresholds, switches, or strategy choices belong in `/api/settings`

## 3. If A New Module Is Added

Examples:
- a new workspace page
- a new manager-only module
- a new review queue

Must do:
- add route entry
- add sidebar visibility rule if needed
- follow module structure:
  - `components/`
  - `hooks/`
  - `types.ts`
  - optional `view-model.ts` or `read-model.ts`
- keep page or manager files as orchestration only
- add i18n strings for Chinese and English
- add module-level automated tests
- if the module has critical workflow UI, add a stable Playwright case
- update README and `todolist.md`

## 4. If A Page Or Interaction Changes

Examples:
- loading state
- navigation UX
- dialog behavior
- filters
- tables

Must do:
- check accessibility basics: labels, ids, deterministic selectors for automation
- keep loading states local; avoid blank-page fallback if a partial loading state can be used
- add hook/component tests for state transitions when possible
- add or update Playwright checks for critical paths
- if the change affects navigation or first-load speed, verify both first click and second click behavior
- update README and `todolist.md`

## 5. If API Contract Changes

Examples:
- response shape
- error code
- success summary
- import result structure

Must do:
- standardize through shared response helpers, not ad hoc route strings
- update frontend consumption to prefer stable `code/message/detail`
- add contract-style tests or regression assertions
- update docs that describe the API shape or UI expectations
- update README and `todolist.md`

## 6. If Database / Prisma / Migration Changes

Examples:
- schema field change
- new table
- new index
- migration for ownership or audit

Must do:
- keep migration compatible with existing environments when possible
- prefer idempotent or backward-safe rollout if the project already has live data
- ensure service layer writes remain transactional
- test against isolated DB/API environment
- document rollout risk and recovery notes in README if needed
- update `todolist.md`

Do not do casually:
- destructive resets on the active data service
- direct edits that bypass migration history

## 7. If Settings / Configuration Changes

Examples:
- new threshold
- new toggle
- export limits
- OCR settings

Must do:
- define default value and validation rule
- expose read/write through settings service boundaries
- add audit logging with actor and before/after values when the setting is mutable
- add tests for valid, invalid, and boundary values
- update settings UI if the value should be user-editable
- update README and `todolist.md`

## 8. If Import / Export Logic Changes

Examples:
- customer import
- invoice import
- report export
- settings audit export

Must do:
- keep per-row or per-batch result summary stable
- prefer resumable or retryable failure handling
- keep templates and UI prompts in sync
- add isolated API tests for success, failure, and edge rows
- add browser test only for critical user-facing workflow confirmation
- update README and `todolist.md`

## 9. If The Change Is Documentation-Only

Examples:
- typo fix
- explanation improvement
- process note

Minimum:
- update the relevant docs
- commit and push

Usually not required:
- docker rebuild
- full test suite
- version bump

If the documentation changes an operational rule that developers must follow, also update:
- `README.md`
- this checklist
- `todolist.md`

## 10. Version, Git, CI, Local Service

If the change affects code, behavior, tests, runtime, or operations:
- bump `package.json#version`
- keep frontend version display consistent with that single source
- run the required automated checks
- commit to git
- push to `origin/main`
- check GitHub Actions status
- rebuild local running service if the local app should reflect the new version immediately

Recommended verification ladder:
1. `npx tsc --noEmit`
2. `npm run lint`
3. targeted tests for changed area
4. `npm run test:ci`
5. `npm run build`
6. `docker compose up -d --build` when local service must be updated

## 11. Practical Default For Future Changes

When unsure, use this default bundle:
- code change
- automated test
- README update
- `todolist.md` update
- version bump
- git commit + push
- CI check
- local service rebuild if the user is actively using the local app
