# Orchestrator Governance Architecture v1

> **DESIGN & GOVERNANCE ONLY — NO CODE, NO MIGRATIONS, NO RUNTIME CHANGES.**
> Produced by the architecture/governance role. A separate implementation agent owns
> production changes. This document analyzes, specifies and proposes; it does not implement.

Date: 2026-05-26 · Branch: `claude/quote-roofmodel-audit-aXRf5`

---

## 0. Grounding & assumptions (read first)

**Verified against the current repository (`webflow-quote-builder`):**
- The orchestration platform described (MASTER_orchestrator, sub-agents, `workflow_versions`,
  `workflow_lkg`, circuit breakers, n8n layer) **does not yet exist in this repo**. Greps for
  `orchestrat|n8n|workflow_lkg|MASTER_orchestrator|sub-agent|circuit.breaker` returned only
  false positives (Gantt scheduling, skeleton pipeline, logo asset).
- What **does** exist and is reusable as a security substrate: **Supabase as system of record**
  and **14 migrations using `SECURITY DEFINER` RPCs** — i.e. the team already practices the
  "privileged operation behind a definer function" pattern this design leans on.

**Consequence:** this is a **greenfield governance architecture**, not a refactor of a live
orchestration system. Every "table"/"function"/"engine" below is a *proposal*. Nothing here is
wired to current runtime behavior. Where I reference existing reality, I say so explicitly.

**North-star invariant:** *n8n is an execution conveyor, never an authority.* Truth, validation,
capability checks, approvals and audit live in Supabase + domain logic. If n8n disagrees with
Supabase, Supabase wins and the workflow is quarantined.

---

## 1. Executive Summary

We propose a governance layer that treats every agent and workflow as **untrusted by default**
and grants authority only through **explicit, expiring, auditable capabilities** evaluated by a
**deterministic policy engine** at well-defined enforcement points. Workflows move through an
**immutable-audited lifecycle state machine** (`draft → … → active → quarantined/revoked`) gated
by a **risk-scored approval chain**. Runtime is **isolated per execution** with strict
token/secret/filesystem boundaries, and protected by **circuit breakers, kill switches and a
Last-Known-Good (LKG) fast-path**. All of it is observable through an **append-only audit trail**
that supports forensic replay and execution lineage. Cost/resource governance and parallel
multi-agent ownership boundaries prevent runaway spend and silent overwrites.

The design is intentionally **incremental and backward-compatible**: it can wrap the existing
Supabase truth layer without rewriting it, and can be adopted phase-by-phase behind flags.

**Overall architecture confidence: 7/10** — high on the security/lifecycle/audit core (well-trodden
patterns on a substrate the team already uses); lower on parallel multi-agent coordination and
runtime isolation, which depend on infrastructure decisions not yet made (where agents execute,
how secrets are brokered).

---

## 2. System Goals

| Goal | Definition of success |
|---|---|
| Least privilege | No agent holds a capability it isn't actively using; default deny. |
| Blast-radius reduction | A compromised workflow/agent cannot affect data or systems outside its grant. |
| Explicit approvals | Every state escalation and privileged action has a recorded human/policy decision. |
| Deterministic rollback | Any active workflow can be reverted to a known-good version in one operation. |
| Runtime isolation | Executions cannot read each other's memory, tokens or secrets. |
| Auditability | Every action is reconstructable after the fact, tamper-evident. |
| Observability | Operators can see live state, cost and policy decisions in real time. |
| Incremental evolution | Adoptable per-phase, behind flags, without breaking current flows. |
| Safe (de)activation | Activating or disabling a workflow is non-destructive and reversible. |
| Human override | A human can always pause/kill/quarantine, and that authority can't be revoked by an agent. |

**Non-goals (v1):** autonomous self-modification of policies by agents; cross-tenant federation;
ML-based anomaly *response* (we do detection + alert, not automated punitive action) — these are
explicitly deferred to avoid premature, hard-to-reverse authority transfers.

---

## 3. Threat Model

