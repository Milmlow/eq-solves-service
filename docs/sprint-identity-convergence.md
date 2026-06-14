# Sprint — Service Identity Convergence

**One sentence:** bring EQ Service onto the suite's already-decided federation identity model (the one
EQ Field already runs), so signing in through the Shell *is* signing in to Service — no re-minting, no
parallel users, no role drift.

**Rationale & target design:** `docs/identity-convergence-service-adoption.md`.
**Decision authority:** the model is already authorised (eq-context `identity-convergence-target-2026-06-04`).
This sprint is *adoption*, not a new decision.

## Guardrails (non-negotiable)

- **Auth-core change** → Royce sign-off at each GATE; nothing irreversible without it (AGENTS.md).
- **Smallest correct scope = identity only.** Service's data stays in `urjh` this sprint. Moving data
  into the canonical topology is explicitly **OUT of scope** (separate later effort).
- **Decoupled from SKS go-live (21 Jun).** Onboarding runs on the working **direct-login** path; this
  sprint must NOT sit on the critical path of onboarding day. Cutover timing is a scheduling decision
  (see §Timing).
- Every phase: `tsc --noEmit` 0 errors, `npm run check` green, RLS isolation + `audit:rls` /
  `audit:actions` gates pass, Supabase advisors (security+perf) 0 new ERROR.

## Phase map

| Phase | What | Reversible? | Gate |
|---|---|---|---|
| 0 | Verify & decide (no code) | n/a | → Royce go/no-go to build |
| 1 | Build behind a flag on a Supabase **branch** | Yes | — |
| 2 | Reconcile identities (data prep, dry-run) | Yes | — |
| 3 | **Cutover** (secret swap + flip) in prod | **No** | → Royce sign-off + scheduled window |
| 4 | Cleanup, soak, advisors, docs | Yes | — |

---

### Phase 0 — Verify & decide  *(no code, no risk)*

The two unknowns that could move the plan, settled before we touch anything.

- [ ] **Mirror Field's secret setup exactly.** Read how `nspb` (Field/SKS) shares the canonical
  `SUPABASE_JWT_SECRET`: how the secret was set, how anon/service_role keys were reissued, and the
  session-invalidation behaviour at swap. Produce the exact `urjh` runbook from it.
- [ ] **Transport check.** Is in-Shell Service a true cross-origin iframe (`service.eq.solutions`, its
  own CSP) or a path proxied under `core.eq.solutions` (Shell CSP applies)? Decides whether an
  eq-shell `connect-src` change for `urjh` is needed.
- [ ] **Inventory** (mechanical, agent-able): every RLS policy/fn on `get_user_tenant_ids()` /
  `get_user_role()`; every app site on `requireUser` JWT path, `createJwtClient`, `mintServiceJwt`,
  the layout JWT branch; every `auth.uid()` write (`audit_logs.user_id`, `*_by`, `profiles`).
- [ ] **Decisions:** retire `tenant_members` vs keep as cache; cutover window vs 21 Jun.
- **Exit:** de-risked runbook + inventory; explicit go/no-go.  **Owner:** me/agent (reads) + Royce (decisions).

### Phase 1 — Build on a Supabase branch, behind a flag  *(main untouched)*

- [ ] On a **branch of `urjh`**: set JWT secret to the shared canonical secret; reissue keys.
- [ ] Rewrite `get_user_tenant_ids()` / `get_user_role()` to read `auth.jwt() -> 'app_metadata'`
  (`tenant_id`, `eq_role`), with `tenant_members` fallback behind a flag → **all existing RLS policies
  converge with zero policy edits**; storage `auth.role()='authenticated'` passes natively.
- [ ] Collapse `requireUser()` to one path (validate Shell JWT, use claims); delete `mintServiceJwt`,
  `createJwtClient`, the layout JWT branch; `getTenantSettings` + layout read the validated identity.
- **Exit (on branch):** in-Shell Service shows SKS branding, logo upload works, role = manager, no
  onboarding wizard; direct login works; MFA/AAL re-verified (proxy.ts).  **Owner:** me/agent.

### Phase 2 — Identity reconciliation  *(dry-run first)*

- [ ] Reconcile Service's **11 active members** into `shell_control.users` by email; create net-new
  canonical users for any missing; map `user_tenant_memberships` with correct `eq_role`
  (fixes supervisor→manager at source).
- [ ] Produce + verify the `urjh-auth-id → canonical-id` mapping table; counts reconcile.
- **Exit:** every active member has a canonical identity + correct role; mapping verified.
  **Owner:** me/agent (needs canonical read/write access — Royce dependency).

### Phase 3 — Cutover  *(IRREVERSIBLE — GATE)*

- [ ] **Royce sign-off + scheduled low-traffic window.** Rollback rehearsed first.
- [ ] Swap `urjh` prod JWT secret to the shared canonical secret; rotate Service Netlify keys in
  lockstep (single change set).
- [ ] eq-shell: confirm `aud=service` token-exchange in use; add `urjh` to `connect-src` if Phase 0
  said so.
- [ ] Smoke matrix: in-Shell × direct login, each role, storage upload, RLS tenant isolation.
- **Exit:** prod in-Shell Service works for SKS; rollback path confirmed live.  **Owner:** Royce-gated, me-executed.

### Phase 4 — Cleanup & soak

- [ ] Soak period with the `tenant_members` fallback still available.
- [ ] After soak: drop the fallback; retire `tenant_members` as source of truth; delete remaining dead
  auth code.
- [ ] Supabase advisors (security+perf) 0 new ERROR; mirror this adoption back into eq-context
  identity docs.
- **Exit:** parallel identity gone; advisors clean; suite docs updated.

---

## Rollback

The **Phase 3 secret swap is the single high-risk gate.** Mitigations: proven on the Phase-1 branch
first; keep the claims-vs-`tenant_members` fallback switch; rehearse revert (restore prior secret +
keys, flip helpers back to `tenant_members`) before the window. Don't delete `tenant_members` data
until the soak passes.

## Effort & timing

Rough: Phase 0 ≈ ½–1 day · Phase 1 ≈ 2–3 days · Phase 2 ≈ 1 day · Phase 3 ≈ ½-day window + smoke ·
Phase 4 ≈ 1 day + soak. ≈ **one focused week + a soak**, most of it reversible; only Phase 3 is the
gated, irreversible moment.

### Timing vs 21 Jun (decision needed)

- **Decouple (recommended):** onboarding runs on direct login; do Phases 0–2 now (all reversible),
  schedule the Phase-3 cutover for a clean window **after** onboarding settles. Converge while the
  pool is still tiny, but never put the irreversible step on top of go-live day.
- **Before 21 Jun:** only if Phases 0–2 land clean with margin — upside is SKS's techs get created in
  canonical identity from the start (no later re-key).
- **After onboarding:** safest for the 21st, but the pool grows first (more to re-key).

## Definition of done

Through the Shell, Service behaves exactly as direct login does — same identity, same role, same data,
storage writes included — with the re-minting/dual-path code deleted, identity sourced once from
`shell_control`, advisors clean, and eq-context updated.
