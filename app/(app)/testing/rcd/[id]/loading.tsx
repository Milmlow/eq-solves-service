import { PageSkeleton } from '@/components/ui/PageSkeleton'

// L2 / Q-W2-5 — loading skeleton for the RCD test editor route. The page
// fetches the RCD header + per-circuit timing rows before the editor
// renders; a per-circuit table can be long, so a few extra skeleton rows.
export default function RcdTestLoading() {
  return <PageSkeleton tableRows={8} breadcrumbWidth="w-56" />
}