**Trust boundaries:** human operator ⟶ MASTER_orchestrator ⟶ sub-agents ⟶ workflows ⟶
integrations/external APIs. Trust **strictly decreases** left-to-right. n8n sits *beside* the
conveyor, never inside the trust core.

**Adversaries / threat actors considered:**
1. **Compromised sub-agent** (prompt-injected, hijacked tool output, malicious instruction in
   external data) attempting privilege escalation or data exfiltration.
2. **Malicious/over-broad workflow** approved once, then drifting in behavior at runtime.
3. **Confused-deputy**: a low-priv agent inducing a high-priv component to act on its behalf.
4. **Insider/compromised approver** abusing approval authority or tampering with logs.
5. **Runaway automation**: retry storms, infinite loops, cost blowups.
6. **n8n-as-authority creep**: business logic silently migrating into the conveyor.
7. **Secret leakage** via logs, error messages, or shared execution context.
8. **Race conditions** between parallel agents producing silent overwrites/drift.

**Key assumptions to challenge (do not take for granted):**
- Agents are NOT trustworthy, even post-approval.
- A workflow that was safe at approval time may be unsafe at execution time (data/context changed).
- Orchestration ≠ governance. n8n running a step is not proof the step is allowed.
- Tool outputs and external data are attacker-controlled input.

**STRIDE quick-map:** Spoofing→identity on every call (signed agent identity); Tampering→append-only
audit + hash chaining; Repudiation→immutable approval log; Information disclosure→token/secret
isolation; DoS→rate limits + circuit breakers + budgets; Elevation→capability deny-by-default +
no-escalation invariant.

---

## 4. Capability Architecture

### 4.1 Capability model
A capability is a **signed, scoped, expiring grant**:

```
capability := {
  id, principal (agent_id | role), action (e.g. "gmail.send"),
  scope := { resource_pattern, environment, runtime, constraints },
  effect := "allow" | "deny",          # explicit deny always wins
  grant := { granted_by, reason, approval_id?, source: "role|direct|elevation" },
  validity := { not_before, not_after, max_uses?, single_workflow_id? },
  signature                            # integrity, prevents tampering
}
```

**Action namespace (dotted, hierarchical):**
`gmail.read | gmail.send | gmail.modify`, `qbo.read | qbo.write`,
`workflow.execute | workflow.approve | workflow.activate`,
`filesystem.read | filesystem.write`, `external_api.call`, `secret.read`.

### 4.2 Inheritance, scopes, deny
- **Inheritance:** `action` prefixes form a tree. A grant on `gmail.*` implies children **only if
  explicitly marked `inheritable: true`**; default is non-inheriting (least privilege).
- **Scopes:** narrow grants by `resource_pattern` (e.g. `qbo.write:estimate/*` not `qbo.write:*`),
  `environment` (`prod|staging|sandbox`), `runtime` (`master|subagent|workflow`).
- **Explicit deny precedence:** evaluation is **deny-overrides**. A single matching deny defeats
  any number of allows. Denies cannot be granted *away* by a lower authority.

### 4.3 Temporary elevation & expiration
- **Just-in-time elevation:** an agent requests a higher capability for a single workflow run;
  the request is policy-evaluated + (if risk≥threshold) human-approved, issued with a short
  `not_after` and `single_workflow_id` binding, and **auto-revoked** on workflow terminal state.
- **Expiration is mandatory:** every capability has `not_after`. No "permanent" grants except a
  small static role set (see §16). Expired ≠ renewed automatically.

### 4.4 Storage & enforcement
- **Storage:** Supabase tables `capabilities`, `capability_grants`, `roles`, `role_capabilities`,
  protected by RLS; issuance only via `SECURITY DEFINER` RPC `issue_capability(...)` (mirrors the
  team's existing 14-definer pattern) so application code can never insert a grant directly.
- **Enforcement (PEP/PDP split):** the **Policy Decision Point** is a definer RPC
  `authorize(principal, action, scope, context) → decision`. **Policy Enforcement Points** are the
  *only* code paths that touch privileged resources — every integration adapter calls `authorize`
  first and refuses to act without an `allow`. n8n nodes are PEPs that must call `authorize`; an
  n8n step cannot self-authorize.

### 4.5 Sub-agent inheritance & anti-escalation
- A sub-agent's **effective capabilities = intersection** of (its own grants) ∩ (its parent's
  delegable grants) ∩ (active policy). **Never a union.** This makes escalation structurally
  impossible: a child can only ever have ≤ its parent.
