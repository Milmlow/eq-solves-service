import { PageSkeleton } from '@/components/ui/PageSkeleton'

// E1 — loading.tsx for /dashboard (quality-polish-backlog E1).
// Eliminates the blank white flash during the SSR fetch on this
// high-traffic page. kpiCards=4 matches the KPI strip on the dashboard.
export default function DashboardLoading() {
  return <PageSkeleton kpiCards={4} tableRows={6} breadcrumbWidth="w-32" />
}
