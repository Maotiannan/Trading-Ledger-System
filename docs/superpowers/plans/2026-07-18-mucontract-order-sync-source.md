# MU Contract Order Feed Implementation Plan

> **Status:** ARCHIVED_COMPLETED; the source feed, migration, historical projection initialization, and service deployment are live, and MULEDGER consumption was enabled on 2026-07-19.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a durable, authenticated, read-only PI order event and snapshot feed that MULEDGER can consume without reading drafts or coupling to MU Contract's database.

**Architecture:** MU Contract persists one current projection per hidden PI ID and one append-only event outbox. Existing PI save/delete/formal-generation transactions update the projection and outbox atomically. A dedicated FastAPI module serves bearer-authenticated cursor and snapshot pages; an idempotent management command seeds historical projections from existing PI records and latest successful formal snapshots.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, PostgreSQL 16, SQLite unit tests, pytest/httpx.

## Global Constraints

- Work only in an isolated MU Contract worktree and branch created from current `origin/main`.
- Do not start, rebuild, migrate, or modify the existing production Docker services, PostgreSQL volume, Redis volume, or storage volume.
- `BusinessPiRecord.id` is stable source identity; ORDER NO is a mutable business key.
- Emit events only for first valid ORDER NO, ORDER NO rename, successful formal PDF generation/regeneration, and PI delete/unlink.
- Draft autosave may update `BusinessPiRecord.total_amount` but must not update official synchronized amount.
- Official amount comes only from the successful `_persist_formal_pi_generation` snapshot and is serialized as a two-decimal string.
- Projection and outbox write in the same transaction as the PI operation; no outbound network call occurs in that transaction.
- The new bearer token is `MULEDGER_ORDER_SYNC_TOKEN`, distinct from the existing `MULEDGER_SYNC_TOKEN` client credential.
- Event timestamps are UTC strings ending in `Z`; cursors are decimal strings in JSON.
- Event page limit is `1..500`; all responses use `Cache-Control: no-store`.
- Source outbox and tombstone projections are durable and receive no cleanup task in version 1.
- Additive migration only. Update PostgreSQL backup/restore documentation and run migrations only against disposable databases during development.
- Open and push a MU Contract PR for review; do not merge it.

---

## File Structure

- `apps/api/src/mu_contract_api/modules/muledger_order_feed/models.py`: projection and append-only outbox models.
- `apps/api/src/mu_contract_api/modules/muledger_order_feed/schemas.py`: version-1 response types.
- `apps/api/src/mu_contract_api/modules/muledger_order_feed/service.py`: transactional projection/event writer and page readers.
- `apps/api/src/mu_contract_api/modules/muledger_order_feed/auth.py`: constant-time dedicated-token dependency.
- `apps/api/src/mu_contract_api/modules/muledger_order_feed/router.py`: read-only event and snapshot endpoints.
- `apps/api/src/mu_contract_api/modules/muledger_order_feed/backfill.py`: historical dry-run/apply service.
- `apps/api/src/mu_contract_api/scripts/backfill_muledger_order_projection.py`: CLI.
- Existing `real_flow/service.py`: only lifecycle hook calls, no feed HTTP behavior.
- Shared contract schema and fixtures: exact copies of MULEDGER version-1 artifacts.

### Task 1: Add Projection/Outbox Models and Alembic Migration

**Files:**
- Create: `apps/api/src/mu_contract_api/modules/muledger_order_feed/__init__.py`
- Create: `apps/api/src/mu_contract_api/modules/muledger_order_feed/models.py`
- Create: `apps/api/migrations/versions/20260718_0048_muledger_order_feed.py`
- Modify: `apps/api/migrations/env.py`
- Create: `apps/api/tests/test_muledger_order_feed_migration.py`

**Interfaces:**
- Consumes: `BusinessPiRecord.id` as an unconstrained stable string reference, allowing tombstones after PI deletion.
- Produces: `MuLedgerOrderProjection` and `MuLedgerOrderEvent` SQLAlchemy models.