- **No-escalation invariant:** issuance RPC rejects any grant whose authority exceeds the issuer's
  own delegable set. Delegation is marked explicitly (`delegable: true`); most grants are not.
- Capability checks are **re-evaluated at execution time**, not cached from approval time.

---

## 5. Policy Engine Architecture

### 5.1 Policy object
```
policy := {
  id, version, target (agent|workflow|role|global), priority,
  rules := [{ when (context predicate), limits, requirements, effect }],
  limits := { max_duration_s, max_parallelism, max_api_calls, max_cost_usd,
              rate_limit, retry_policy },
  guards := { allowed_domains[], forbidden_tools[], required_capabilities[],
              approval_required (risk≥X), escalation_triggers[] },
  failure_mode := "fail_closed" | "fail_open"   # default fail_closed
}
```

### 5.2 Evaluation flow
```
request → resolve effective policy set (global ⊕ role ⊕ workflow ⊕ agent, by priority)
        → evaluate rules (deny-overrides, most-specific-wins on ties)
        → check limits/quotas against live counters
        → check capability requirements (calls §4 authorize)
        → produce decision { allow|deny|require_approval|throttle } + obligations
        → write policy_evaluation_log (always, even on allow)
```

### 5.3 Enforcement points, fail modes, emergency stop
- **Enforcement points:** workflow activation, each privileged tool call, each external API call,
  parallelism admission, budget checkpoints.
- **Fail-closed by default** for anything touching money, external comms, writes, secrets,
  destructive ops. **Fail-open allowed only** for non-mutating, read-only telemetry paths, and
  only when explicitly marked — never inferred.
- **Emergency shutdown:** a global `kill_switch` policy (highest priority, deny-all on `effect`)
  that any operator can flip; PDP checks it first, so it short-circuits everything within one
  evaluation. Kill switch state is itself audited and cannot be cleared by an agent.

### 5.4 Storage, versioning, audit, safe override
- **Live in Supabase**, RLS-protected, edited only via definer RPC; **immutable versioning**
  (new row per change, `superseded_by`), never in-place mutation.
- **Audited:** every evaluation logged with the policy version id used → forensic determinism.
- **Safe override:** overrides are *additive, expiring policies* at higher priority with a
  mandatory `reason` + approval, not edits to base policy. Auto-expire and revert cleanly.
- **Inheritance:** global → role → workflow → agent, narrowing only (a child policy can tighten,
  never loosen, a parent limit).

---

## 6. Workflow Lifecycle State Machine

### 6.1 States
`draft → proposed → reviewed → approved → staged → active`
with runtime branches `active ⇄ throttled`, `active ⇄ paused`,
`active → quarantined`, and terminal `revoked`, `archived`. `workflow_lkg` is a **pointer**, not a
state — it references the last `active`-validated version for instant rollback.

### 6.2 Transition diagram
```
 draft ──submit──▶ proposed ──review──▶ reviewed ──approve(chain)──▶ approved
                                                                       │ stage
                                                                       ▼
                                            ┌──────────────────────  staged
                                            │ activate (safe-activation gate)
                                            ▼
        ┌────────── throttled ◀──policy──▶ ACTIVE ──pause──▶ paused ──resume──▶ ACTIVE
        │                                   │  │  ▲                                 
        │                          breaker/anomaly │ reactivate(re-approval)         
        │                                   ▼  │  │                                  
        └───────────────────────────▶ quarantined ─┘                                
                                            │ revoke (irreversible authority loss)   
                                            ▼                                        
                                         revoked ──────▶ archived (immutable record) 
```

