# Supabase Auth configuration — EQ Solves Service

Everything that has to be set in the Supabase dashboard for the invite / reset /
sign-in flow to work against production (`https://eq-solves-service.netlify.app`).

Project: `urjhmkhbgaxrofurpbgc` (eq-solves-service-dev — treat as prod for now).

> **2026-04-20 — important change.** The invite and recovery email templates
> now use `{{ .TokenHash }}` routed through `/auth/callback?token_hash=…&type=…`
> instead of the old `{{ .ConfirmationURL }}`. The old template returned the
> session in a URL **fragment** (`#access_token=…`), which a Next.js server
> route cannot read — users who clicked the invite link landed on `/auth/signin`
> with a generic error instead of `/auth/accept-invite`. The token_hash flow is
> server-side (calls `supabase.auth.verifyOtp()` from the callback route) and
> works end-to-end. If you ever revert this — yes, the invite flow will break
> again.

---

## 1. Site URL + Redirect allowlist

Dashboard → **Authentication → URL Configuration**.

### Site URL
```
https://eq-solves-service.netlify.app
```

This is the base URL that gets templated into every `{{ .SiteURL }}` placeholder
in the email templates, and the fallback redirect when `redirectTo` isn't sent.
Leaving this as `http://localhost:3000` is why invite emails were pointing at
localhost.

### Redirect URLs (Additional)
One URL per line — Supabase requires an exact match (including the `/auth/...`
suffix) for any `redirectTo` passed from the app.

```
https://eq-solves-service.netlify.app/auth/callback
https://eq-solves-service.netlify.app/auth/accept-invite
https://eq-solves-service.netlify.app/auth/reset-password
https://eq-solves-service.netlify.app/auth/signin
https://eq-solves-service.netlify.app/auth/mfa
https://eq-solves-service.netlify.app/auth/enroll-mfa
https://*--eq-solves-service.netlify.app/auth/callback
https://*--eq-solves-service.netlify.app/auth/accept-invite
https://*--eq-solves-service.netlify.app/auth/reset-password
http://localhost:3000/auth/callback
http://localhost:3000/auth/accept-invite
http://localhost:3000/auth/reset-password
```

The two `*--eq-solves-service.netlify.app` entries cover Netlify deploy-preview
branches (`deploy-preview-123--eq-solves-service.netlify.app`). The two
`localhost` entries let dev builds still receive email links — remove them
before the app goes fully commercial.

Click **Save** at the bottom.

---

## 2. SMTP (already done, verify)

Dashboard → **Authentication → SMTP Settings** → should be set to Resend.

If it shows "default provider" the invite emails will be rate-limited to 2/hour
and will not deliver reliably.

---

## 3. Email templates

Dashboard → **Authentication → Email Templates**. Each template has a **Subject**
and a **Body (HTML)** field. Paste exactly as written — `{{ .SiteURL }}`,
`{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .Token }}` are server-rendered
placeholders, leave them literal.

All templates use inlined styles (mail clients strip `<style>` blocks) and the
EQ brand tokens: `#3DA8D8` primary, `#2986B4` deep, `#EAF5FB` ice, `#1A1A2E`
ink. Plus Jakarta Sans is loaded with a sans-serif fallback.

---

### 3.1. Invite user

**Subject**
```
You've been invited to EQ Solves Service
```

**Body (HTML)**
```html
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#EAF5FB;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1A1A2E;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#EAF5FB;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;border:1px solid #E1EDF4;border-radius:8px;max-width:560px;">
            <tr>
              <td style="padding:32px 32px 16px 32px;border-bottom:1px solid #EAF5FB;">
                <div style="font-size:20px;font-weight:600;color:#2986B4;letter-spacing:-0.01em;">EQ Solves Service</div>
                <div style="font-size:13px;color:#6B7A8A;margin-top:2px;">by EQ · CDC Solutions</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:600;color:#1A1A2E;letter-spacing:-0.01em;">You've been invited</h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;color:#1A1A2E;">
                  You&rsquo;ve been invited to <strong>EQ Solves Service</strong> &mdash; the maintenance management platform for electrical contractors.
                </p>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;color:#1A1A2E;">
                  Click the button below to confirm your details, set a password, and you&rsquo;re in. The whole thing takes about 30 seconds.
                </p>
                <p style="margin:0 0 24px 0;font-size:13px;line-height:1.5;color:#6B7A8A;">
                  This link is single-use and expires in 24 hours.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background-color:#3DA8D8;border-radius:6px;">
                      <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/auth/accept-invite" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;letter-spacing:0.01em;">Set up my account</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:20px 0 0 0;font-size:13px;line-height:1.5;color:#6B7A8A;">
                  Or copy this URL into your browser:<br/>
                  <span style="word-break:break-all;color:#2986B4;">{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&amp;type=invite&amp;next=/auth/accept-invite</span>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background-color:#F7FBFD;border-top:1px solid #EAF5FB;border-radius:0 0 8px 8px;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#6B7A8A;">
                  If you weren't expecting this invite, you can ignore this email — no account will be created without clicking the link.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0 0;font-size:11px;line-height:1.5;color:#8A96A3;max-width:560px;">
            © EQ · CDC Solutions Pty Ltd · ABN 40 651 962 935 · All rights reserved.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
```