- [ ] **Step 1: Write a failing migration/model test**

```py
def test_feed_tables_hold_nullable_official_amount_and_monotonic_cursor(sqlite_session):
    projection = MuLedgerOrderProjection(
        source_pi_id="pi-1",
        source_version=1,
        order_no="AB-12",
        normalized_order_no="AB-12",
        pi_created_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
        official_amount=None,
        currency=None,
        official_generated_at=None,
        official_generation_run_id=None,
        active=True,
        source_deleted_at=None,
        updated_at=datetime.now(timezone.utc),
    )
    sqlite_session.add(projection)
    sqlite_session.commit()
    assert sqlite_session.get(MuLedgerOrderProjection, "pi-1").official_amount is None
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd apps/api && ../../.venv/bin/python -m pytest tests/test_muledger_order_feed_migration.py -q`

Expected: FAIL because the module and tables do not exist.

- [ ] **Step 3: Implement SQLAlchemy models**

```py
class MuLedgerOrderProjection(Base):
    __tablename__ = "muledger_order_projections"

    source_pi_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source_version: Mapped[int] = mapped_column(Integer, nullable=False)
    order_no: Mapped[str | None] = mapped_column(String(128), nullable=True)
    normalized_order_no: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    pi_created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    official_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(16), nullable=True)
    official_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    official_generation_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    source_deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

class MuLedgerOrderEvent(Base):
    __tablename__ = "muledger_order_events"

    cursor: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)
    source_pi_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    source_version: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
```

Do not add a foreign key from projection/event to `business_pi_records`; tombstones must survive PI deletion.

- [ ] **Step 4: Write additive Alembic upgrade/downgrade**

Create both tables, unique event ID, source/event/time indexes, numeric official amount, timezone-aware timestamps, and no changes to existing business rows. Import the model module in `migrations/env.py`.

- [ ] **Step 5: Validate migration SQL and tests**

Run:

```bash
cd apps/api
MU_CONTRACT_DATABASE_URL=sqlite:////tmp/mu-contract-feed-migration.sqlite ../../.venv/bin/python -m alembic -c alembic.ini upgrade head
../../.venv/bin/python -m pytest tests/test_muledger_order_feed_migration.py -q
```

Expected: PASS and both tables exist in the disposable SQLite file.

- [ ] **Step 6: Commit schema slice**

```bash
git add apps/api/src/mu_contract_api/modules/muledger_order_feed apps/api/migrations apps/api/tests/test_muledger_order_feed_migration.py
git commit -m "feat(sync): add durable MULEDGER order feed tables"
```

### Task 2: Define the Shared Version-1 Contract

**Files:**
- Create: `apps/api/src/mu_contract_api/modules/muledger_order_feed/schemas.py`
- Create: `apps/api/tests/test_muledger_order_feed_contract.py`
- Create: `docs/integrations/muledger-order-sync-v1.schema.json`
- Create: `apps/api/tests/fixtures/muledger-order-sync/formal-generated.json`
- Create: `apps/api/tests/fixtures/muledger-order-sync/deactivated.json`

**Interfaces:**
- Consumes: projection/event model values.
- Produces: `MuLedgerOrderEventPage` and `MuLedgerOrderSnapshotPage` Pydantic responses matching MULEDGER fixtures byte-for-field.

- [ ] **Step 1: Copy the approved JSON Schema and fixtures from the MULEDGER plan branch**

The copied files must preserve `schemaVersion: 1`, decimal strings, cursor strings, UTC `Z` timestamps, all event/reason enums, nullable `officialAmount`, and `generationRunId`.

- [ ] **Step 2: Write failing schema serialization tests**