### 6.3 Gates, approvals, rollback, quarantine, immutability
- **Safety gates:** `proposed→reviewed` (static analysis + capability lint),
  `reviewed→approved` (risk-scored approval chain §7), `staged→active`
  (**safe-activation**: dry-run/shadow + LKG snapshot taken before activation).
- **Quarantine behavior:** an active workflow that trips a breaker/anomaly is *immediately* moved
  to `quarantined` — execution halted, in-flight steps drained to dead-letter, capabilities frozen.
  Quarantine is automatic; **un-quarantine requires human re-approval.**
- **Reactivation rules:** `paused→active` allowed by operator; `quarantined→active` and
  `revoked→*` require a fresh approval chain (treated as a new activation).
- **Rollback rule:** any `active` workflow can transition to "active on `workflow_lkg` version"
  in one operation, no re-approval (LKG was previously approved).
- **Immutable audit:** every transition is an append-only `workflow_state_events` row
  (hash-chained, see §10); state history can never be edited, only appended.

---

## 7. Approval Chain Architecture

### 7.1 Risk scoring → chain selection
A workflow/action gets a **risk score** from: data sensitivity, mutation vs read, external comms,
financial impact, capability breadth, blast radius, reversibility. Score selects the chain:

| Class | Examples | Chain |
|---|---|---|
| Low-risk | read-only report, internal query | auto-approve by policy + logged |
| Standard | internal write, non-financial | 1 human approver |
| External-comms | send email/SMS to customers | 1 human, content preview required |
| Financial | QBO write, invoice/payment, payout | **dual approval**, segregation of duties |
| Destructive | delete/migrate/bulk-mutate | dual approval + named operator + cool-off timer |
| Privileged | capability elevation, policy override | dual approval + time-boxed grant |

### 7.2 Mechanics
- **Multi-stage & escalation:** stages evaluated in order; timeout on a stage **escalates** to a
  higher role (never auto-approves). Escalation chains are policy-defined.
- **Expiration:** approvals carry `not_after`; an approval that wasn't acted on expires and must
  be re-requested (prevents stale-approval replay).
- **Emergency override:** "break-glass" path requires a *second* human, posts a high-severity
  security event, and grants the narrowest possible time-boxed capability. Never silent.
- **Dual approval / SoD:** the requester cannot approve; the two approvers must be distinct
  principals; financial chains require a finance-role approver.

### 7.3 Who approves what, logging, tamper-resistance
- **Authority matrix** maps role → approvable classes (e.g. `ops` ≤ standard; `finance` for
  financial; `security` for privileged/override). Stored in Supabase, RLS-guarded.
- **Logging:** every approval/denial is an append-only, hash-chained `approval_events` row with
  approver identity, decision, reason, risk score, and the exact artifact hash approved.
- **Tamper prevention:** approvals reference the **content hash** of what was approved; if the
  workflow content changes, the approval no longer matches → activation blocked. Logs are
  write-once (definer RPC insert only; no update/delete grant exists).

---

## 8. Runtime Isolation Strategy

| Boundary | Strategy |
|---|---|
| Execution sandboxing | Each workflow run executes in an ephemeral, single-purpose context; no long-lived shared process. |
| Memory isolation | No shared mutable memory between runs/sub-agents; data passed by value through the truth layer, not by reference. |
| Token isolation | Per-run, per-integration **short-lived tokens** brokered just-in-time; never the master token. Tokens scoped to the run's capabilities. |
| Environment isolation | `prod|staging|sandbox` strictly separated; capabilities are environment-scoped; cross-env calls denied. |
| Filesystem restrictions | Default no filesystem; `filesystem.read/write` is a capability with path scoping; ephemeral, wiped per run. |
| Secret handling | Secrets resolved at the PEP via a broker RPC, **never** passed into agent context or logs; redaction at the logging boundary. |
| API boundary enforcement | All external calls go through audited adapter PEPs enforcing `allowed_domains` + `external_api.call` capability. |

