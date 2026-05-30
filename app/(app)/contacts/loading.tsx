import { PageSkeleton } from '@/components/ui/PageSkeleton'

// E1 — loading.tsx for /contacts (quality-polish-backlog E1).
export default function ContactsLoading() {
  return <PageSkeleton tableRows={8} />
}
