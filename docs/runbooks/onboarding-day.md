# Onboarding-Day Runbook

> The SKS team's first day on EQ Service replacing Simpro. They leave the
> room actually using it. This is the day-of checklist for Royce.

**Audience for this doc:** Royce (running the day).
**Audience for the day itself:** 1–5 SKS technicians + Royce. Hands-on,
workshop-shaped, no execs to perform for.

---

## The week before

### T-7 days — confirm logistics

- [ ] Date + time + venue locked. Send a calendar invite to each tech with
  the location + parking instructions.
- [ ] Each tech has a working email on file. Cross-check against the
  list of expected attendees.
- [ ] Wi-Fi access at the venue confirmed. If patchy, plan for tech phones
  on mobile data — the app works fine on 4G.
- [ ] One printed copy of [`docs/tech-quick-reference.md`](../tech-quick-reference.md)
  per attendee + spare. Laminate if you want them to keep them in the kit.

### T-7 days — create accounts

- [ ] In `/admin/users` invite each tech with role = `technician`.
- [ ] Each tech receives the invite email and sets a password.
- [ ] Each tech enrols in MFA when first signing in (14-day grace already
  in place via PR #167 — they don't have to do it on day one, but
  encourage it).
- [ ] Sanity-check the tenant assignment: each tech sees the SKS workspace,
  not Demo, on first sign-in. The [`/admin/users` Attach button](../runbooks/scheduled-tasks-setup.md)
  handles any orphaned-user fallout.

### T-3 days — seed the practice space + capture site context

- [ ] Run `supabase/seeds/demo-practice-space.sql` against prod (paste
  into the Supabase SQL editor). Creates the "DEMO — Practice Space"
  customer + 1 site + 8 assets + 3 checks + 2 defects. Idempotent —
  safe to re-run.
- [ ] Capture the **site access fields** (gate code, parking, after-hours,
  safety) for at least the sites you expect techs to visit in their
  first week. `/sites/[id]` form has the new "Site access" section.
  Empty fields hide cleanly from the tech's check page — but every
  field captured = one less "where do I park?" Slack message.

### T-3 days — confirm a sample customer report is beautiful

- [ ] Open `/maintenance/[id]` for the freshest completed Equinix or
  Jemena check.
