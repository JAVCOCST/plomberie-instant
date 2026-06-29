# Orchestrator Governance — Phase 0 Foundation Plan

> **ARCHITECT MODE ONLY — NO CODE, NO MIGRATION CREATED, NO RUNTIME CHANGE, NO n8n CHANGE,
> NO ENFORCEMENT, NO BLOCKING POLICY.**
> This is a plan/specification handed to the principal Claude for *later* implementation.
> All SQL below is illustrative DDL *inside this document* — it is **not** a migration file
> and nothing is placed under `supabase/migrations/`.

Date: 2026-05-26 · Branch: `claude/quote-roofmodel-audit-aXRf5`
Parent: `docs/orchestrator-governance-architecture-v1.md` (validated target architecture)

---

## 0. Scope, intent & house conventions

**Phase 0 = foundations + audit only.** It creates a *passive substrate* that **records** what
the system and agents do (and what *would* have been decided), with **zero ability to block,
gate, throttle, kill, quarantine, or approve anything.** If Phase 0 were fully deployed and then
disabled, **no existing workflow would behave differently** — that is the acceptance bar.

**Grounding (verified):** the repo already uses Supabase as system of record and ships
`SECURITY DEFINER` functions with `SET search_path = public` (e.g.
`supabase/migrations/20260427130356_sync_status_soumission_schedule.sql`). Phase 0 mirrors that
exact style: `public.` schema, `CREATE … IF NOT EXISTS`, `LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public`, timestamped migration filenames.

**One invariant carried from v1:** *n8n is a conveyor, never an authority.* In Phase 0 this is
enforced socially/structurally — n8n may only **call the logging RPCs**; it can never insert into
governance tables directly and it never reads a "decision" it must obey (there are no binding
decisions in Phase 0).

---

## 1. Minimal tables

Eight candidate tables; **`workflow_lkg` is deferred** (see §1.8). All tables: `id uuid primary
key default gen_random_uuid()`, `created_at timestamptz not null default now()`. All are
**write-restricted to definer RPCs**; clients get **read-only or nothing** via RLS.

> Convention for every table below: `REVOKE INSERT/UPDATE/DELETE` from `anon`/`authenticated`;
> writes happen **only** through the Phase 0 RPCs (§2). This is the core safety property.

### 1.1 `agent_registry`
- **Objective:** catalog of known actors (master, sub-agents, n8n, human roles) so audit events
  can reference a stable `actor_id`. Descriptive only — **not** a permission source in Phase 0.
- **Columns:** `id`, `slug text unique not null`, `display_name text`,
  `actor_type text not null` (`master|subagent|n8n|human|system`), `status text not null default
  'active'` (`active|disabled` — *label only, no runtime effect*), `metadata jsonb not null
  default '{}'`, `created_at`, `updated_at timestamptz`.
- **Mandatory:** `slug`, `actor_type`.
- **JSONB:** `metadata` (free descriptive tags).
- **Indexes:** unique on `slug`; btree on `actor_type`.
- **RLS:** read for authenticated/service; **no client writes** (seed via RPC/migration only).
- **Do NOT add yet:** capabilities columns, parent/child hierarchy enforcement, token fields,
  trust scores.

### 1.2 `workflow_versions`
- **Objective:** immutable record of each workflow definition version (the thing that *would* be
  approved/activated later). Phase 0 just **registers** them.
- **Columns:** `id`, `workflow_key text not null`, `version int not null`,
  `definition jsonb not null`, `content_hash text not null`,
  `status text not null default 'registered'` (Phase 0 uses only `registered` — lifecycle states
  come in Phase 2, **label only**), `registered_by uuid` (→ `agent_registry`),
  `source_system text not null default 'unknown'`, `created_at`.
- **Mandatory:** `workflow_key`, `version`, `definition`, `content_hash`.
- **JSONB:** `definition` (opaque to Phase 0; never executed by it).
- **Indexes:** unique `(workflow_key, version)`; btree `content_hash`; btree `workflow_key`.
- **RLS:** read-only to authenticated; insert via RPC only; **no UPDATE/DELETE ever** (immutable).
- **Do NOT add yet:** `approved_by`, `activated_at`, lifecycle transitions, `lkg` pointer,
  validation results.

### 1.3 `workflow_runs`
- **Objective:** observability record of executions that actually happened (success or failure),
  for lineage and metrics. **Recording, not controlling.**
