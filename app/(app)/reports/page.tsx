import { Breadcrumb } from '@/components/ui/Breadcrumb'
export default function ReportsPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Reports' }]} />
      <h1 className="text-3xl font-bold text-eq-sky">Reports</h1>
      <p className="text-sm text-eq-grey">Placeholder — report engine lands in Phase 3.</p>
    </div>
  )
}
