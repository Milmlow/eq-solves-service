import { PageSkeleton } from '@/components/ui/PageSkeleton'

// E1 — loading.tsx for /customers (quality-polish-backlog E1).
export default function CustomersLoading() {
  return <PageSkeleton tableRows={10} />
}
