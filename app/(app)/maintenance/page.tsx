import { Breadcrumb } from '@/components/ui/Breadcrumb'
export default function MaintenancePage() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Maintenance' }]} />
      <h1 className="text-3xl font-bold text-eq-sky">Maintenance</h1>
      <p className="text-sm text-eq-grey">Placeholder — PM checks land in Phase 3.</p>
    </div>
  )
}