```py
def test_event_page_serializes_cursor_as_string_and_utc_z():
    page = MuLedgerOrderEventPage.model_validate_json(FORMAL_FIXTURE.read_text())
    assert page.events[0].cursor == "1042"
    assert page.events[0].occurredAt.endswith("Z")
    assert page.events[0].officialAmount.value == "30040.00"
```

- [ ] **Step 3: Run and confirm failure**

Run: `cd apps/api && ../../.venv/bin/python -m pytest tests/test_muledger_order_feed_contract.py -q`

Expected: FAIL because schemas are missing.

- [ ] **Step 4: Implement strict Pydantic response models**

```py
class MuLedgerOrderSource(BaseModel):
    system: Literal["MU_CONTRACT"] = "MU_CONTRACT"
    piId: str = Field(min_length=1, max_length=64)
    version: int = Field(ge=1)

class MuLedgerOfficialAmount(BaseModel):
    currency: str = Field(min_length=1, max_length=16)
    value: str = Field(pattern=r"^-?\d+\.\d{2}$")
    generatedAt: str
    generationRunId: str = Field(min_length=1, max_length=64)
```

Use aliases exactly as the JSON contract. Validators reject timestamps not ending in `Z` and inconsistent active/deleted combinations.

- [ ] **Step 5: Run contract tests**

Run: `cd apps/api && ../../.venv/bin/python -m pytest tests/test_muledger_order_feed_contract.py -q`

Expected: PASS.

- [ ] **Step 6: Commit contract**

```bash
git add apps/api/src/mu_contract_api/modules/muledger_order_feed/schemas.py apps/api/tests/test_muledger_order_feed_contract.py apps/api/tests/fixtures docs/integrations
git commit -m "feat(sync): define MULEDGER order feed contract"
```

### Task 3: Transactional Projection and Event Writer

**Files:**
- Create: `apps/api/src/mu_contract_api/modules/muledger_order_feed/service.py`
- Create: `apps/api/tests/test_muledger_order_feed_service.py`

**Interfaces:**
- Consumes: an existing SQLAlchemy `Session`, `BusinessPiRecord`, formal snapshot, and lifecycle reason.
- Produces: `record_pi_order_change`, `record_formal_pi_generation`, `record_pi_deactivation`, `list_order_events`, and `list_order_snapshot`.

- [ ] **Step 1: Write failing transactional service tests**

```py
def test_first_order_link_creates_projection_and_event_in_one_session(session):
    record_pi_order_change(
        session,
        pi_id="pi-1",
        previous_order_no="",
        order_no="AB-12",
        pi_created_at=UTC_NOW,
        occurred_at=UTC_NOW,
    )
    projection = session.get(MuLedgerOrderProjection, "pi-1")
    event = session.scalar(select(MuLedgerOrderEvent))
    assert projection.source_version == event.source_version == 1
    assert event.event_type == "PI_ORDER_LINKED"
```

Add rollback, rename, formal regeneration, deactivation tombstone, ordered exclusive cursor, snapshot high-watermark, decimal formatting, and stale projection tests.

- [ ] **Step 2: Run and confirm failure**

Run: `cd apps/api && ../../.venv/bin/python -m pytest tests/test_muledger_order_feed_service.py -q`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement projection/event functions**

```py
def record_pi_order_change(
    session: Session,
    *,
    pi_id: str,
    previous_order_no: str | None,
    order_no: str | None,
    pi_created_at: datetime,
    occurred_at: datetime,
) -> MuLedgerOrderEvent | None:
    """Emit only first non-empty link, normalized rename, or unlink."""

def record_formal_pi_generation(
    session: Session,
    *,
    record: BusinessPiRecord,
    snapshot: dict[str, Any],
    workflow_run_id: str,
    generated_at: datetime,
) -> MuLedgerOrderEvent:
    """Use snapshot total_amount/currency, never record.total_amount after draft save."""
```