**Blast-radius containment:** a run can only reach what its (intersected) capabilities + policy
allow; everything else is deny-by-default. **Compromised workflow:** quarantine freezes its
capabilities and revokes its run tokens immediately, draining in-flight work to dead-letter.
**Compromised sub-agent:** because effective caps are an *intersection* and re-checked at execution,
a hijacked sub-agent cannot exceed its parent and is contained to its own grant; revoking its
identity invalidates all its run tokens at once.

---

## 9. Failure Containment Strategy

- **Circuit breakers:** per-workflow and per-integration; trip on error-rate/latency/cost
  thresholds → workflow to `throttled` then `quarantined` if sustained.
- **Kill switches:** global (§5.3) and per-workflow; human-flippable, agent-immune, audited.
- **Retry-storm prevention:** capped exponential backoff with jitter, a **global retry budget**,
  and idempotency keys; breakers count retries toward trip thresholds.
- **Cascading-failure prevention:** bulkheads — a failing integration's breaker isolates it so
  other workflows keep running; dependency-aware admission control.
- **Dead-letter queues:** failed/drained executions land in a DLQ with full context for manual
  inspection/replay; never silently dropped.
- **Degraded mode:** when a dependency is down, workflows can run in read-only/queue-only mode if
  policy permits, otherwise pause.
- **Recovery:** *automatic* — breaker half-open probes, LKG fast-path. *Manual* — operator
  resume/replay from DLQ, or rollback to `workflow_lkg`. **Safe fallback = activate LKG**, which is
  pre-approved and known-good, so recovery never requires shipping new untested behavior.

---

## 10. Observability & Auditability

- **Immutable audit trail:** append-only, **hash-chained** event log (each row carries
  `prev_hash`); insert-only via definer RPC; no update/delete capability exists for it.
- **Coverage:** workflow execution traces (per step, with timing), agent action logs, **policy
  evaluation logs (even on allow)**, approval logs, capability-usage logs, security events.
- **Execution lineage:** every event carries `run_id`, `parent_run_id`, `workflow_version_id`,
  `policy_version_id`, `capability_grant_ids[]` → full causal graph reconstructable.
- **Replay & forensics:** because decisions are deterministic and inputs are logged, a run can be
  **replayed** against historical policy/capability versions for forensic reconstruction.
- **Anomaly detection:** baselines on cost/rate/tool-mix per workflow; deviations raise security
  events (detect-and-alert in v1, not auto-punish).
- **Runtime metrics:** live dashboards for state distribution, breaker status, budget burn,
  approval queue depth, quarantine count.

---

## 11. Cost & Resource Governance

- **Budgets:** per-agent, per-workflow, and per-run `max_cost_usd`; org-level monthly cap.
- **Quotas:** execution quotas, API-call quotas, token-consumption tracking (input/output tokens
  attributed to run + agent).
- **Thresholds:** soft (warn at 70%), hard (throttle at 90%), shutdown (deny at 100%).
- **Enforcement points:** cost checkpoint before each priced operation; admission control on
  parallelism; PDP returns `throttle` obligation when near limits.
- **Auto-throttling:** as budget burns, parallelism and rate caps tighten automatically before a
  hard stop, preserving in-flight critical work.
- **Runaway detection:** rate-of-spend anomaly + loop detection (same step N times) → breaker +
  quarantine. **Shutdown threshold** flips the per-workflow kill switch and posts a security event.

---

## 12. Parallel Multi-Agent Governance

- **Ownership boundaries:** every resource/domain has a single **owning agent/role**; others get
  read or must request a contract. Prevents two agents mutating the same surface.
- **Contract system:** cross-boundary work is a declared **contract** (requester, owner, scope,
  expected effect, expiry) the owner must accept — explicit, audited hand-offs instead of implicit
  shared writes.
- **Shared-resource governance:** **dependency locking** (advisory locks in Supabase) on shared
  artifacts; writers acquire a lock, lock is run-scoped and auto-released on terminal state.
