'use client'

import { useEffect } from 'react'

const SHELL_ORIGIN = 'https://core.eq.solutions'

// Signals to the EQ Shell parent frame that Service has fully loaded and the
// session is established. Shell listens for this to reveal the iframe.
//
// Detection is client-side (window.parent !== window) so it works even when
// the eq_shell_bridge cookie is partitioned away by Chrome's cross-site iframe
// cookie isolation — the server-side isShellIframe prop is kept for UI chrome
// (sidebar, footer) but must NOT gate this signal.
//
// Target origin is locked to core.eq.solutions — any other parent frame
// silently drops the message, so this is safe to fire unconditionally
// whenever Service is running inside any iframe.
export function ShellReadySignal({ isShellIframe: _isShellIframe }: { isShellIframe: boolean }) {
  useEffect(() => {
    if (window.parent === window) return  // not embedded — skip
    window.parent.postMessage({ type: 'EQ_SERVICE_READY', v: 1 }, SHELL_ORIGIN)
  }, [])

  return null
}
