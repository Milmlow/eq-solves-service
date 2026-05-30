import { PageSkeleton } from '@/components/ui/PageSkeleton'

// E1 — loading.tsx for /job-plans (quality-polish-backlog E1).
export default function JobPlansLoading() {
  return <PageSkeleton tableRows={10} />
}
