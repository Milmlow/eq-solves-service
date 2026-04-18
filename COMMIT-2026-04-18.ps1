#############################################################################
#  EQ Solves Service — commit session 2026-04-18
#  Run from: C:\Projects\eq-solves-service
#############################################################################
#  What this session delivered:
#    - Migration 0047 (logo variants on tenant_settings, site logos,
#      media_library.surface column, primary_contact_id FKs + backfill)
#    - Dual logo variants (light + dark) wired through:
#        MediaPicker, Media Library, Customer + Site + Tenant + Report forms
#    - PM Asset Report: Notes column, always-visible Defects/Action rows,
#      complexity-differentiated Standard vs Detailed (wider Notes + tech
#      notes block + photos in Detailed)
#    - Master /contacts page — union of customer + site contacts with
#      filters and CSV export (no new table; reads existing tables)
#    - SKS tenant_settings seed SQL template (supabase/seeds/)
#    - Smoke test for PM Asset Report at all three complexity levels
#    - tsc --noEmit = 0 errors
#
#  Do a `git status` + `git diff` review BEFORE running the commit line.
#  Do NOT push — this script deliberately stops at commit.
#############################################################################

Set-Location -Path 'C:\Projects\eq-solves-service'

# 1. Review
git status
git diff --stat

# 2. Type-check one more time (belt-and-braces)
npx tsc --noEmit --pretty false

# 3. Stage specifically — avoid -A so we never grab .env or build artefacts.
git add supabase/migrations/0047_logo_variants_and_contacts.sql
git add supabase/seeds/sks-tenant-settings.sql
git add app/`(app`)/contacts/page.tsx
git add app/`(app`)/contacts/ContactList.tsx
git add scripts/smoke-pm-report.mjs
git add tests/lib/reports/pm-asset-report.smoke.test.ts
git add components/ui/MediaPicker.tsx
git add components/ui/Sidebar.tsx
git add app/`(app`)/admin/media/actions.ts
git add app/`(app`)/admin/media/MediaLibraryClient.tsx
git add lib/types/index.ts
git add app/`(app`)/customers/CustomerForm.tsx
git add app/`(app`)/customers/actions.ts
git add app/`(app`)/sites/SiteForm.tsx
git add app/`(app`)/sites/actions.ts
git add app/`(app`)/admin/reports/ReportSettingsForm.tsx
git add app/`(app`)/admin/reports/actions.ts
git add app/`(app`)/admin/settings/TenantSettingsForm.tsx
git add lib/reports/logo-variants.ts
git add lib/reports/pm-asset-report.ts
git add lib/tenant/getTenantSettings.ts
git add app/api/pm-asset-report/route.ts
git add app/api/acb-report/route.ts
git add app/api/nsx-report/route.ts

# 4. Single commit for the whole finish
$body = @'
Dual logo variants, master contacts list, PM Asset Report polish

- Migration 0047: logo_url_on_dark on tenant_settings/customers/sites,
  media_library.surface enum (light/dark/any) + index, primary_contact_id
  FKs on customers/sites with backfill from is_primary rows
- Logo variants wired through MediaPicker, MediaLibrary, and the
  Customer/Site/Tenant/Report settings forms (light + dark)
- logo-variants resolver rebuilt around tenant_settings (tenants table has
  no logo columns); ACB/NSX/PM report routes updated to drop the broken
  tenants.logo_url select
- PM Asset Report: Notes column in the checklist table; Defects Found +
  Recommended Action now always render with "None identified." fallback;
  Summary/Standard/Detailed meaningfully differentiated (Detailed gets a
  wider Notes column, Technician Notes block, and asset photos)
- New /contacts master list: union over customer_contacts + site_contacts
  with primary-only filter, type filter, CSV export; sidebar link added
- supabase/seeds/sks-tenant-settings.sql scaffolded with TODO placeholders
  for Royce to fill in ABN, phone, address, then run in the SQL editor
- Vitest smoke test at tests/lib/reports/pm-asset-report.smoke.test.ts
  emits three .docx files to tmp/smoke/ for visual QA

tsc --noEmit: 0 errors
'@

git commit -m $body

# 5. Remind about next steps — do NOT push from here.
Write-Host ''
Write-Host 'Commit complete. Review with: git log -1' -ForegroundColor Green
Write-Host 'When ready, push manually:  git push origin main' -ForegroundColor Yellow
Write-Host ''
Write-Host 'Still to do in Supabase (SQL editor, project urjhmkhbgaxrofurpbgc):' -ForegroundColor Cyan
Write-Host '  1. Paste and run supabase/migrations/0047_logo_variants_and_contacts.sql' -ForegroundColor Cyan
Write-Host '     (idempotent — safe if you already applied the columns manually)' -ForegroundColor Cyan
Write-Host '  2. Fill the TODO fields in supabase/seeds/sks-tenant-settings.sql,' -ForegroundColor Cyan
Write-Host '     then run it to populate SKS tenant_settings with ABN/phone/address' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Then run the smoke test locally:' -ForegroundColor Cyan
Write-Host '  npx vitest run tests/lib/reports/pm-asset-report.smoke.test.ts' -ForegroundColor Cyan
Write-Host '  → open tmp/smoke/pm-asset-report-{summary,standard,detailed}.docx' -ForegroundColor Cyan
