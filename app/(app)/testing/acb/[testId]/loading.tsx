import { PageSkeleton } from '@/components/ui/PageSkeleton'

// L2 / Q-W2-5 — loading skeleton for the ACB test detail route. The page
// fetches the test + its readings + parent check before the 3-step
// workflow renders; this skeleton mirrors the header + content block so
// the screen isn't blank during SSR.
export default function AcbTestLoading() {
  return <PageSkeleton tableRows={6} breadcrumbWidth="w-56" />
}
