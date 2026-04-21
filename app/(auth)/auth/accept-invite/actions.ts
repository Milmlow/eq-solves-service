'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/lib/actions/audit'

const AcceptInviteSchema = z.object({
  full_name: z.string().trim().min(1, { error: 'Please enter your full name.' }).max(120),
  password: z.string().min(10, { error: 'Password must be at least 10 characters.' }),
  confirm: z.string(),
})

/**
 * Finalises invite acceptance: sets the user's password, syncs their full
 * name onto the profile, audits the event, and redirects into the app.
 *
 * The invite link has already proven email ownership by the time this runs
 * (Supabase exchanged the code for a session in /auth/callback), so we can
 * safely use the service-role admin API to set the password — this bypasses
 * the AAL1/MFA restriction on updateUser({password}) that catches us on the
 * plain password reset flow too.
 *
 * C2 (2026-04-21): Refuse silent revive. If the user accepting the invite
 * has NO active `tenant_members` row in any tenant, we stop here — an admin
 * may have removed their access after the invite email was sent, and the
 * invite link itself shouldn't be a backdoor around that removal. We sign
 * them out and return an error; the admin can re-attach them via the admin
 * UI. (We deliberately do NOT upsert/revive a removed membership here — the
 * removal was an intentional admin decision.)
 */
export async function acceptInviteAction(formData: FormData) {
  const parsed = AcceptInviteSchema.safeParse({
    full_name: formData.get('full_name'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { full_name, password, confirm } = parsed.data

  if (password !== confirm) {
    return { error: 'Passwords do not match.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Your invite link has expired. Ask your administrator to resend it.' }
  }

  const admin = createAdminClient()

  // C2 gate: refuse if the user has no ACTIVE tenant_members row anywhere.
  // A stale invite link from a removed user should NOT give them access
  // back — even if they knew the URL before the removal happened.
  const { data: activeMemberships, error: membershipErr } = await admin
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)

  if (membershipErr) {
    // Fail closed on a DB error rather than let them through without a check.
    return { error: 'Could not verify your access. Please try again in a moment.' }
  }

  if (!activeMemberships || activeMemberships.length === 0) {
    // Sign them out so the cookie session is torn down and they land on
    // /auth/signin cleanly rather than looping through /auth/no-tenant.
    await supabase.auth.signOut()
    // Best-effort audit — helps an admin spot the attempt.
    try {
      await logAuditEvent({
        action: 'update',
        entityType: 'user',
        entityId: user.id,
        summary: 'Blocked invite acceptance — user has no active tenant membership',
      })
    } catch {
      /* non-fatal */
    }
    return {
      error:
        'Your access to this organisation has been removed. Ask an administrator to re-attach your account before signing in.',
    }
  }

  // 1. Set the password.
  const { error: pwErr } = await admin.auth.admin.updateUserById(user.id, { password })
  if (pwErr) {
    return { error: pwErr.message }
  }

  // 2. Sync the full name onto the profile (best-effort — don't block on failure).
  const { error: profileErr } = await admin
    .from('profiles')
    .update({ full_name })
    .eq('id', user.id)
  if (profileErr) {
    // Non-fatal: password is set, user can fix their name later in profile.
    console.error('accept-invite: profile name update failed', profileErr.message)
  }

  await logAuditEvent({
    action: 'update',
    entityType: 'user',
    entityId: user.id,
    summary: 'Accepted invitation and set initial password',
  })

  // 3. Straight into the app — the user is already authenticated.
  redirect('/dashboard')
}
