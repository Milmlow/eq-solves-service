import { getTenantSettings } from '@/lib/tenant/getTenantSettings'
import type { TenantSettings } from '@/lib/types'

const DEFAULTS: Pick<TenantSettings, 'product_name' | 'logo_url' | 'primary_colour' | 'ink_colour' | 'deep_colour' | 'ice_colour'> = {
  product_name: 'EQ Solves',
  logo_url: null,
  primary_colour: '#3DA8D8',
  ink_colour: '#1A1A2E',
  deep_colour: '#2986B4',
  ice_colour: '#EAF5FB',
}

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  let settings: typeof DEFAULTS = DEFAULTS
  try {
    const result = await getTenantSettings()
    settings = result.settings
  } catch {
    // Gracefully fall back to defaults — never show DB errors on the login page
  }

  const productName = settings.product_name || 'EQ Solves'

  return (
    <div className="min-h-screen flex">
      {/* Left panel — branding */}
      <div
        className="hidden lg:flex lg:w-[480px] xl:w-[540px] flex-col justify-between p-10"
        style={{ background: `linear-gradient(135deg, ${settings.ink_colour} 0%, ${settings.deep_colour} 100%)` }}
      >
        <div>
          {settings.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={settings.logo_url} alt={productName} className="h-8 w-auto" />
          ) : (
            <span className="text-xl font-bold text-white tracking-tight">
              EQ <span style={{ color: settings.primary_colour }}>Solves</span>
            </span>
          )}
        </div>

        <div className="space-y-6">
          <h2 className="text-3xl font-bold text-white leading-tight">
            Maintenance management,<br />
            <span style={{ color: settings.primary_colour }}>done right.</span>
          </h2>
          <p className="text-sm text-white/60 leading-relaxed max-w-sm">
            Circuit breaker testing, preventive maintenance scheduling,
            compliance reporting and defect tracking — all in one platform.
          </p>
          <div className="flex items-center gap-6 pt-2">
            <Stat label="Faster reporting" value="3×" colour={settings.primary_colour} />
            <Stat label="Compliance rate" value="98%" colour={settings.primary_colour} />
            <Stat label="Less paperwork" value="70%" colour={settings.primary_colour} />
          </div>
        </div>

        <p className="text-xs text-white/30">
          © {new Date().getFullYear()} EQ Solutions. All rights reserved.
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 bg-white">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex flex-col items-center mb-10">
            {settings.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={settings.logo_url} alt={productName} className="h-7 w-auto" />
            ) : (
              <span className="text-xl font-bold tracking-tight" style={{ color: settings.ink_colour }}>
                EQ <span style={{ color: settings.primary_colour }}>Solves</span>
              </span>
            )}
            <span className="text-[10px] uppercase tracking-[0.2em] mt-1.5" style={{ color: settings.deep_colour }}>
              Service Platform
            </span>
          </div>

          {children}

          <p className="text-[11px] text-center mt-8" style={{ color: `${settings.ink_colour}40` }}>
            Protected by enterprise-grade encryption
          </p>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, colour }: { label: string; value: string; colour: string }) {
  return (
    <div>
      <p className="text-2xl font-bold" style={{ color: colour }}>{value}</p>
      <p className="text-xs text-white/50">{label}</p>
    </div>
  )
}