- **Conflict & race prevention:** optimistic concurrency via version/`updated_at` checks; a write
  with a stale base version is rejected → no silent overwrite.
- **Merge approval logic:** when two agents propose changes to the same artifact, both proposals
  enter a merge-review requiring an owner approval before either activates.
- **Architectural-drift prevention:** ownership + contracts + version checks make drift visible and
  blockable; the orchestrator records a dependency graph and refuses cyclic/conflicting activations.
- **Coordination:** MASTER_orchestrator is the **sole scheduler**; sub-agents request work, they do
  not self-dispatch onto shared resources.

---

## 13. Rollback & Recovery

- **`workflow_lkg`** is the recovery cornerstone: a pointer to the last known-good *approved*
  version. Rollback = re-point active to LKG (one operation, no re-approval).
- **Deterministic rollback:** versions are immutable; rolling back is selecting a prior immutable
  version, never reconstructing state.
- **Snapshots:** LKG snapshot is captured **before** every activation (safe-activation gate), so a
  bad activation always has an immediate predecessor to fall back to.
- **Recovery ladder:** throttle → pause → rollback-to-LKG → quarantine → revoke. Operators choose
  the least-drastic effective step.
- **Data-side recovery:** mutating workflows must declare compensating actions / idempotency so
  rollback of *behavior* is paired with a documented path for *data* (full data rollback remains a
  human-approved operation — see risks).

---

## 14. Risk Matrix

| # | Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|---|
| 1 | n8n accrues business/validation authority | High | High | PDP-in-Supabase invariant; n8n nodes are PEPs only | Med |
| 2 | Prompt-injected sub-agent attempts escalation | High | High | Capability intersection + no-escalation invariant + exec-time re-check | Low |
| 3 | Stale approval applied to changed workflow | Med | High | Content-hash-bound approvals | Low |
| 4 | Secret leakage via logs/context | Med | High | Broker-only secret resolution + redaction boundary | Low |
| 5 | Runaway cost/loop | Med | High | Budgets + loop detection + auto-throttle + kill switch | Low |
| 6 | Race/silent overwrite (parallel agents) | Med | Med | Ownership + locks + optimistic concurrency | Med |
| 7 | Fail-open misconfiguration on a mutating path | Low | High | Default fail-closed; fail-open must be explicit + reviewed | Low |
| 8 | Audit tampering / repudiation | Low | High | Hash-chained append-only, insert-only RPC | Low |
| 9 | Data rollback ≠ behavior rollback | Med | High | Idempotency + compensating actions + human-approved data restore | Med |
| 10 | Over-broad static roles (permanent caps) | Med | Med | Minimal static set; everything else expiring | Med |

---

## 15. Recommended Implementation Phases

> All phases are proposals; each ships behind flags, backward-compatible, reversible.

- **Phase 0 — Foundations (truth & audit):** capability/policy/approval/audit **tables + definer
  RPCs** in Supabase (modeled on the existing 14-definer pattern). Append-only hash-chained audit
  log. *No enforcement yet — log-only/observe mode.*
- **Phase 1 — Capability + Policy (shadow):** `authorize` PDP + PEP wrappers on integration
  adapters, running in **shadow mode** (decide + log, do not block). Measure would-be denials.
- **Phase 2 — Lifecycle + Approvals:** state machine + risk-scored approval chains; safe-activation
  gate + LKG snapshotting.
- **Phase 3 — Enforce:** flip PDP from shadow to **fail-closed** on mutating/financial/external
  paths; circuit breakers + kill switches + quarantine.
- **Phase 4 — Isolation + Cost:** per-run token brokering, secret broker, budgets/quotas,
  auto-throttle.
- **Phase 5 — Parallel governance:** ownership/contracts/locks, merge-review, dependency graph.
- **Phase 6 — Observability maturity:** replay, anomaly detection, forensic tooling.

Each phase has its own GO/NO-GO; do not enforce (Phase 3) before shadow data (Phase 1) proves the
policy set is correct.

---