- [ ] Click **Customer Report** → download the PDF.
- [ ] Open it on a real computer (not in the browser's PDF viewer).
- [ ] If anything looks unfinished (broken images, missing logo, ugly
  table), fix it before the day. This is the artefact customers see.
- [ ] Print 1–2 copies and bring them. Hand out at the start as "this
  is what we deliver every month."

### T-1 day — full pre-day backup

- [ ] `/admin/backup` → **Download backup ZIP**. Save to your laptop +
  cloud storage. The whole workspace is a single ZIP — if anything
  goes catastrophically sideways during the day, this is your unwind.
- [ ] Open the backup ZIP in the Preview tab on the same page to
  confirm it parsed correctly — entity counts shown, sample rows
  visible per entity.

### T-1 day — quick smoke test on prod

- [ ] Sign in as your own account on a phone.
- [ ] Open a real check → tap **Start Check** → grant geolocation when
  prompted → confirm the check enters `in_progress`.
- [ ] Open `/admin/today` → confirm your check shows under "Onsite now".
- [ ] Tap a few tasks pass/fail to confirm the TaskRow buttons feel right.
- [ ] Upload a photo via Attachments → confirm the camera opens
  directly (not the file picker) → confirm thumbnail appears after.
- [ ] Sign out, sign back in to confirm credentials work cleanly.

---

## The day itself

### Pre-arrival (you, the day-of)

- [ ] Open `/admin/today` on a wall display or laptop you can leave
  visible to the room. This is the live drip — techs flipping from
  "Not started" to "Onsite" as they begin.
- [ ] Open `/admin/activity` on a second screen if you have one. Same
  data, broader view (every action across the workspace).
- [ ] Pre-sign into the demo account on the wall-display device so the
  refresh doesn't kick a sign-in prompt mid-day.
- [ ] Have the printed quick-ref cards + customer-report sample on the
  table.

### As techs arrive

- [ ] Hand each tech a printed quick-ref card.
- [ ] Hand round the sample customer report and frame: "this is what
  every customer gets at the end of every month — this is what we're
  building."
- [ ] Walk each tech through signing in on their own phone. Confirm MFA
  setup; explain the 14-day grace if they want to defer.
- [ ] Open `/do` together — explain the action hub is their starting
  point.

### The first hour — guided practice in the DEMO space

- [ ] Send each tech to the **DEMO — Practice Space** customer →
  the "Quarterly Plant Inspection" check (scheduled).
- [ ] Walk the workflow together once on one tech's phone:
  - Tap **Start Check** → geolocation prompt → grant
  - Tap pass/fail/N/A on a few tasks
  - Add a note to one task
  - Add a photo to Attachments (camera opens directly)
  - Raise a defect with a photo
  - Tap **Complete Check** (sticky bottom bar)
- [ ] Show the room `/admin/today` as their work registers in real
  time. The live drip is the demo.
- [ ] Repeat once on each tech's phone, the rest of the team watching.
  Five techs × 5 minutes each = 25 minutes, everyone has done it once.

### Then — real work in the DEMO space

- [ ] Each tech runs the in-progress check independently. They hit the
  partially-completed state (3 items pre-passed, 1 pre-failed with a
  note) and see how to amend / continue.
- [ ] Each tech raises one defect on the NSX asset with a photo. Walk
  the defect register afterwards.
- [ ] Each tech downloads the customer report for the *completed*
  check. Show what they produced.

### Mid-day — real assigned work

- [ ] If timing aligns, give each tech 1–2 real assigned checks for
  the rest of the day. Their actual day-1 onsite work starts here.
- [ ] You stay on `/admin/today` watching. If a tech disappears off
  the feed mid-job, message them — "you OK? Network drop?"

### End of day — close-out

- [ ] Each tech confirms every check they started today is either
  **complete** or has a note explaining where they got up to.
- [ ] Each defect has a photo + description.
- [ ] Click `/admin/backup` → **Download backup ZIP** a second time.
  Save under `eq-service-backup-{tenant}-onboarding-day-evening.zip`
  somewhere durable. This is the canonical "this is the state at
  end-of-day-1" record.
- [ ] 15-minute debrief: what worked, what was awkward, what's missing.
  Write notes — these become the next round of fix priorities.

---

## If something goes wrong

### The app won't load for a tech

1. Check their wi-fi vs mobile data. The venue wi-fi might be the issue.
2. Have them sign out and back in.
3. If still bad, check `/admin/users` to confirm their account isn't
   locked / disabled.
4. Last resort: get them set up on a spare device.

### A tech accidentally completes a real check

1. As supervisor, open the check → **Reopen Check** at the top.
2. Returns it to `in_progress` so the tech can amend.
3. Audit log captures the reopen — no data lost.

### Wi-Fi dies completely

1. Mobile data on phones still works.
2. The wall display can run from a hotspot if needed.
3. The printed quick-ref + sample customer report carry the room if
   the screen goes dark.

### Real data accidentally gets edited (not DEMO data)

1. The morning's backup ZIP has the pre-day snapshot. Pre-day download
   from T-1 step above.
2. Open `/admin/backup` Preview tab on the ZIP to confirm what state
   that record was in.
3. Manually re-create / fix the affected rows. Audit log shows you who
   did what.

### A defect with a photo got raised in error

1. As admin, archive the defect from `/defects/[id]`.
2. The photo on the attachment row → admin sees a delete button (44px
   target on the row).

---

## Escalation paths during the day

| Issue | Who | How |
|---|---|---|
| App bug | Royce (you) | Note for the post-day fix list |
| Cannot sign in / locked out | Royce | Reset via `/admin/users` |
| Phone-specific weirdness | Note for post-day | Try on a different device first |
| Data anomaly | Royce | Audit log + activity feed will show what happened |
| Anything else | Royce | You're the room |

---

## Post-day

### Same evening (or next morning)

- [ ] Skim `/admin/activity` from the day. Look for anything weird —
  unexpected deletes, anomalous timestamps.
- [ ] Skim `/admin/today` for any checks left in `in_progress` that
  should be `complete`. Either complete them or chase the tech.
- [ ] Write the debrief notes into a follow-up doc — what's the top-5
  fix list from observing the day?

### Within the week

- [ ] One-to-one check-in with each tech: how are they finding it 3
  days in? What's not on the quick-ref card that should be?
- [ ] Update [`tech-quick-reference.md`](../tech-quick-reference.md)
  with anything that came up — print a v2 if needed.
- [ ] File the top-5 fixes from the debrief notes. PRs as Royce.

### Ongoing

- [ ] Backup ZIP weekly (every Friday) via `/admin/backup`.
- [ ] Review `/admin/imports` after each Maximo monthly drop to confirm
  the WO import lands cleanly.
- [ ] Site Access fields filled in across the rest of the SKS sites as
  techs visit them for the first time. Use the amber "no address
  recorded" prompt on the check page as the trigger.

---

## What this runbook does NOT cover

- New-customer onboarding (the SKS internal day is different from
  bringing a new customer onto the platform — that's a separate
  runbook to write closer to needing it)
- Mobile device management / corporate device rollout (techs are using
  their own phones today)
- Anything to do with billing / invoicing (CMMS, not trades platform)
- Anything to do with the EQ Field / EQ Shell integration (separate
  initiative, not in scope for the SKS internal launch)

---

Built 2026-05-21 for the SKS onboarding day prep. Update as the day
gets closer + after the debrief.
