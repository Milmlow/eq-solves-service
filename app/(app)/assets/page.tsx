import { Breadcrumb } from '@/components/ui/Breadcrumb'
export default function AssetsPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Assets' }]} />
      <h1 className="text-3xl font-bold text-eq-sky">Assets</h1>
      <p className="text-sm text-eq-grey">Placeholder — asset register lands in Phase 2.</p>
    </div>
  )
}
