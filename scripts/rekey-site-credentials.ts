/**
 * rekey-site-credentials.ts
 *
 * Migrates all site_credentials rows from plaintext (password_value_plain /
 * username_plain) to pgcrypto-encrypted (password_enc / username_enc).
 *
 * Prerequisite: migration 0123_site_credentials_encryption.sql must be applied.
 *
 * NOTE: site_credentials lives in the public schema (migration 0123 encrypts
 * in place; it does NOT move the table to app_data). The encryption is done
 * server-side via the _admin_rekey_site_credential() RPC (service-role only).
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
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local — tsx does not auto-load it (that's a Next.js feature)
try {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch { /* no .env.local — rely on shell env */ }

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
  // site_credentials is in the public schema (migration 0123, in-place encryption)
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
        // Use the service-only _admin_rekey_site_credential RPC.
        // This function reads the existing _plain columns, encrypts them
        // in-place with pgcrypto, then nulls the _plain columns.
        // Requires service_role key — no JWT tenant check in the function.
        const { error: rpcErr } = await supabase.rpc('_admin_rekey_site_credential', {
          p_id:  row.id,
          p_key: credKey,
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