- **Columns:** `id`, `workflow_key text not null`, `workflow_version_id uuid` (→ versions),
  `run_id text not null` (external/n8n correlation id), `parent_run_id text`,
  `actor_id uuid` (→ registry), `status text not null` (`started|succeeded|failed|unknown`),
  `started_at timestamptz`, `ended_at timestamptz`, `metrics jsonb not null default '{}'`
  (duration, api_calls, est_cost_usd, tokens — **observed, not enforced**),
  `source_system text not null default 'unknown'`, `created_at`.
- **Mandatory:** `workflow_key`, `run_id`, `status`.
- **JSONB:** `metrics`.
- **Indexes:** unique `(run_id)`; btree `workflow_key`; btree `actor_id`; btree `started_at`.
- **RLS:** read to authenticated/service; insert/append via RPC only.
- **Do NOT add yet:** budget enforcement fields, quota counters used for blocking, breaker state.

### 1.4 `capability_grants`
- **Objective:** **descriptive inventory** of what capabilities exist / are notionally assigned —
  so shadow mode can answer "would this action have been allowed?" **It grants nothing at runtime
  in Phase 0.**
- **Columns:** `id`, `principal_id uuid` (→ registry), `action text not null`
  (e.g. `gmail.send`), `scope jsonb not null default '{}'`, `effect text not null default 'allow'`
  (`allow|deny`), `not_before timestamptz`, `not_after timestamptz`,
  `delegable boolean not null default false`, `source text not null default 'seed'`,
  `reason text`, `created_at`.
- **Mandatory:** `principal_id`, `action`, `effect`.
- **JSONB:** `scope` (resource_pattern/environment/runtime).
- **Indexes:** btree `(principal_id, action)`; btree `action`; partial on `not_after`.
- **RLS:** read to authenticated/service; **insert via definer RPC only**; **no UPDATE** (new row
  to change, immutable history); DELETE forbidden.
- **Do NOT add yet:** signatures/crypto, real elevation workflow, enforcement hooks, intersection
  computation at runtime. (These are Phase 1+.)

### 1.5 `policy_definitions`
- **Objective:** store policy *definitions* so shadow evaluation has something to evaluate
  against. **No policy is binding in Phase 0.**
- **Columns:** `id`, `policy_key text not null`, `version int not null`, `target text not null`
  (`global|role|workflow|agent`), `priority int not null default 100`,
  `rules jsonb not null`, `failure_mode text not null default 'fail_closed'` (*recorded
  intent only*), `status text not null default 'shadow'` (Phase 0: always `shadow`),
  `created_by uuid`, `created_at`.
- **Mandatory:** `policy_key`, `version`, `target`, `rules`.
- **JSONB:** `rules` (predicates/limits/requirements).
- **Indexes:** unique `(policy_key, version)`; btree `(target, priority)`.
- **RLS:** read to authenticated/service; insert via RPC/migration only; **no UPDATE/DELETE**
  (immutable versioning).
- **Do NOT add yet:** an actual evaluation engine that returns binding decisions, override
  tables, activation flags.

### 1.6 `approval_records`
- **Objective:** **record** approval decisions that humans make (today, manually/elsewhere) so we
  build the audit muscle. **Approvals gate nothing in Phase 0.**
- **Columns:** `id`, `subject_type text not null` (`workflow_version|capability|action`),
  `subject_id text not null`, `subject_hash text` (content hash bound to the decision),
  `decision text not null` (`approved|rejected|noted`), `risk_score int`,
  `approver_id uuid` (→ registry, must be `actor_type='human'`), `chain_stage int default 1`,
  `reason text`, `decided_at timestamptz not null default now()`, `created_at`.
- **Mandatory:** `subject_type`, `subject_id`, `decision`, `approver_id`.
- **JSONB:** none required (keep lean).
- **Indexes:** btree `(subject_type, subject_id)`; btree `approver_id`.
- **RLS:** read to authenticated/service; insert via RPC only; **no UPDATE/DELETE**.
- **Do NOT add yet:** multi-stage chain orchestration, escalation timers, dual-approval
  enforcement, break-glass. (Record-only now.)

### 1.7 `audit_events` (the heart of Phase 0 — see §3)
- **Objective:** single append-only, hash-chained log of everything.
- **Columns:** see §3.1.
- **Indexes:** btree `created_at`; btree `(resource_type, resource_id)`; btree `event_type`;
  btree `actor_id`; **unique `event_hash`**; btree `previous_hash`.
