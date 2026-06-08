'use client'
import {
  LayoutDashboard, ClipboardCheck, Search, Settings, ChevronLeft, LogOut,
  Menu, X, CalendarDays, AlertTriangle, Shield, Database, Lightbulb, Zap,
  ExternalLink,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { NotificationBell } from '@/components/ui/NotificationBell'
import type { Role, TenantSettings } from '@/lib/types'

type NavItem = {
  label: string
  href: string
  icon: React.ElementType
  extraActivePaths?: string[]
}
type NavSection = { label?: string; items: NavItem[] }

interface ModuleFlags {
  calendarEnabled: boolean
  defectsEnabled: boolean
}

const RECORDS_PATHS = ['/customers', '/sites', '/contacts', '/assets', '/job-plans']
const INSIGHT_PATHS = ['/reports', '/analytics', '/contract-scope', '/variations', '/commercials']

function buildNavSections(flags: ModuleFlags, role: Role | null): NavSection[] {
  const isTechnician = role === 'employee'

  const operationsItems: NavItem[] = [
    { label: 'Maintenance', href: '/maintenance', icon: ClipboardCheck },
  ]
  if (flags.calendarEnabled) operationsItems.push({ label: 'Calendar', href: '/calendar', icon: CalendarDays })
  if (flags.defectsEnabled)  operationsItems.push({ label: 'Defects',  href: '/defects',  icon: AlertTriangle })

  const topItems: NavItem[] = []
  if (role !== 'apprentice') topItems.push({ label: 'Do', href: '/do', icon: Zap })
  topItems.push({ label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard })
  if (!isTechnician) topItems.push({ label: 'Records', href: '/records', icon: Database, extraActivePaths: RECORDS_PATHS })

  const bottomItems: NavItem[] = []
  if (!isTechnician) bottomItems.push({ label: 'Insight', href: '/insights', icon: Lightbulb, extraActivePaths: INSIGHT_PATHS })
  bottomItems.push({ label: 'Search',   href: '/search',   icon: Search })
  bottomItems.push({ label: 'Settings', href: '/settings', icon: Settings })

  return [
    { items: topItems },
    { label: 'Operations', items: operationsItems },
    { items: bottomItems },
  ]
}

interface SidebarProps {
  isAdmin?: boolean
  role?: Role | null
  settings?: TenantSettings
  isShellIframe?: boolean
}

export function Sidebar({ isAdmin = false, role = null, settings, isShellIframe = false }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  const productName = settings?.product_name || 'EQ Service'
  const navSections = buildNavSections(
    {
      calendarEnabled: settings?.calendar_enabled ?? true,
      defectsEnabled:  settings?.defects_enabled  ?? true,
    },
    role,
  )
  const logoUrl = settings?.logo_url_on_dark || settings?.logo_url

  useEffect(() => { setMobileOpen(false) }, [pathname])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  function isActive(item: NavItem): boolean {
    const paths = [item.href, ...(item.extraActivePaths ?? [])]
    return paths.some((p) => pathname === p || pathname.startsWith(p + '/'))
  }

  const sidebarContent = (
    <>
      {/* Brand row */}
      <div className="eq-hub-sidebar__brand-row">
        <div className="eq-hub-sidebar__brand" style={{ cursor: 'default' }}>
          {!collapsed && (
            logoUrl
              ? <img src={logoUrl} alt={productName} style={{ maxHeight: 40, maxWidth: 140, objectFit: 'contain' }} />
              : <span className="eq-hub-sidebar__brand-label">{productName}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingRight: 8, paddingBottom: 20 }}>
          {!collapsed && <NotificationBell />}
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="eq-hub-sidebar__collapse"
          >
            <ChevronLeft
              size={16}
              aria-hidden="true"
              style={{ transform: collapsed ? 'rotate(180deg)' : undefined }}
            />
          </button>
        </div>
      </div>

      {/* Nav */}
      <nav className="eq-hub-sidebar__nav" aria-label="Service navigation">
        {navSections.map((section, idx) => (
          <div key={idx} style={{ marginTop: idx > 0 ? 8 : 0 }}>
            {section.label && !collapsed && (
              <p className="eq-hub-sidebar__section-label">{section.label}</p>
            )}
            {section.items.map((item) => {
              const active = isActive(item)
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-active={active ? 'true' : undefined}
                  className="eq-hub-sidebar__nav-item"
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="eq-hub-sidebar__nav-icon" aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  {!collapsed && <span className="eq-hub-sidebar__nav-label">{item.label}</span>}
                </Link>
              )
            })}
          </div>
        ))}

        {isAdmin && (
          <div style={{ marginTop: 8 }}>
            {!collapsed && <p className="eq-hub-sidebar__section-label">Admin</p>}
            <Link
              href="/admin"
              data-active={pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/audit-log') ? 'true' : undefined}
              className="eq-hub-sidebar__nav-item"
            >
              <span className="eq-hub-sidebar__nav-icon" aria-hidden="true"><Shield size={16} /></span>
              {!collapsed && <span className="eq-hub-sidebar__nav-label">Admin</span>}
            </Link>
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="eq-hub-sidebar__user" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
        {isShellIframe ? (
          <>
            {!collapsed && (
              <div style={{ padding: '0 20px 4px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.30)' }}>
                Via EQ Shell
              </div>
            )}
            <a
              href="https://service.eq.solutions"
              target="_blank"
              rel="noopener noreferrer"
              className="eq-hub-sidebar__nav-item"
            >
              <span className="eq-hub-sidebar__nav-icon" aria-hidden="true"><ExternalLink size={16} /></span>
              {!collapsed && <span className="eq-hub-sidebar__nav-label">Open in new tab</span>}
            </a>
          </>
        ) : (
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="eq-hub-sidebar__nav-item"
              style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
            >
              <span className="eq-hub-sidebar__nav-icon" aria-hidden="true"><LogOut size={16} /></span>
              {!collapsed && <span className="eq-hub-sidebar__nav-label">Sign out</span>}
            </button>
          </form>
        )}
      </div>
    </>
  )

  return (
    <>
      {/* Mobile top bar */}
      <div
        className="lg:hidden"
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40,
          height: 56, background: 'var(--eq-ink)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px',
        }}
      >
        <button
          onClick={() => setMobileOpen(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'white', padding: 8, borderRadius: 6 }}
          aria-label="Open navigation"
        >
          <Menu size={20} />
        </button>
        {logoUrl
          ? <img src={logoUrl} alt={productName} style={{ height: 28, objectFit: 'contain' }} />
          : <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--eq-sky)' }}>{productName}</span>
        }
        <NotificationBell />
      </div>

      {/* Mobile drawer backdrop */}
      {mobileOpen && (
        <div
          className="lg:hidden"
          onClick={() => setMobileOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.50)' }}
          aria-hidden="true"
        />
      )}

      {/* Mobile drawer */}
      <aside
        className="lg:hidden eq-hub__sidebar"
        aria-hidden={!mobileOpen}
        style={{
          position: 'fixed', top: 0, left: 0, zIndex: 60,
          height: '100vh', width: 260, minWidth: 260,
          transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 300ms ease',
        }}
      >
        <button onClick={() => setMobileOpen(false)} className="eq-hub-drawer__close" aria-label="Close navigation">
          <X size={20} aria-hidden="true" />
        </button>
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex eq-hub__sidebar${collapsed ? ' eq-hub__sidebar--collapsed' : ''}`}
        style={{ position: 'sticky', top: 0, flexShrink: 0 }}
      >
        {sidebarContent}
      </aside>
    </>
  )
}
