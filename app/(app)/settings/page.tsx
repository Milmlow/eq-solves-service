import { Breadcrumb } from '@/components/ui/Breadcrumb'
export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Settings' }]} />
      <h1 className="text-3xl font-bold text-eq-sky">Settings</h1>
      <p className="text-sm text-eq-grey">Placeholder — user management lands in Phase 5.</p>
    </div>
  )
}
