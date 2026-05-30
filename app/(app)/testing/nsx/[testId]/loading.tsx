import { PageSkeleton } from '@/components/ui/PageSkeleton'

// L2 / Q-W2-5 — loading skeleton for the NSX test detail route. Mirrors
// the ACB detail loader; the page fetches the test + readings + parent
// check before the workflow renders.
export default function NsxTestLoading() {
  return <PageSkeleton tableRows={6} breadcrumbWidth="w-56" />
}
