import { Breadcrumb } from '@/components/ui/Breadcrumb'
export default function SitesPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Sites' }]} />
      <h1 className="text-3xl font-bold text-eq-sky">Sites</h1>
      <p className="text-sm text-eq-grey">Placeholder — sites module lands in Phase 2.</p>
    </div>
  )
}
