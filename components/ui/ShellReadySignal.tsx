'use client'

import { useEffect } from 'react'

const SHELL_ORIGIN = 'https://core.eq.solutions'

// Signals to the EQ Shell parent frame that Service has fully loaded and the
// session is established. Shell listens for this to reveal the iframe
// immediately instead of waiting for the /shell → / redirect cycle to fire
// two onLoad events.
//
// Only fires when running inside the shell iframe (isShellIframe prop true).
// Target origin is locked to core.eq.solutions — never '*'.
export function ShellReadySignal({ isShellIframe }: { isShellIframe: boolean }) {
  useEffect(() => {
    if (!isShellIframe) return
    if (window.parent === window) return
    window.parent.postMessage({ type: 'EQ_SERVICE_READY', v: 1 }, SHELL_ORIGIN)
  }, [isShellIframe])

  return null
}
