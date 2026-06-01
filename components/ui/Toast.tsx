'use client'

/**
 * Thin re-export — canonical implementation lives in @eq-solutions/ui.
 *
 * All call sites import from '@/components/ui/Toast' so nothing needs to
 * change at the call sites. The canonical Toast uses Direction D tokens
 * (CSS custom props from @eq-solutions/tokens).
 *
 * API change from local version:
 *   Local:    const toast = useToast(); toast.success(msg)
 *   Canonical: const { toast } = useToast(); toast({ tone: 'ok', title: msg })
 *
 * Tone mapping: success → 'ok'  |  error → 'err'  |  info → 'info'
 */
export { ToastProvider, useToast } from '@eq-solutions/ui'
export type { ToastOptions, ToastTone } from '@eq-solutions/ui'