- **RLS:** read to authenticated/service; **insert via `log_audit_event` RPC only**; UPDATE/DELETE
  **revoked from everyone including service role** (enforced by trigger §3.2).

### 1.8 `workflow_lkg` — **DEFERRED, do not create in Phase 0**
- **Rationale:** LKG is a *recovery/activation* concept; it only has meaning once lifecycle +
  activation exist (Phase 2/3). Creating it now invites premature semantics with nothing to point
  at. If a placeholder is truly wanted, it is a **view/derivation** later, not a Phase 0 table.
- **Decision:** OUT of Phase 0.

---

## 2. Minimal `SECURITY DEFINER` RPCs

All RPCs: `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`, granted to
`authenticated`/`service_role` as appropriate, with **input validation** and **no dynamic SQL on
identifiers**. They are the **only** write path to governance tables. None of them returns a
binding decision; none blocks anything.

### 2.1 `log_audit_event(...)`
- **Input:** `actor_slug text, actor_type text, source_system text, event_type text,
  resource_type text, resource_id text, payload jsonb`.
- **Output:** `uuid` (event id) + `event_hash text`.
- **Validation:** non-null `event_type`/`actor_type`; `actor_type` in allowed enum;
  `payload` size cap (e.g. ≤ 64 KB) to prevent log bloat; resolve `actor_slug`→`actor_id`
  (insert unknown actor as `status='active', actor_type` if policy allows, else reject).
- **Behavior:** computes `previous_hash` = last row's `event_hash` (per chain), `event_hash` =
  digest(previous_hash ‖ canonical(payload+envelope)); inserts one row. **Append only.**
- **Rights required:** callable by `authenticated` + `service_role` (so n8n/edge functions can
  log). **Definer justified:** clients have no direct INSERT on `audit_events`; the RPC is the
  controlled choke point that computes the hash chain atomically.
- **Risks:** chain contention under concurrency (mitigate: per-chain advisory lock or serializable
  insert); oversized payloads (mitigate: size cap + redaction §3); PII leakage (mitigate:
  caller must pre-redact; RPC strips known secret keys).
- **Stays forbidden:** UPDATE/DELETE of events; computing decisions; calling external systems.

### 2.2 `register_workflow_version(...)`
- **Input:** `workflow_key text, version int, definition jsonb, source_system text,
  registered_by_slug text`.
