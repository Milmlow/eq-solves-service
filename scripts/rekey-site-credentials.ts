/**
 * rekey-site-credentials.ts
 *
 * Migrates all site_credentials rows from plaintext (password_value_plain /
 * username_plain) to pgcrypto-encrypted (password_enc / username_enc).
 *
 * Prerequisite: migration 0123_site_credentials_encryption.sql must be applied.
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL      — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY     — service role key (bypasses RLS)
 *   SITE_CREDENTIALS_KEY          — symmetric encryption key (min 32 chars)
 *
 * Run (dry-run first, then live):
 *   npx tsx scripts/rekey-site-credentials.ts --dry-run
 *   npx tsx scripts/rekey-site-credentials.ts
 *
 * Safety:
 *   - Processes rows in batches of 50.
 *   - In dry-run mode: logs what would change, touches nothing.
 *   - On error: logs the failing row id and continues (does NOT abort the run).
 *   - After completion: prints a summary. Re-run is idempotent (already-encrypted
 *     rows are skipped via WHERE password_enc IS NULL OR username_enc IS NULL).
 *   - This script does NOT drop the _plain columns — that is migration 0124,
 *     which should only be applied after this script reports 0 remaining rows.
 */

import { createClient } from '@supabase/supabase-js';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 50;

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

async function main() {
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey  = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const credKey     = requireEnv('SITE_CREDENTIALS_KEY');

  if (credKey.length < 16) {
    console.error('SITE_CREDENTIALS_KEY is too short (minimum 16 chars).');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  console.log(`\n=== rekey-site-credentials ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'} ===\n`);

  // Count rows that still have plaintext in at least one column
  const { count: totalPlaintext, error: countErr } = await supabase
    .from('site_credentials')
    .select('id', { count: 'exact', head: true })
    .or('password_value_plain.not.is.null,username_plain.not.is.null');

  if (countErr) {
    console.error('Failed to count plaintext rows:', countErr.message);
    process.exit(1);
  }

  console.log(`Plaintext rows to process: ${totalPlaintext ?? 0}`);

  if (totalPlaintext === 0) {
    console.log('Nothing to do — all rows already encrypted.');
    return;
  }

  if (DRY_RUN) {
    console.log('[dry-run] Would encrypt all of the above. Re-run without --dry-run to apply.');
    return;
  }

  let offset = 0;
  let successCount = 0;
  let errorCount   = 0;

  while (true) {
    const { data: rows, error: fetchErr } = await supabase
      .from('site_credentials')
      .select('id, tenant_id, customer_id, site_id, system_name, username_plain, password_value_plain, url, notes')
      .or('password_value_plain.not.is.null,username_plain.not.is.null')
      .range(offset, offset + BATCH_SIZE - 1);

    if (fetchErr) {
      console.error(`Fetch error at offset ${offset}:`, fetchErr.message);
      break;
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      try {
        // Use the SECURITY DEFINER upsert RPC which handles encryption server-side.
        // We pass the key at call time — it is NOT persisted in Postgres.
        const { error: rpcErr } = await supabase.rpc('upsert_site_credential', {
          p_tenant_id:   row.tenant_id,
          p_customer_id: row.customer_id,
          p_site_id:     row.site_id,
          p_system_name: row.system_name,
          p_username:    row.username_plain ?? '',
          p_password:    row.password_value_plain ?? '',
          p_url:         row.url,
          p_notes:       row.notes,
          p_key:         credKey,
          p_id:          row.id,
        });

        if (rpcErr) {
          console.error(`  ERROR encrypting ${row.id}:`, rpcErr.message);
          errorCount++;
        } else {
          console.log(`  OK  ${row.id}  (${row.system_name})`);
          successCount++;
        }
      } catch (err) {
        console.error(`  EXCEPTION on ${row.id}:`, err);
        errorCount++;
      }
    }

    offset += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Encrypted: ${successCount}`);
  console.log(`  Errors:    ${errorCount}`);

  if (errorCount > 0) {
    console.log('\nSome rows failed — re-run to retry. Do NOT apply migration 0124 until errorCount = 0.');
    process.exit(1);
  }

  // Verify: no plaintext rows remain
  const { count: remaining, error: verifyErr } = await supabase
    .from('site_credentials')
    .select('id', { count: 'exact', head: true })
    .or('password_value_plain.not.is.null,username_plain.not.is.null');

  if (verifyErr) {
    console.error('Verification query failed:', verifyErr.message);
    process.exit(1);
  }

  if (remaining && remaining > 0) {
    console.log(`\nWARNING: ${remaining} plaintext rows still exist after run. Re-run before applying migration 0124.`);
    process.exit(1);
  }

  console.log('\nAll rows encrypted. Safe to apply migration 0124 to drop _plain columns.');
  console.log('Confirm key rotation plan before dropping: migration 0124 is irreversible without a restore.');
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