Lock projection rows with SQLAlchemy `select(MuLedgerOrderProjection).where(MuLedgerOrderProjection.source_pi_id == pi_id).with_for_update()`, increment source version once per event, build a complete snapshot payload, flush projection before outbox insert, and let the caller own commit/rollback.

- [ ] **Step 4: Implement read pages**

`list_order_events(session, after: int | None, limit: int)` orders by cursor ascending and returns `limit+1` to compute `hasMore`. `list_order_snapshot(session, after: str | None, limit: int)` orders by immutable PI ID and returns the current maximum event cursor as `eventHighWatermark` on every page.

- [ ] **Step 5: Run service tests**

Run: `cd apps/api && ../../.venv/bin/python -m pytest tests/test_muledger_order_feed_service.py -q`

Expected: PASS.

- [ ] **Step 6: Commit writer/service**

```bash
git add apps/api/src/mu_contract_api/modules/muledger_order_feed/service.py apps/api/tests/test_muledger_order_feed_service.py
git commit -m "feat(sync): write PI order events transactionally"
```

### Task 4: Hook the Existing PI Lifecycle Without Emitting Draft Amounts

**Files:**
- Modify: `apps/api/src/mu_contract_api/modules/real_flow/service.py`
- Modify: `apps/api/tests/test_real_business_flow.py`
- Create: `apps/api/tests/test_muledger_order_feed_lifecycle.py`

**Interfaces:**
- Consumes: feed writer functions from Task 3.
- Produces: source events from existing PI save, formal generation, and delete transactions.

- [ ] **Step 1: Write failing lifecycle regression tests**

```py
def test_draft_amount_edit_does_not_change_official_projection(session_factory):
    save_pi_record(initial_draft, session_factory=session_factory)
    generate_pi_file(formal_request, session_factory=session_factory, storage=storage, settings=settings)
    save_pi_record(changed_amount_draft, session_factory=session_factory)
    with session_factory() as session:
        projection = session.get(MuLedgerOrderProjection, formal_request.workflow_run_id)
        assert projection.official_amount == Decimal("30040.00")
        assert session.scalar(select(func.count()).select_from(MuLedgerOrderEvent)) == 2
```

Also test first ORDER NO, rename, same-order autosave no event, failed PDF no formal event, successful regeneration event, direct first generation, delete tombstone, and transaction rollback.

- [ ] **Step 2: Run and confirm failure**

Run: `cd apps/api && ../../.venv/bin/python -m pytest tests/test_muledger_order_feed_lifecycle.py -q`

Expected: FAIL because lifecycle hooks are absent.

- [ ] **Step 3: Hook `_save_pi_record_in_session`**

Capture `previous_order_no` before mutation, use the resolved `record.id`, flush the record, then call:

```py
record_pi_order_change(
    session,
    pi_id=record.id,
    previous_order_no=previous_order_no,
    order_no=record.order_no,
    pi_created_at=record.created_at,
    occurred_at=timestamp,
)
```

The writer returns `None` for ordinary same-order autosave. It does not inspect draft totals.

- [ ] **Step 4: Hook `_persist_formal_pi_generation`**

After `_save_pi_record_in_session`, load the resolved `BusinessPiRecord` and call `record_formal_pi_generation` with the rendered `snapshot`, `payload.workflow_run_id`, and `now` inside the same `session_scope`.

- [ ] **Step 5: Hook `delete_pi_record`**

Before deleting `BusinessWorkflowRun` and `BusinessPiRecord`, call `record_pi_deactivation` with reason `PI_DELETED`, last ORDER NO, PI creation time, and current UTC time. The projection survives because it has no PI foreign key.

- [ ] **Step 6: Run lifecycle and existing real-flow tests**

Run:

```bash
cd apps/api
../../.venv/bin/python -m pytest tests/test_muledger_order_feed_lifecycle.py tests/test_real_business_flow.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit lifecycle hooks**

```bash
git add apps/api/src/mu_contract_api/modules/real_flow/service.py apps/api/tests/test_real_business_flow.py apps/api/tests/test_muledger_order_feed_lifecycle.py
git commit -m "feat(real-flow): publish durable PI order events"
```

### Task 5: Dedicated Authentication and Read-Only FastAPI Endpoints

**Files:**
- Modify: `apps/api/src/mu_contract_api/core/config.py`
- Create: `apps/api/src/mu_contract_api/modules/muledger_order_feed/auth.py`
- Create: `apps/api/src/mu_contract_api/modules/muledger_order_feed/router.py`
- Modify: `apps/api/src/mu_contract_api/main.py`
- Create: `apps/api/tests/test_muledger_order_feed_api.py`

**Interfaces:**
- Consumes: `Settings.muledger_order_sync_token`, session factory, service readers.
- Produces: `GET /integrations/muledger/order-events` and `GET /integrations/muledger/order-snapshot`.

- [ ] **Step 1: Write failing authentication/API tests**

```py
def test_event_feed_requires_dedicated_token(client):
    assert client.get("/integrations/muledger/order-events").status_code == 401
    response = client.get(
        "/integrations/muledger/order-events?after=0&limit=100",
        headers={"Authorization": "Bearer order-feed-secret"},
    )
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
```

Test that the old `MULEDGER_SYNC_TOKEN` is rejected, invalid cursor is 400, limit 501 is 422, cursor order is stable, and responses contain no token.

- [ ] **Step 2: Run and confirm failure**

Run: `cd apps/api && ../../.venv/bin/python -m pytest tests/test_muledger_order_feed_api.py -q`

Expected: FAIL because route/config are absent.

- [ ] **Step 3: Add dedicated config**

```py
muledger_order_sync_token: str = Field(
    default="",
    validation_alias=AliasChoices(
        "MU_CONTRACT_MULEDGER_ORDER_SYNC_TOKEN",
        "MULEDGER_ORDER_SYNC_TOKEN",
    ),
)
```

An empty token disables the endpoints with `503`; it must never fall back to `muledger_sync_token`.

- [ ] **Step 4: Implement constant-time auth and routes**

Use `secrets.compare_digest`. Accept only `Authorization: Bearer <token>`. Add `Cache-Control: no-store` to success and error responses. Router prefix is `/integrations/muledger` and tags are `muledger-order-feed`.

- [ ] **Step 5: Register router and run tests**

Run: `cd apps/api && ../../.venv/bin/python -m pytest tests/test_muledger_order_feed_api.py tests/test_health.py -q`

Expected: PASS.

- [ ] **Step 6: Commit API**

```bash
git add apps/api/src/mu_contract_api/core/config.py apps/api/src/mu_contract_api/modules/muledger_order_feed apps/api/src/mu_contract_api/main.py apps/api/tests/test_muledger_order_feed_api.py
git commit -m "feat(api): expose authenticated MULEDGER order feed"
```

### Task 6: Idempotent Historical Projection Preview/Apply Tool

**Files:**
- Create: `apps/api/src/mu_contract_api/modules/muledger_order_feed/backfill.py`
- Create: `apps/api/src/mu_contract_api/scripts/backfill_muledger_order_projection.py`
- Create: `apps/api/tests/test_muledger_order_projection_backfill.py`

**Interfaces:**
- Consumes: existing PI records and successful `BusinessWorkflowRun` snapshots.
- Produces: dry-run/apply JSON report and projection rows at source version 1 without fabricated events.

- [ ] **Step 1: Write failing dry-run/apply/idempotency tests**

```py
def test_backfill_uses_formal_snapshot_not_later_draft_total(session_factory):
    report = backfill_muledger_order_projection(session_factory, apply=True)
    with session_factory() as session:
        projection = session.get(MuLedgerOrderProjection, "pi-1")
        assert projection.official_amount == Decimal("30040.00")
        assert session.scalar(select(func.count()).select_from(MuLedgerOrderEvent)) == 0
    assert report.created == 1