## 16. GO / NO-GO Recommendations

**GO (proceed to design/spec these now):**
- Phase 0 foundations (tables, definer RPCs, append-only audit) — low risk, high leverage, builds
  on existing patterns.
- Capability model + PDP in **shadow mode** — measures reality before enforcing.
- Lifecycle state machine + LKG snapshotting — pure additive safety.

**NO-GO (do not build/enable yet):**
- **No enforcement before shadow data.** Flipping fail-closed without measured denial rates will
  break live flows.
- **No agent-authored policy/capability changes.** Agents may *request*; only humans/definer-RPC
  issue.
- **No automated punitive anomaly response** in v1 (detect+alert only).
- **No n8n as decision authority** — ever.
- **No cross-environment capabilities.**

---

## Risk Top-10 lists

### Top 10 architectural risks
1. n8n drifting into authority/validation. 2. PDP/PEP split not honored (some path bypasses
`authorize`). 3. Capability caching defeating exec-time re-check. 4. Policy precedence ambiguity
(allow vs deny conflicts). 5. State machine with an unaudited transition. 6. LKG pointer pointing at
a non-validated version. 7. Behavior rollback without data compensation. 8. Hidden coupling between
runs via shared memory/state. 9. Generated/edited-by-hand truth schema divergence. 10. Greenfield
infra assumptions (where agents run) proving wrong, invalidating isolation.

### Top 10 governance risks
1. Stale-approval replay. 2. Self-approval / weak segregation of duties. 3. Break-glass overuse
becoming routine. 4. Approval not bound to content hash. 5. Override policies that don't expire.
6. Risk scoring miscalibrated (financial scored as standard). 7. Escalation timeout auto-approving.
8. Ownership boundaries undefined for new resources. 9. Merge-review skipped under time pressure.
10. Quarantine reactivation without re-approval.

### Top 10 security risks
1. Prompt injection via tool output/external data. 2. Secret leakage in logs/errors/context.
3. Confused-deputy escalation. 4. Token over-scoping / long-lived tokens. 5. Compromised approver.
6. Audit tampering/repudiation. 7. Fail-open on a mutating path. 8. Cross-environment capability
bleed. 9. Replay of expired capabilities. 10. Exfiltration via an over-broad `external_api.call`.

### Top 10 scaling risks
1. PDP latency on hot paths becoming a bottleneck. 2. Audit log write throughput / storage growth.
3. Lock contention on shared artifacts. 4. Approval queue depth blocking throughput. 5. Breaker
thresholds tuned for low volume tripping at scale. 6. Cost-counter contention/accuracy under
parallelism. 7. Replay cost on a huge lineage graph. 8. Policy-set explosion (too many overrides).
9. Token broker as a single point of failure. 10. Dead-letter backlog growth without triage.

---

## Authority boundaries (explicit)

**MUST NEVER be delegated to sub-agents**
- Issuing/modifying capabilities or policies. Approving anything. Flipping kill switches / clearing
  quarantine. Reading master secrets/tokens. Cross-environment or destructive financial operations
  without a human-approved, time-boxed grant. Writing to the audit log's authority (insert is via
  definer RPC, not an agent capability). Self-dispatching onto shared/owned resources.

**MUST remain under MASTER_orchestrator authority**
- Scheduling/dispatch, parallelism admission, capability *intersection* enforcement, LKG pointer
  management, breaker/kill-switch state, dependency-graph + ownership arbitration, run-token
  brokering. (MASTER orchestrates; it still cannot *grant itself* beyond policy — humans + definer
  RPCs remain above it for issuance/approval.)

**Requires human approval permanently**
- Capability elevation & policy overrides. Financial writes (QBO write, payments/payouts) and all
  destructive/bulk-mutating operations. External customer communications content. Un-quarantine /
  revoke / data restore. Break-glass emergency override (always dual-human).

---

*End of v1. Design only — nothing herein is wired to runtime. Implementation, migrations and
enforcement are out of scope for this document and require their own phased GO/NO-GO.*
