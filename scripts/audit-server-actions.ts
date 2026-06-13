/**
 * Server-action security audit — `npx tsx scripts/audit-server-actions.ts`
 * (or `npm run audit:actions`).
 *
 * The Tier-1 companion to the RLS tests. RLS protects the database; this
 * protects the app layer. It statically checks every exported async function
 * in a server-action file and flags mutations that skip the mandatory guard
 * chain from AGENTS.md:
 *
 *     requireUser()  →  role check  →  Zod parse  →  mutation  →  audit log
 *
 * It uses the TypeScript compiler API (not regex) to find functions reliably,
 * then applies text heuristics to each function body.
 *
 * Findings:
 *   ERROR — a mutating action with NO requireUser()/getApiUser() guard. This is
 *           an authorization-bypass risk and fails CI (exit 1).
 *   WARN  — a guarded mutating action missing an audit-log call, or with no
 *           explicit role check (some self-scoped mutations are legitimately
 *           role-free; triage each).
 *
 * Heuristics are conservative: a function is only "mutating" if its body calls
 * .insert/.update/.delete/.upsert. Read-only actions are ignored. Known
 * false-positive functions can be waived in ALLOWLIST below WITH a reason.
 *
 * Exit: 0 = no ERROR findings, 1 = at least one ERROR, 2 = script error.
 */

import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import ts from 'typescript'

// Functions intentionally exempt from a specific check, with justification.
// Key = `relative/path.ts#functionName`.
const ALLOWLIST: Record<string, string> = {
  // Pre-auth: the invite OTP IS the credential (verifyOtp type:'invite'). No
  // session exists yet — requiring one would make invite acceptance impossible.
  'app/(auth)/auth/accept-invite/actions.ts#verifyInviteOtpAndSetupAction':
    'pre-auth — invite OTP is the credential (verifyOtp)',
  // Token-only auth: signed unsubscribe token verified via verifyUnsubscribeToken.
  // One-click email unsubscribe must work without a login (RFC 8058).
  'app/(portal)/portal/unsubscribe/actions.ts#processUnsubscribeAction':
    'token-guarded — signed unsubscribe token, no session by design',
  'app/(portal)/portal/unsubscribe/actions.ts#resubscribeAction':
    'token-guarded — signed unsubscribe token, no session by design',
  // Internal helper — receives an already-authenticated supabase client as its
  // first argument from guarded callers (ACB/NSX/RCD save actions). Not a
  // client-callable entry point despite being exported.
  'lib/actions/check-completion.ts#propagateCheckCompletionIfReady':
    'internal helper — operates on a caller-supplied authenticated client',
  // Internal helper — uses createAdminClient() (service role) and is called
  // only by already-guarded actions. Not a client-callable entry point.
  'lib/actions/notifications.ts#createNotification':
    'internal helper — service-role client, called by guarded actions',
}

interface Finding {
  level: 'ERROR' | 'WARN'
  loc: string
  fn: string
  message: string
}

