# Gotenberg — HTML to PDF service

This directory holds the deploy config for our Gotenberg instance on Fly.io.

## What it is

Gotenberg is a stateless HTTP service that takes HTML and returns a PDF.
We use it as the rendering backend for every customer-facing report the app
generates (maintenance check, ACB test, NSX test, compliance, defect register,
work order details).

The app code in `lib/reports/pdf-renderer.ts` is a thin wrapper that POSTs HTML
to this service and returns the PDF buffer. If we ever swap the rendering
backend (Browserless, self-hosted Chromium, etc.), only that one file changes.

## Deploy

From this directory:

```bash
fly launch --copy-config --no-deploy
fly deploy
```

After the first deploy, Fly assigns a public URL — copy it into Netlify env as
`GOTENBERG_URL`.

## Operate

```bash
fly status              # is it running?
fly logs                # tail logs
fly scale memory 2048   # bump RAM if large reports OOM
fly scale count 2       # add a machine to handle concurrent renders
```

## Known gaps

- **No authentication.** The Fly URL alone gates access. Before routing real
  customer reports through this service, add basic auth (Caddy sidecar with
  `basicauth` directive, or nginx with `auth_basic`). Tracked as Phase 1c.
- **Cold starts.** With `min_machines_running = 0`, the first request after
  idle takes 5–10 seconds while Fly boots a machine. Set `min_machines_running
  = 1` once we route production traffic if cold starts hurt UX.
