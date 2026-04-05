import { Breadcrumb } from '@/components/ui/Breadcrumb'
export default function TestingPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Testing' }]} />
      <h1 className="text-3xl font-bold text-eq-sky">Testing</h1>
      <p className="text-sm text-eq-grey">Placeholder — ACB/NSX testing lands in Phase 4.</p>
    </div>
  )
}
