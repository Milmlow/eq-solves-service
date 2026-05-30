import { PageSkeleton } from '@/components/ui/PageSkeleton'

// L2 / Q-W2-5 — loading skeleton for the site detail page. The page
// aggregates site fields + contacts + linked assets/checks tables in
// parallel; this replaces the blank SSR flash with a header + table
// skeleton that mirrors the page shape.
export default function SiteDetailLoading() {
  return <PageSkeleton tableRows={8} breadcrumbWidth="w-56" />
}
