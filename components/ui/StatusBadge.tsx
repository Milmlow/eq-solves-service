/**
 * Thin re-export — canonical implementation lives in @eq-solutions/ui.
 *
 * All call sites import from '@/components/ui/StatusBadge' so nothing needs to
 * change at the call sites. The canonical StatusBadge uses Direction D tokens
 * (CSS custom props from @eq-solutions/tokens) and the kit StatusKind union.
 *
 * Kit StatusKind: 'open' | 'in-progress' | 'overdue' | 'closed' | 'await'
 *
 * D5 status-vocab mapping (applied at call sites, not here):
 *   not_started / not-started → open  (label "Not started")
 *   active                    → in-progress
 *   in_progress / in-progress → in-progress
 *   complete / completed      → closed (label "Complete" / "Done")
 *   blocked                   → await  (label "Blocked")
 *   inactive                  → await  (label "Inactive")
 *   cancelled                 → await  (label "Cancelled")
 */
export { StatusBadge } from '@eq-solutions/ui'
export type { StatusBadgeProps, StatusKind } from '@eq-solutions/ui'
