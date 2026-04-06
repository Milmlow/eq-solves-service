import { TenantLogo } from '@/components/ui/TenantLogo'
import { getTenantSettings } from '@/lib/tenant/getTenantSettings'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { settings } = await getTenantSettings()

  return (
    <div className="min-h-screen bg-eq-ice flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <TenantLogo settings={settings} size="lg" />
          <div className="text-xs text-eq-grey uppercase tracking-wide mt-1">
            Service Platform
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-8">
          {children}
        </div>
      </div>
    </div>
  )
}
