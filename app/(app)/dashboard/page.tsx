import { Card } from '@/components/ui/Card'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { StatusBadge } from '@/components/ui/StatusBadge'

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Dashboard' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Dashboard</h1>
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Sites', value: '22' },
          { label: 'Assets', value: '5,631' },
          { label: 'Active Checks', value: '0' },
          { label: 'Overdue', value: '0' },
        ].map(({ label, value }) => (
          <Card key={label}>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">{label}</p>
            <p className="text-3xl font-bold text-eq-ink">{value}</p>
          </Card>
        ))}
      </div>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-eq-ink">Recent Maintenance Checks</h2>
          <StatusBadge status="not-started" />
        </div>
        <p className="text-sm text-eq-grey">No maintenance checks yet. Data will appear here once migration is complete.</p>
      </Card>
    </div>
  )
}