// A guard establishes WHO the caller is, server-side. Three legitimate forms:
//   • requireUser() / getApiUser() — the standard helpers
//   • a direct Supabase auth resolution: supabase.auth.getUser()/getSession()
//     (the onboarding/settings actions inline this + a tenant_members lookup)
// Pre-auth actions (signInAction et al.) use signInWithPassword/verifyOtp, not
// getUser, so they are not falsely cleared by this.
const GUARD_RE = /\b(requireUser|getApiUser)\s*\(|\.auth\.(getUser|getSession)\s*\(/
const MUTATION_RE = /\.(insert|update|delete|upsert)\s*\(/
const ROLE_RE = /\b(isAdmin|canWrite|canCreateCheck|canDoTestWork|isTenantAdmin)\s*\(/
const AUDIT_RE = /\b(logAuditEvent|logAudit)\s*\(|from\(\s*['"]audit_logs['"]\s*\)/

function listActionFiles(): string[] {
  // git ls-files keeps us to tracked source and avoids node_modules/.next.
  const out = execSync(
    'git ls-files "app/**/actions.ts" "lib/actions/*.ts"',
    { encoding: 'utf8' },
  )
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
}

interface FnInfo {
  name: string
  body: string
  exported: boolean
}

/**
 * Collect ALL named functions in a file (exported or not) — both
 * `function foo()` declarations and `const foo = () =>` / `function expression`
 * assignments. We need the non-exported ones too, because actions frequently
 * delegate their guard to a local wrapper (e.g. `requireTenantAdmin()` that
 * itself calls `requireUser()` + a role check). Detecting those wrappers is
 * what makes the audit trustworthy instead of noisy.
 */
function collectNamedFns(sf: ts.SourceFile): FnInfo[] {
  const results: FnInfo[] = []
  const isExported = (node: ts.Node): boolean =>
    !!(ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      results.push({ name: stmt.name.text, body: stmt.body.getText(sf), exported: isExported(stmt) })
      continue
    }
    if (ts.isVariableStatement(stmt)) {
      const exported = isExported(stmt)
      for (const decl of stmt.declarationList.declarations) {
        const init = decl.initializer
        if (
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
          ts.isIdentifier(decl.name) &&
          init.body
        ) {
          results.push({ name: decl.name.text, body: init.body.getText(sf), exported })
        }
      }
    }
  }
  return results
}

/** A name is "called" in a body if it appears as `name(`. */
function calls(body: string, name: string): boolean {
  return new RegExp(`\\b${name}\\s*\\(`).test(body)
}

function main(): number {
  let files: string[]
  try {
    files = listActionFiles()
  } catch (e) {
    console.error('Failed to list action files via git:', (e as Error).message)
    return 2
  }

  const findings: Finding[] = []
  let mutatingCount = 0

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const fns = collectNamedFns(sf)

    // Local guard wrappers: functions whose own body calls requireUser/getApiUser.
    // An action that calls one of these is guarded transitively (one level —
    // enough for the requireTenantAdmin()-style wrappers used across the app).
    const guardFns = fns.filter((f) => GUARD_RE.test(f.body)).map((f) => f.name)
    // Wrappers that also perform a role check (e.g. requireTenantAdmin →
    // requireUser + isAdmin) count as the role check for their callers.
    const roleFns = fns.filter((f) => ROLE_RE.test(f.body)).map((f) => f.name)

    const bodyHasGuard = (body: string): boolean =>
      GUARD_RE.test(body) || guardFns.some((g) => calls(body, g))
    const bodyHasRole = (body: string): boolean =>
      ROLE_RE.test(body) || roleFns.some((r) => calls(body, r))

    for (const { name, body, exported } of fns) {
      if (!exported) continue // only client-callable entry points are actions
      if (!MUTATION_RE.test(body)) continue // read-only action — out of scope
      mutatingCount++

      const key = `${file}#${name}`
      const hasGuard = bodyHasGuard(body)
      const hasRole = bodyHasRole(body)
      const hasAudit = AUDIT_RE.test(body)

      if (!hasGuard && !ALLOWLIST[key]) {
        findings.push({
          level: 'ERROR',
          loc: file,
          fn: name,
          message: 'Mutating action with no requireUser()/getApiUser() guard — authorization-bypass risk.',
        })
        continue // an unguarded action's other gaps are moot until it's guarded
      }
      if (!hasAudit && !ALLOWLIST[key]) {
        findings.push({
          level: 'WARN',
          loc: file,
          fn: name,
          message: 'Guarded mutating action with no audit-log call (logAuditEvent / audit_logs insert).',
        })
      }
      if (!hasRole && !ALLOWLIST[key]) {
        findings.push({
          level: 'WARN',
          loc: file,
          fn: name,
          message: 'Mutating action with no explicit role check (isAdmin/canWrite/canCreateCheck/canDoTestWork). Confirm the mutation is legitimately self-scoped.',
        })
      }
    }
  }

  const errors = findings.filter((f) => f.level === 'ERROR')
  const warns = findings.filter((f) => f.level === 'WARN')

  console.log(`Server-action audit — ${files.length} files, ${mutatingCount} mutating actions checked.`)
  console.log(`${errors.length} ERROR, ${warns.length} WARN.`)
  console.log('')

  if (findings.length === 0) {
    console.log('✓ Every mutating action is guarded, audited, and role-checked.')
    return 0
  }

  // Group by file for readability.
  const byFile = new Map<string, Finding[]>()
  for (const f of findings) {
    const arr = byFile.get(f.loc) ?? []
    arr.push(f)
    byFile.set(f.loc, arr)
  }
  for (const [file, fs] of [...byFile.entries()].sort()) {
    console.log(file)
    for (const f of fs) console.log(`  [${f.level}] ${f.fn}: ${f.message}`)
    console.log('')
  }

  if (errors.length > 0) {
    console.log(`FAIL — ${errors.length} unguarded mutating action(s). Fix or waive in ALLOWLIST with a reason.`)
    return 1
  }
  console.log('Pass (no ERROR-level findings). Review WARN items.')
  return 0
}

try {
  process.exit(main())
} catch (err) {
  console.error('Audit script failed:', err)
  process.exit(2)
}