- **Output:** `uuid` (version id) + `content_hash`.
- **Validation:** `(workflow_key, version)` unique; compute `content_hash` server-side from
  canonical `definition` (don't trust a client-supplied hash); reject if version already exists
  with a different hash (immutability guard).
- **Behavior:** insert row `status='registered'`; emit an `audit_events` row.
- **Definer justified:** enforces immutability + server-side hashing that clients can't bypass.
- **Risks:** huge `definition` payloads (size cap); hash canonicalization drift (pin a
  canonical-JSON routine). **Forbidden:** approving/activating; executing the definition.

### 2.3 `record_workflow_run(...)`
- **Input:** `workflow_key text, run_id text, workflow_version_id uuid, parent_run_id text,
  actor_slug text, status text, started_at timestamptz, ended_at timestamptz, metrics jsonb`.
- **Output:** `uuid` (run id row).
- **Validation:** `status` enum; `run_id` unique (upsert-by-`run_id` to allow start→end update of
  *the run row only* — note: this is the **one** controlled UPDATE, limited to run lifecycle fields,
  never to audit/grants); `metrics` size cap.
- **Behavior:** upsert run row; emit audit event(s) for start/stop.
- **Definer justified:** centralizes correlation-id integrity and keeps `metrics` observational.
- **Risks:** run flooding (rate-aware logging; sampling for very chatty workflows). **Forbidden:**
  using `metrics` to block/throttle; mutating other tables.

### 2.4 `record_policy_shadow_decision(...)`  — **shadow mode core (§4)**
- **Input:** `actor_slug text, workflow_key text, run_id text, action text, context jsonb`.
- **Output:** `jsonb` = `{ would_decision: 'allow'|'deny'|'require_approval'|'throttle',
  matched_policy_key, matched_policy_version, matched_capability_ids, rationale }`.
- **Validation:** read-only evaluation against `policy_definitions` (status `shadow`) +
  `capability_grants`; **never writes to those tables**; records the computed *hypothetical*
  decision into `audit_events` (`event_type='policy.shadow_decision'`).
- **Behavior:** computes what the future PDP *would* return, **returns it for logging/telemetry,
  and the caller ignores it** (non-binding). No exception thrown on `would_decision='deny'`.
- **Definer justified:** consistent evaluation + guaranteed audit write regardless of caller.
- **Risks:** callers mistakenly treating output as binding (mitigate: name fields `would_*`,
  document loudly, and in Phase 0 the integration adapters are **not** wired to obey it);
  evaluation latency on hot paths (mitigate: keep rule sets tiny in Phase 0). **Forbidden:**
  raising/blocking; mutating policy/capability tables.

### 2.5 `record_approval_decision(...)`
- **Input:** `subject_type text, subject_id text, subject_hash text, decision text,
  risk_score int, approver_slug text, reason text`.
- **Output:** `uuid` (approval row id).
- **Validation:** resolve `approver_slug` and assert `actor_type='human'`; `decision` enum;
  require `subject_hash` for `workflow_version` subjects.
- **Behavior:** insert immutable approval row; emit audit event. **Does not change any workflow
  state** (no lifecycle in Phase 0).
- **Definer justified:** guarantees approver is human + record is immutable + audited.
- **Risks:** approvals recorded but meaningless if mistaken for gating (document: Phase 0
  approvals are *records*, not gates). **Forbidden:** auto-approval; granting capabilities;
  activating workflows.

---

## 3. Append-only audit model

### 3.1 `audit_events` columns
```
id              uuid pk default gen_random_uuid()
chain_id        text not null default 'global'     -- allows per-stream chains if needed
seq             bigint                              -- monotonic per chain (assigned in RPC)
previous_hash   text                                -- event_hash of prior row in chain (null for genesis)
event_hash      text not null unique                -- digest(previous_hash ‖ canonical(envelope+payload))
actor_id        uuid references public.agent_registry(id)
actor_type      text not null                       -- master|subagent|n8n|human|system
source_system   text not null                       -- e.g. 'n8n','edge:fetch-owner','app'
event_type      text not null                       -- dotted: workflow.run.started, policy.shadow_decision, approval.recorded ...
resource_type   text                                -- workflow_version|workflow_run|capability|approval|...
resource_id     text
payload         jsonb not null default '{}'         -- redacted, size-capped
created_at      timestamptz not null default now()
```

### 3.2 Preventing modification (tamper-evidence)
- **Hard RLS + revoked DML:** `REVOKE UPDATE, DELETE ON public.audit_events FROM PUBLIC,
  anon, authenticated, service_role;` INSERT only via `log_audit_event`.
- **Belt-and-suspenders trigger:** a `BEFORE UPDATE OR DELETE` trigger that `RAISE EXCEPTION`
  unconditionally — so even a future misconfigured grant can't mutate history.
- **Hash chain:** each row binds to the prior via `previous_hash`; any silent edit/delete breaks
  the chain and is detectable by re-walking hashes. `event_hash` is `unique`.

### 3.3 Handling corrections (never edit)
- Corrections are **new compensating events** (`event_type='audit.correction'`) that *reference*
  the corrected event's `id`/`event_hash` in `payload`. The original is never altered. This
  preserves an honest, monotonic history ("we later learned X was wrong") instead of rewriting it.

### 3.4 Verifiable audit trail
- A read-only verifier (RPC or offline script, **read-only**) walks a `chain_id` ordered by `seq`,
  recomputes `event_hash` from `previous_hash + canonical(payload+envelope)`, and asserts equality
  + continuity. A break localizes tampering to a row. Optionally anchor periodic checkpoints
  (store a chain head hash + count) for cheap integrity spot-checks.

### 3.5 Preventing n8n from becoming authority
- n8n can **only** call `log_audit_event` / `record_workflow_run` / `record_policy_shadow_decision`
  with `source_system='n8n'`. It has **no** write access to `policy_definitions`,
  `capability_grants`, `approval_records`, or `workflow_versions.status`. It receives **no binding
  decision** from Phase 0. Authority (truth, future decisions, approvals) stays in
  Supabase/domain. Audit records *who claimed what from where* (`source_system`) so n8n-originated
  events are always distinguishable and never privileged.

---

## 4. Shadow / observe mode

**Goal:** capture, for every governed-in-future action, a complete "what would have happened"
record — **without ever changing what actually happens.**

For each action of interest, the caller (later: integration adapter; in Phase 0: optional,
opt-in instrumentation) calls `record_policy_shadow_decision(...)` which logs:
1. **Intended action** — `action` (e.g. `qbo.write`), `actor_slug`, `workflow_key`, `run_id`,
   and `context` (resource pattern, environment, params summary — redacted).
2. **Policy that *would* be evaluated** — matched `policy_key`+`version` and priority resolution.
3. **Decision that *would* be taken** — `would_decision` ∈ allow/deny/require_approval/throttle,
   with `rationale` and matched `capability_ids`.
4. **Actual outcome** — separately, `record_workflow_run` logs what *did* happen.

**Non-blocking guarantee:** the function never raises and never returns a value the caller is
required to honor. In Phase 0 the integration adapters are **not** wired to read it (or read it
only to log a "divergence" metric: would-deny vs did-do). This produces the dataset that justifies
(or corrects) the policy set **before** any Phase 3 enforcement. **Acceptance test:** disable all
shadow calls → system behavior is byte-for-byte identical.

---

## 5. Phase 0 boundaries (explicit OUT OF SCOPE)

- ❌ No enforcement (PDP returns are advisory/logged only).
- ❌ No active kill switch (may exist as a *recorded flag*, but nothing reads it to stop work).
- ❌ No active quarantine (no state machine yet).
- ❌ No budget/quota blocking (metrics observed, never enforced).
- ❌ No real runtime capability checks (grants are descriptive inventory).
- ❌ No automated approvals (approvals are *records* of human decisions).
- ❌ No mandatory n8n modification (instrumentation is optional/opt-in; n8n keeps running as-is).
- ❌ No lifecycle transitions, no `workflow_lkg`, no activation gates.
- ❌ No circuit breakers, no DLQ wiring, no anomaly *response*.
- ❌ No secret brokering / token isolation changes.

If any of the above appears in a proposed migration, it is **out of Phase 0** and must be rejected.

---

## 6. Implementation plan for the principal Claude

> The principal Claude implements; this section tells it **what** and **in what order**, with
> tests and rollback. Each migration ships independently and is reversible.

### 6.1 SQL files to create (proposed order)
1. `…_gov_p0_agent_registry.sql` — table + indexes + RLS + revoke DML.
2. `…_gov_p0_audit_events.sql` — table + indexes + RLS + **anti-mutation trigger** +
   `log_audit_event` RPC. *(Audit first so later steps can emit events.)*
3. `…_gov_p0_workflow_versions.sql` — table + RLS + `register_workflow_version` RPC.
4. `…_gov_p0_workflow_runs.sql` — table + RLS + `record_workflow_run` RPC.
5. `…_gov_p0_capability_grants.sql` — table + RLS (descriptive; insert via RPC/seed).
6. `…_gov_p0_policy_definitions.sql` — table + RLS + `record_policy_shadow_decision` RPC.
7. `…_gov_p0_approval_records.sql` — table + RLS + `record_approval_decision` RPC.

(Use the next available timestamp prefix consistent with `supabase/migrations/`. All in
`public`, all `IF NOT EXISTS`, all matching the house definer style.)

### 6.2 Migration tests
- Idempotency: re-running a migration is a no-op (`IF NOT EXISTS`, `CREATE OR REPLACE`).
- Forward+rollback: apply then run the paired down-script; assert clean drop, no orphans.
- Cross-FK: `actor_id`/`workflow_version_id` references resolve or are nullable as specified.

### 6.3 RLS tests
- As `anon`: cannot select/insert anything governed (or read-only per spec).
- As `authenticated`: read allowed where specified; **all direct INSERT/UPDATE/DELETE denied**.
- As `service_role`: can call RPCs; **direct UPDATE/DELETE on `audit_events` denied** (trigger
  raises even if a grant slipped through).
- Negative: attempt direct `INSERT INTO audit_events` → denied; attempt `UPDATE`/`DELETE` →
  trigger exception.

### 6.4 RPC tests
- `log_audit_event`: chain continuity (previous_hash links), `event_hash` uniqueness, payload
  size cap rejection, redaction of known secret keys, concurrency (no chain gaps/dupes).
- `register_workflow_version`: uniqueness, server-side hash, immutability conflict rejection.
- `record_workflow_run`: start→end upsert limited to run fields; audit emitted.
- `record_policy_shadow_decision`: **never raises** on deny; returns `would_*`; writes audit;
  does not mutate policy/capability tables.
- `record_approval_decision`: rejects non-human approver; immutable insert.

### 6.5 Rollback
- Each table/RPC has a paired down-migration (`DROP FUNCTION`, `DROP TABLE`). Because Phase 0 is
  passive and additive, rollback = drop in reverse order; **no data migration to unwind, no
  runtime behavior to restore.** Document the down-scripts alongside each up-script.

### 6.6 GO / NO-GO criteria (for shipping Phase 0 migrations)
- **GO if:** all RLS negative tests pass; `audit_events` is provably append-only (trigger blocks
  UPDATE/DELETE even as service_role); shadow RPC demonstrably non-blocking; disabling all
  instrumentation yields identical runtime behavior; rollback verified on a branch DB.
- **NO-GO if:** any governed table is client-writable; any RPC can block/raise on the hot path;
  hash chain can be silently broken; `definition`/`payload` accept unbounded size; any Phase 0
  artifact reads a "decision" and acts on it.

---

## 7. Phase 0-specific risks

| Risk | Why it bites in Phase 0 | Mitigation |
|---|---|---|
| **Over-engineering** | Building lifecycle/enforcement scaffolding "while we're here" | Hard scope gate §5; reject any non-passive artifact in review |
| **Premature/wrong schema** | Locking columns before real usage data exists | Keep tables lean; push variability into `jsonb` (`metadata`,`rules`,`scope`,`metrics`); immutable-version tables so v2 is additive |
| **Useless audit** | Logging noise nobody queries; events with no lineage keys | Mandate `run_id`/`resource_*`/`event_type` taxonomy up front; verifier + dashboards before scaling volume |
| **Log volume blow-up** | Every action logged → table + storage growth | Payload size cap; sampling for chatty workflows; retention/partition policy decided **before** enabling broad instrumentation |
| **Misconfigured RLS** | A wrong grant makes governance tables writable/tamperable | Default deny + explicit revoke + anti-mutation trigger + negative RLS tests as a GO gate |
| **Over-permissive SECURITY DEFINER** | Definer functions run as owner; a loose body = privilege bypass | `SET search_path=public`; validate every input; no dynamic identifier SQL; each RPC touches only its table; minimal `GRANT EXECUTE`; code review focused on definer bodies |
| **Shadow mistaken for binding** | A caller "helpfully" obeys `would_decision` | `would_*` naming; adapters not wired to obey in Phase 0; documented loudly |
| **Hash-chain contention** | Concurrent inserts racing on `previous_hash` | Per-chain advisory lock or serializable insert; allow multiple `chain_id` streams to shard |

---

## 8. Final recommendation

**Can Phase 0 be handed to the principal Claude? — Conditional YES.** Phase 0 is passive,
additive, reversible, and built on a pattern the team already ships. It is the safest possible
first step and unblocks everything later by producing the audit/shadow dataset.

**Safe to delegate now:**
- `agent_registry`, `audit_events` (+ `log_audit_event`, anti-mutation trigger), and the verifier.
- `workflow_versions` (+ `register_workflow_version`) and `workflow_runs` (+ `record_workflow_run`).
- RLS + RPC + rollback + the GO/NO-GO test suite.

**Should wait (design more before building):**
- `capability_grants` / `policy_definitions` / `record_policy_shadow_decision` — ship **after**
  the action taxonomy (`action` namespace) and a tiny seed policy set are agreed, so shadow data
  is meaningful and not noise. (Tables can land; the *shadow evaluation* should follow the taxonomy
  decision.)
- `approval_records` — fine to create, but confirm it's understood as *record-only* (no gating).

**Must remain on hold (NOT Phase 0):** `workflow_lkg`, any lifecycle/enforcement/breaker/budget,
any n8n modification beyond optional logging.

**Questions to validate before the first migration:**
1. **Action taxonomy:** confirm the initial `action` namespace (gmail.*, qbo.*, workflow.*,
   filesystem.*, external_api.call, secret.read) and the `event_type` taxonomy.
2. **Audit retention & volume:** retention window, partitioning, and sampling policy *before*
   broad logging.
3. **Who may call the logging RPCs:** exactly which roles (authenticated app? edge functions?
   n8n service token?) get `EXECUTE`, and with what `source_system` labels.
4. **Redaction list:** the canonical set of secret/PII keys the RPC must strip from `payload`.
5. **Chain sharding:** single `global` chain vs per-stream `chain_id` (concurrency vs simplicity).
6. **Hash function & canonical JSON:** pin the digest algorithm and canonicalization routine.
7. **Backfill:** do we register existing/known workflows into `workflow_versions` at install, or
   start empty?

---

*Architect deliverable only. No code written, no migration created, no runtime/n8n change, no
enforcement enabled. Implementation belongs to the principal Claude, gated by §6.6.*
