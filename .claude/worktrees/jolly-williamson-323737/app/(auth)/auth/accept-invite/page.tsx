/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential. All rights reserved.
 */
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { AcceptInviteForm } from './AcceptInviteForm'

/**
 * Landing page for a newly invited user after Supabase exchanges the invite
 * code for a session. Distinct from /auth/reset-password so the copy can
 * welcome the user, confirm their tenant + role, and guide them through
 * creating their account — rather than a generic "set a new password" form.
 *
 * The session cookie is already set by /auth/callback before this page loads,
 * so we can read the profile + tenant assignment server-side.
 */
export default async function AcceptInvitePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // If the invite link expired or was already used, direct back to sign-in.
  if (!user) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-bold text-eq-ink tracking-tight">
            This invitation link has expired
          </h1>
          <p className="text-sm text-eq-grey mt-2 leading-relaxed">
            Invite links are single-use and expire after 24 hours.
            Ask the administrator who invited you to resend the link.
          </p>
        </div>
        <Link
          href="/auth/signin"
          className="inline-flex items-center justify-center h-10 px-4 text-sm font-semibold rounded-md bg-eq-sky text-white hover:bg-eq-deep transition-colors"
        >
          Go to sign in
        </Link>
      </div>
    )
  }

  // Profile + tenant context. Both are best-effort — the form still works if
  // either lookup fails (we fall back to generic copy).
  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('tenant_members')
      .select('role, tenant:tenants(name)')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
  ])

  const email = profile?.email ?? user.email ?? ''
  const fullName = profile?.full_name ?? ''
  const tenantName =
    (membership?.tenant as { name?: string } | null | undefined)?.name ?? null
  const role = (membership?.role as string | null) ?? null

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-eq-deep bg-eq-ice px-2 py-1 rounded">
          <span className="w-1.5 h-1.5 rounded-full bg-eq-sky" />
          Invitation accepted
        </span>
        <h1 className="text-2xl font-bold text-eq-ink tracking-tight mt-4 leading-tight">
          Welcome{fullName ? `, ${fullName.split(' ')[0]}` : ''}.
        </h1>
        <p className="text-sm text-eq-grey mt-2 leading-relaxed">
          {tenantName && role ? (
            <>
              You&rsquo;ve been invited to <strong className="text-eq-ink">{tenantName}</strong> as{' '}
              <strong className="text-eq-ink">{formatRole(role)}</strong>. One last step — set
              a password and you&rsquo;re in.
            </>
          ) : (
            <>One last step — set a password and you&rsquo;re in.</>
          )}
        </p>
      </div>

      <StepRail />

      <AcceptInviteForm email={email} initialName={fullName} />

      <p className="text-[11px] text-eq-grey leading-relaxed border-t border-gray-100 pt-4">
        Passwords are stored using industry-standard one-way hashing — not even
        we can read them. You can enable two-factor authentication from your
        profile after you sign in.
      </p>
    </div>
  )
}

function formatRole(role: string): string {
  switch (role) {
    case 'super_admin':
      return 'Super Administrator'
    case 'admin':
      return 'Administrator'
    case 'supervisor':
      return 'Supervisor'
    case 'technician':
      return 'Technician'
    case 'read_only':
      return 'Read Only'
    default:
      return role
  }
}

function StepRail() {
  const steps = [
    { n: 1, label: 'Confirm your details' },
    { n: 2, label: 'Set a password' },
    { n: 3, label: 'Enter the platform' },
  ]
  return (
    <ol className="flex items-center gap-0 text-[11px] font-medium text-eq-grey">
      {steps.map((s, i) => (
        <li key={s.n} className="flex items-center gap-2 flex-1">
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-eq-ice text-eq-deep text-[10px] font-bold">
            {s.n}
          </span>
          <span className="whitespace-nowrap">{s.label}</span>
          {i < steps.length - 1 && (
            <span className="flex-1 h-px bg-gray-200 ml-1" />
          )}
        </li>
      ))}
    </ol>
  )
}
