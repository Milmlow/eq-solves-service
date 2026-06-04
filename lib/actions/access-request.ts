'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

/**
 * Access-request actions for tenant-less users (the replacement for the dead
 * "No tenant assigned" gate). These deliberately do NOT use requireUser() —
 * that resolves a tenant + role, which a tenant-less user does not have. They
 * authenticate the user directly and operate only on the user's OWN request
 * row, which RLS (migration 0117) permits without any tenant context.
 *
 * `access_requests` is newer than the committed database.types.ts, so the typed
 * client doesn't know the table yet — we narrow to an untyped client handle for
 * these calls (the repo's stale-types workaround) until types are regenerated
 * post-migration.
 */

const NoteSchema = z.object({
  note: z.string().trim().max(500).optional(),
})

export async function requestAccessAction(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const parsed = NoteSchema.safeParse({ note: (formData.get('note') as string) || undefined })
  const note = parsed.success ? parsed.data.note ?? null : null

  const db = supabase as unknown as SupabaseClient
  // The partial unique index (one pending per user) backstops double-submits;
  // a duplicate just errors harmlessly and the UI re-renders the pending state.
  const { error } = await db.from('access_requests').insert({
    user_id: user.id,
    email: user.email ?? '',
    note,
    status: 'pending',
  })
  if (error && !/duplicate|unique/i.test(error.message)) {
    console.error('[access-request] insert failed', error.message)
  }
  revalidatePath('/', 'layout')
}

export async function cancelAccessRequestAction() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const db = supabase as unknown as SupabaseClient
  await db
    .from('access_requests')
    .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('status', 'pending')
  revalidatePath('/', 'layout')
}
