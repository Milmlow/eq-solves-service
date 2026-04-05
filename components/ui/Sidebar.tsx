'use client'
import { cn } from '@/lib/utils/cn'
import {
  LayoutDashboard, MapPin, Package, ClipboardCheck,
  Zap, FileText, Settings, ChevronLeft
} from 'lucide-react'
import { useState } from 'react'

const navItems = [
  { label: 'Dashboard',   href: '/dashboard',   icon: LayoutDashboard },
  { label: 'Sites',       href: '/sites',        icon: MapPin },
  { label: 'Assets',      href: '/assets',       icon: Package },
  { label: 'Maintenance', href: '/maintenance',  icon: ClipboardCheck },
  { label: 'Testing',     href: '/testing',      icon: Zap },
  { label: 'Reports',     href: '/reports',      icon: FileText },
  { label: 'Settings',    href: '/settings',     icon: Settings },
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside className={cn(
      'flex flex-col h-screen bg-eq-ink text-white transition-all duration-200 sticky top-0',
      collapsed ? 'w-16' : 'w-56'
    )}>
      <div className="flex items-center justify-between px-4 h-14 border-b border-white/10">
        {!collapsed && (
          <span className="font-bold text-sm tracking-wide text-eq-sky">EQ Solves Service</span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded hover:bg-white/10 transition-colors ml-auto"
        >
          <ChevronLeft className={cn('w-4 h-4 transition-transform', collapsed && 'rotate-180')} />
        </button>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {navItems.map(({ label, href, icon: Icon }) => (
          <a
            key={href}
            href={href}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors text-sm font-medium"
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>{label}</span>}
          </a>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-white/10 text-xs text-white/30">
        {!collapsed && 'EQ Solves Service v1.0'}
      </div>
    </aside>
  )
}