---

### 3.2. Reset password

**Subject**
```
Reset your EQ Solves Service password
```

**Body (HTML)**
```html
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#EAF5FB;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1A1A2E;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#EAF5FB;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;border:1px solid #E1EDF4;border-radius:8px;max-width:560px;">
            <tr>
              <td style="padding:32px 32px 16px 32px;border-bottom:1px solid #EAF5FB;">
                <div style="font-size:20px;font-weight:600;color:#2986B4;letter-spacing:-0.01em;">EQ Solves Service</div>
                <div style="font-size:13px;color:#6B7A8A;margin-top:2px;">by EQ · CDC Solutions</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:600;color:#1A1A2E;letter-spacing:-0.01em;">Reset your password</h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;color:#1A1A2E;">
                  We received a request to reset the password for the account <strong>{{ .Email }}</strong>.
                </p>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.55;color:#1A1A2E;">
                  Click the button below to choose a new password. The link is single-use and expires in 1 hour.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background-color:#3DA8D8;border-radius:6px;">
                      <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset-password" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;letter-spacing:0.01em;">Reset password</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:20px 0 0 0;font-size:13px;line-height:1.5;color:#6B7A8A;">
                  Or copy this URL into your browser:<br/>
                  <span style="word-break:break-all;color:#2986B4;">{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&amp;type=recovery&amp;next=/auth/reset-password</span>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background-color:#F7FBFD;border-top:1px solid #EAF5FB;border-radius:0 0 8px 8px;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#6B7A8A;">
                  If you didn't request a password reset, you can ignore this email — your password won't change. If this keeps happening, contact your administrator.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0 0;font-size:11px;line-height:1.5;color:#8A96A3;max-width:560px;">
            © EQ · CDC Solutions Pty Ltd · ABN 40 651 962 935 · All rights reserved.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
```

---

### 3.3. Magic Link (optional — keep default if unused)

Not used by the current app flow. Leave on default or mirror the Reset template
if you want branded links everywhere.

---

### 3.4. Confirm signup / Change email

Same pattern, same frame. If/when you need them, clone §3.2 and swap the
heading + body copy.

---

## 4. After changing config — smoke test

1. `/admin/users` → invite a fresh test user (e.g. `royce+test@eq.solutions`).
2. Open the email — the "Set up my account" URL must start with
   `https://eq-solves-service.netlify.app/auth/callback?token_hash=…&type=invite&next=/auth/accept-invite`,
   NOT `http://localhost:3000` and NOT pointing at `<project>.supabase.co/auth/v1/verify`.
3. Click the link. You should land on `/auth/accept-invite` with a welcome
   header ("Welcome, {first name}."), the tenant + role you assigned, a
   3-step rail, and the password form enabled (no "Auth session missing"
   banner). If you bounce back to `/auth/signin?error=…` instead, the email
   template is still on the old `{{ .ConfirmationURL }}` shape — see the
   2026-04-20 note at the top of this runbook.
4. Fill in full name (if not pre-filled), set a password (live strength
   meter turns green at 10+ chars with mixed case / digits / symbols),
   confirm, submit. You should be signed in and redirected to `/dashboard`.
5. Sign out, request **Forgot password** from the sign-in page — that flow
   still lands on `/auth/reset-password` (generic "set a new password"
   copy). Same session bootstrap logic, different page.

If any of these fail, the first thing to check is the Redirect URLs allowlist
(missing entries fail silently with a generic error on the callback page).
