'use client'
import { cn } from '@/lib/utils/cn'
import {
  LayoutDashboard, Building2, MapPin, Package, FileCheck, ClipboardCheck,
  FileText, Search, ScrollText, BarChart3, Settings, ChevronLeft, Users, LogOut, Scale, Menu, X, CalendarDays, Image, Archive, AlertTriangle, Contact2, FileSpreadsheet, Wand2, FileSignature
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { NotificationBell } from '@/components/ui/NotificationBell'
import type { TenantSettings } from '@/lib/types'

/**
 * Sidebar navigation grouped into sections for visual structure.
 *
 * 2026-04-28 polish (PR J): the previous flat 14-item list felt unbalanced
 * after the Testing fold. Grouped by intent — Data (the records), Operations
 * (daily-driver work), Insight (strategic / reporting), with Dashboard at
 * top and Search/Settings at the bottom in their own unlabeled groups.
 *
 * Section labels match the existing Admin block's styling (uppercase 10px
 * tracking-wider white/30) so the Admin block reads as just one more
 * section, not a special case.
 */
type NavItem = { label: string; href: string; icon: typeof LayoutDashboard }
type NavSection = { label?: string; items: NavItem[] }

/**
 * Build the sidebar sections. The Insight section conditionally includes
 * Variations when the tenant has commercial_features_enabled — Phase 4
 * of the contract-scope bridge plan. Free-tier tenants don't see it.
 */
function buildNavSections(commercialEnabled: boolean): NavSection[] {
  const insightItems: NavItem[] = [
    { label: 'Contract Scope', href: '/contract-scope', icon: Scale },
  ]
  if (commercialEnabled) {
    insightItems.push({ label: 'Variations', href: '/variations', icon: FileSignature })
  }
  insightItems.push(
    { label: 'Reports',   href: '/reports',   icon: FileText },
    { label: 'Analytics', href: '/analytics', icon: BarChart3 },
  )

  return [
    {
      items: [
        { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      ],
    },
    {
      label: 'Data',
      items: [
        { label: 'Customers', href: '/customers', icon: Building2 },
        { label: 'Sites',     href: '/sites',     icon: MapPin },
        { label: 'Contacts',  href: '/contacts',  icon: Contact2 },
        { label: 'Assets',    href: '/assets',    icon: Package },
        { label: 'Job Plans', href: '/job-plans', icon: FileCheck },
      ],
    },
    {
      label: 'Operations',
      items: [
        // Testing folded into Maintenance 2026-04-28 (Royce review Q4) —
        // ACB/NSX/RCD live in maintenance_checks via the `kind`
        // discriminator (migration 0080). /testing/* routes still resolve
        // for direct URLs and LinkedTestsPanel deep links, but no longer
        // have a top-level sidebar entry.
        { label: 'Maintenance', href: '/maintenance', icon: ClipboardCheck },
        { label: 'Calendar',    href: '/calendar',    icon: CalendarDays },
        { label: 'Defects',     href: '/defects',     icon: AlertTriangle },
      ],
    },
    {
      label: 'Insight',
      items: insightItems,
    },
    {
      items: [
        { label: 'Search',   href: '/search',   icon: Search },
        { label: 'Settings', href: '/settings', icon: Settings },
      ],
    },
  ]
}

interface SidebarProps {
  isAdmin?: boolean
  settings?: TenantSettings
}

export function Sidebar({ isAdmin = false, settings }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  const productName = settings?.product_name || 'EQ Solves'
  const commercialEnabled = Boolean(settings?.commercial_features_enabled)
  const navSections = buildNavSections(commercialEnabled)
  // Sidebar background is eq-ink (dark) — prefer the dark-surface logo
  // when configured, fall back to the light-surface one. Without this,
  // tenants with a dark logo (e.g. SKS coloured logo on the eq-ink bg)
  // render invisible.
  const logoUrl = settings?.logo_url_on_dark || settings?.logo_url
  const whiteLogo = 'https://pub-409bd651f2e549f4907f5a856a9264ae.r2.dev/EQ_logo_white_transparent.svg'

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  // Prevent body scroll when mobile drawer open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  const sidebarContent = (
    <>
      <div className="flex items-center justify-between px-4 h-16 border-b border-white/10">
        {!collapsed && (
          logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={productName} className="max-h-10 max-w-[140px] w-auto object-contain" />
          ) : (
            <span className="font-bold text-sm tracking-wide text-eq-sky">{productName}</span>
          )
        )}
        <div className="flex items-center gap-2 ml-auto">
          <NotificationBell />
          {/* Desktop collapse toggle */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:block p-1 rounded hover:bg-white/10 transition-colors"
          >
            <ChevronLeft className={cn('w-4 h-4 transition-transform', collapsed && 'rotate-180')} />
          </button>
          {/* Mobile close */}
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1 rounded hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {navSections.map((section, sIdx) => (
          <div key={sIdx} className={sIdx > 0 ? 'mt-3' : undefined}>
            {section.label && (
              <div className={cn('mb-1 px-3 text-[10px] uppercase tracking-wider text-white/30', collapsed && 'sr-only')}>
                {section.label}
              </div>
            )}
            {section.items.map(({ label, href, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(href + '/')
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium relative',
                    active
                      ? 'bg-white/10 text-white before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-eq-sky before:rounded-full'
                      : 'text-white/60 hover:text-white hover:bg-white/10'
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {!collapsed && <span>{label}</span>}
                </Link>
              )
            })}
          </div>
        ))}
        {isAdmin && (
          <>
            <div className={cn('mt-4 mb-1 px-3 text-[10px] uppercase tracking-wider text-white/30', collapsed && 'sr-only')}>
              Admin
            </div>
            <Link
              href="/admin/users"
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium relative',
                pathname.startsWith('/admin/users')
                  ? 'bg-white/10 text-white before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-eq-sky before:rounded-full'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              )}
            >
              <Users className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Users</span>}
            </Link>
            <Link
              href="/audit-log"
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium relative',
                pathname.startsWith('/audit-log')
                  ? 'bg-white/10 text-white before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-eq-sky before:rounded-full'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              )}
            >
              <ScrollText className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Audit Log</span>}
            </Link>
            <Link
              href="/admin/settings"
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium relative',
                pathname === '/admin/settings'
                  ? 'bg-white/10 text-white before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-eq-sky before:rounded-full'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              )}
            >
              <Settings className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Tenant Settings</span>}
            </Link>
            <Link
              href="/admin/media"
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium relative',
                pathname.startsWith('/admin/media')
                  ? 'bg-white/10 text-white before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-eq-sky before:rounded-full'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              )}
            >
              <Image className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Media Library</span>}
            </Link>
            <Link
              href="/admin/reports"
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium relative',
                pathname.startsWith('/admin/reports')
                  ? 'bg-white/10 text-white before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-eq-sky before:rounded-full'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              )}
            >
              <FileText className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Report Settings</span>}
            </Link>
            <Link
              href="/admin/archive"
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium relative',
                pathname.startsWith('/admin/archive')
                  ? 'bg-white/10 text-white before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-eq-sky before:rounded-full'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              )}
            >
              <Archive className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Archive</span>}
            </Link>
            <Link
              href="/admin/renewal-pack"
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium relative',
                pathname.startsWith('/admin/renewal-pack')
                  ? 'bg-white/10 text-white before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-eq-sky before:rounded-full'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              )}
            >
              <FileText className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Renewal Pack</span>}
            </Link>
            <Link
              href="/admin/contract-scopes/import"
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium relative',
                pathname.startsWith('/admin/contract-scopes/import')
                  ? 'bg-white/10 text-white before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-eq-sky before:rounded-full'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              )}
            >
              <FileSpreadsheet className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Import Commercial Sheet</span>}
            </Link>
            <Link
              href="/admin/contract-scopes/derive"
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium relative',
                pathname.startsWith('/admin/contract-scopes/derive')
                  ? 'bg-white/10 text-white before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-eq-sky before:rounded-full'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              )}
            >
              <Wand2 className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Build Scope from Work</span>}
            </Link>
          </>
        )}
      </nav>
      {/* Subtle brand watermark — visible when sidebar is expanded */}
      {!collapsed && (
        <div className="flex justify-center py-4 opacity-[0.10]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={whiteLogo} alt="" aria-hidden="true" className="w-40 h-40 object-contain pointer-events-none" />
        </div>
      )}
      <div className="border-t border-white/10 p-2">
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors text-sm font-medium"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </form>
      </div>
    </>
  )

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-eq-ink flex items-center justify-between px-4">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 -ml-2 rounded-md text-white hover:bg-white/10 transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={productName} className="h-7 w-auto object-contain" />
        ) : (
          <span className="font-bold text-sm text-eq-sky">{productName}</span>
        )}
        <NotificationBell />
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside className={cn(
        'lg:hidden fixed top-0 left-0 z-50 h-screen w-64 bg-eq-ink text-white transition-transform duration-300 flex flex-col',
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside className={cn(
        'hidden lg:flex flex-col h-screen bg-eq-ink text-white transition-all duration-200 sticky top-0',
        collapsed ? 'w-16' : 'w-56'
      )}>
        {sidebarContent}
      </aside>
    </>
  )
}