```

Also prove dry-run writes nothing, rerun reports `created: 0`, live projection wins, blank ORDER NO becomes inactive, and missing formal run leaves amount null.

- [ ] **Step 2: Run and confirm failure**

Run: `cd apps/api && ../../.venv/bin/python -m pytest tests/test_muledger_order_projection_backfill.py -q`

Expected: FAIL because backfill is absent.

- [ ] **Step 3: Implement service and CLI**

```py
@dataclass
class MuLedgerProjectionBackfillReport:
    scanned: int = 0
    would_create: int = 0
    created: int = 0
    skipped_existing: int = 0
    would_enrich_existing: int = 0
    enriched_existing: int = 0
    without_formal_amount: list[str] = field(default_factory=list)

def backfill_muledger_order_projection(
    session_factory: sessionmaker[Session],
    *,
    apply: bool,
) -> MuLedgerProjectionBackfillReport:
    report = MuLedgerProjectionBackfillReport()
    with session_scope(session_factory) as session:
        records = session.scalars(
            select(BusinessPiRecord).order_by(BusinessPiRecord.created_at, BusinessPiRecord.id)
        ).all()
        for record in records:
            report.scanned += 1
            run = session.get(BusinessWorkflowRun, record.id)
            formal_snapshot = run.snapshot if run is not None and run.status == "generated" else None
            amount = official_amount_from_snapshot(formal_snapshot)
            if amount is None:
                report.without_formal_amount.append(record.id)
            existing = session.get(MuLedgerOrderProjection, record.id)
            if existing is not None:
                if amount is not None and existing.official_amount is None:
                    report.would_enrich_existing += 1
                    if apply:
                        enrich_missing_official_amount(
                            projection=existing,
                            formal_snapshot=formal_snapshot,
                            official_amount=amount,
                        )
                        report.enriched_existing += 1
                else:
                    report.skipped_existing += 1
                continue
            report.would_create += 1
            if not apply:
                continue
            session.add(
                projection_from_historical_pi(
                    record=record,
                    formal_snapshot=formal_snapshot,
                    official_amount=amount,
                )
            )
            report.created += 1
    return report
