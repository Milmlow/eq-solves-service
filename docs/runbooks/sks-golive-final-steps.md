# SKS go-live — final execution sprint

**Created 2026-06-06.** Everything engineering is built, merged, and live in prod (`service.eq.solutions`, deploy `680e8f4` ready). What remains is operational. Each item below is turnkey: owner, exact steps, verification.

Ownership legend: **[Claude]** I can/did do it · **[Royce]** needs your device, infra coordination, or a go-live-timing call.

---

## 1. Pre-visit brief cron — verify dry-run, then enable on go-live day

The cron is deployed and scheduled (`0 7 * * *` ≈ 17:00 AEST), running **dry-run** (emails nobody) until `PRE_VISIT_BRIEF_CRON_ENABLED=true`.

### 1a. [Royce] Verify the dry-run (anytime — safe, sends nothing)
Trigger it manually and read the counts (`mode` must be `"dry_run"`):
```bash
curl -s -X POST https://service.eq.solutions/api/cron/pre-visit-brief \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```
(`$CRON_SECRET` is in Netlify env.) Expect `{ ok: true, mode: "dry_run", total, dryRunWould, skippedOptOut, ... }`. `total` is how many checks are scheduled for *tomorrow* with an assigned tech. Today there likely are none until real week-1 work is scheduled — a clean `total: 0` still confirms the plumbing.

### 1b. [Royce] Enable auto-send — **on go-live, not before**
Only flip this once SKS is live and you've seen a sensible dry-run. In Netlify → env vars:
```
PRE_VISIT_BRIEF_CRON_ENABLED = true   (context: production)
```
From the next 07:00 UTC fire, real briefs go to assigned techs for tomorrow's checks. To pause: delete the var (reverts to dry-run).

> Not enabled now on purpose: enabling today would email techs every night before go-live about whatever's scheduled, including demo/test data.

---

## 2. P0-5 — go-live dress rehearsal  [Royce — needs a phone + prod login]

The DB layer is already proven (all four auto-defect paths verified in prod). This is the human end-to-end pass. Use the seeded **DEMO — Practice Space** so nothing real is touched.

Tick one pass per workflow:
- [ ] Sign in on a phone → MFA (14-day grace explained)
- [ ] **PPM:** open the DEMO scheduled check → Start → pass/fail an item → **confirm a defect appears** (this is the bug we fixed) → upload a photo → Complete
- [ ] **ACB:** start a test on a DEMO ACB asset → fail a reading → confirm defect raised
- [ ] **NSX:** same on the DEMO NSX asset
- [ ] **RCD:** enter circuit timing → save
- [ ] Generate a **customer report** + **run-sheet** for a completed DEMO check → confirm SKS branding + content
- [ ] (Optional) **Send brief** on a check with an assigned tech → confirm email + bell + attachments arrive

If anything errors, capture it — but the riskiest path (failing items) is already fixed and regression-tested.

---

## 3. EQ_PLATFORM_ADMIN_KEY  [Royce — cross-repo coordination]

Not set in Service. It gates `/api/tenants` provisioning (currently fail-closed = 503, which is safe). **Not an SKS go-live blocker** — SKS already exists; this only matters for provisioning *new* tenants from Shell.

When you do set it: the **same value must be set on both EQ Shell (caller) and Service (validator)** — that's why I'm not generating one unilaterally (a Service-only value would mismatch Shell). Generate one strong key, set it in both Netlify projects as a **secret** env var.

---

## 4. Netlify secret hygiene  [Royce — quick hardening]

`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and `CRON_SECRET` are stored as **plaintext** env vars (not flagged secret) — readable in the Netlify UI/API by anyone with project access. Re-save each with the "secret" toggle on (Netlify → env var → mark as secret). Especially the **service-role key** (full DB bypass). No code change; values stay the same.

---

## 5. Week-1 real PM scheduling  [Royce — needs your visit plan]

You chose "I'll schedule later." Demo space + the existing 7 scheduled checks cover day-1. When you have the week-1 site list + dates, the batch-create flow (`/maintenance` → Create) generates them; tell me the sites/dates and I'll script it.

---

## 6. package-lock.json  [Claude — done]

Reverted the local `npm install` artifact from the worktree; tree is clean.

---

## Status board

| Item | Owner | State |
|---|---|---|
| Auth, foundation, tech brief (Phase 0/1/2), auto-defect fix | Claude | ✅ built, merged, live |
| Cron dry-run verify | Royce | ⏳ 1 curl (§1a) |
| Cron enable | Royce | ⏳ go-live flip (§1b) |
| Dress rehearsal | Royce | ⏳ phone pass (§2) |
| EQ_PLATFORM_ADMIN_KEY | Royce | ⏳ Shell+Service coord (§3) |
| Netlify secret hygiene | Royce | ⏳ toggle (§4) |
| Week-1 PM scheduling | Royce | ⏳ your plan (§5) |
| package-lock cleanup | Claude | ✅ done (§6) |