```

The apply path uses insert-if-absent semantics. For an existing live projection it may fill only still-null official amount/currency/generated-at/run-ID fields from a proven successful historical run; it never changes live ORDER NO, active state, version, or an existing official amount. It never inserts an outbox event. CLI defaults to dry-run, accepts `--apply --json`, and exits nonzero only for structural errors.

- [ ] **Step 4: Run service and CLI tests**

Run:

```bash
cd apps/api
../../.venv/bin/python -m pytest tests/test_muledger_order_projection_backfill.py -q
PYTHONPATH=src MU_CONTRACT_DATABASE_URL=sqlite:////tmp/mu-contract-feed-backfill.sqlite ../../.venv/bin/python -m mu_contract_api.scripts.backfill_muledger_order_projection --json
```

Expected: PASS and valid JSON dry-run output.

- [ ] **Step 5: Commit backfill**

```bash
git add apps/api/src/mu_contract_api/modules/muledger_order_feed/backfill.py apps/api/src/mu_contract_api/scripts/backfill_muledger_order_projection.py apps/api/tests/test_muledger_order_projection_backfill.py
git commit -m "feat(sync): add historical PI projection backfill"
```

### Task 7: Environment, Backup Documentation, Version, Full Gates, and PR

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `docs/engineering/mu-ledger-interface-requests.md`
- Modify: `docs/engineering/modules/sync-i18n.md`
- Modify: `docs/operations/backup-and-restore.md`
- Modify: `docs/engineering/final-delivery-summary.md`
- Modify: `docs/engineering/README.md`
- Modify: `README.md`
- Modify: `VERSION`
- Modify: `apps/api/pyproject.toml`
- Modify: `apps/web/package.json`
- Modify: `apps/web/package-lock.json`
- Regenerate: `apps/web/src/lib/generatedVersion.ts`

**Interfaces:**
- Consumes: complete source implementation.
- Produces: deployable but not merged PR, version `0.1.242`, backup/runbook updates, and CI evidence.

- [ ] **Step 1: Wire environment-only dedicated token**

Add `MULEDGER_ORDER_SYNC_TOKEN=` to `.env.example` with no default secret. Pass it to API as `MU_CONTRACT_MULEDGER_ORDER_SYNC_TOKEN: ${MULEDGER_ORDER_SYNC_TOKEN:-}`. Do not replace or reuse existing `MULEDGER_SYNC_TOKEN`.

- [ ] **Step 2: Update engineering and backup docs**

Document endpoints, event triggers, no draft amount, source identity, backfill dry-run/apply, no event cleanup, deployment order, and token separation. Add both PostgreSQL tables to restore checks and state that no storage path is added.

- [ ] **Step 3: Add isolated migration/restore commands**

Document and run only against disposable PostgreSQL/SQLite during development:

```bash
cd apps/api
MU_CONTRACT_DATABASE_URL=sqlite:////tmp/mu-contract-order-feed.sqlite ../../.venv/bin/python -m alembic -c alembic.ini upgrade head
PYTHONPATH=src MU_CONTRACT_DATABASE_URL=sqlite:////tmp/mu-contract-order-feed.sqlite ../../.venv/bin/python -m mu_contract_api.scripts.backfill_muledger_order_projection --json
```

Before production deploy, require a fresh PostgreSQL dump, isolated restore, migration, backfill preview, and table verification. Do not perform production-derived restore/migration in this PR task.

- [ ] **Step 4: Bump the single source version to `0.1.242`**

Update `VERSION`, API/Web package metadata, run `node apps/web/scripts/sync-version.mjs`, and update concise README/current engineering summary.

- [ ] **Step 5: Run focused and full release gates**

Run:

```bash
cd apps/api
../../.venv/bin/python -m pytest tests/test_muledger_order_feed_contract.py tests/test_muledger_order_feed_service.py tests/test_muledger_order_feed_lifecycle.py tests/test_muledger_order_feed_api.py tests/test_muledger_order_projection_backfill.py -q
../../.venv/bin/python -m pytest -q
cd ../..
npm --prefix apps/web test
npm --prefix apps/web run build
.venv/bin/python scripts/check-version-single-source.py
docker compose config --quiet
git diff --check
```

Expected: every command exits 0. Do not run tests against production Postgres or storage.

- [ ] **Step 6: Sync current main and rerun focused gates**

```bash
git fetch origin main
git rebase origin/main
cd apps/api && ../../.venv/bin/python -m pytest tests/test_muledger_order_feed_contract.py tests/test_muledger_order_feed_service.py tests/test_muledger_order_feed_lifecycle.py tests/test_muledger_order_feed_api.py tests/test_muledger_order_projection_backfill.py -q
cd ../.. && .venv/bin/python scripts/check-version-single-source.py && docker compose config --quiet
```

Expected: PASS.

- [ ] **Step 7: Commit final documentation/version**

```bash
git add .env.example docker-compose.yml docs README.md VERSION apps/api/pyproject.toml apps/web/package.json apps/web/package-lock.json apps/web/src/lib/generatedVersion.ts
git commit -m "docs(sync): document MULEDGER order feed rollout"
```

- [ ] **Step 8: Push branch and open PR without merging**

```bash
git push -u origin feat/muledger-order-feed
gh pr create --base main --head feat/muledger-order-feed --title "feat: publish MULEDGER PI order feed" --body-file /tmp/muledger-order-feed-pr.md
gh pr checks --watch
```

The PR body must list migration/backup risk, endpoint contract, token requirement, tests run, and deployment order. Stop after CI succeeds and report the PR URL; do not merge or deploy.
