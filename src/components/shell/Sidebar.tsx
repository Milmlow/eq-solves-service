import { useState } from 'react'
import {
  LayoutDashboard,
  Briefcase,
  Package,
  Grid3x3,
  Download,
  Upload,
  Stethoscope,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { EqMark } from '../EqMark'
import { cn } from '../../lib/cn'

export type NavId =
  | 'home'
  | 'jobs'
  | 'assets'
  | 'admin'
  | 'export'
  | 'import'
  | 'debug'

type NavItem = {
  id: NavId
  label: string
  icon: LucideIcon
  disabled?: boolean
}

type NavGroup = {
  group: string
  items: NavItem[]
}

export type JobContext = {
  name: string
  site_code: string
  classification_code: string
  done: number
  total: number
}

type Props = {
  active: NavId
  onNavigate: (id: NavId) => void
  jobCtx?: JobContext | null
}

export function Sidebar({ active, onNavigate, jobCtx }: Props) {
  const [collapsed, setCollapsed] = useState(false)

  const groups: NavGroup[] = [
    {
      group: 'Capture',
      items: [
        { id: 'home', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'jobs', label: 'Jobs',      icon: Briefcase       },
      ],
    },
    {
      group: 'Job',
      items: [
        { id: 'assets', label: 'Assets',   icon: Package,  disabled: !jobCtx },
        { id: 'admin',  label: 'Progress', icon: Grid3x3,  disabled: !jobCtx },
        { id: 'export', label: 'Export',   icon: Download, disabled: !jobCtx },
      ],
    },
    {
      group: 'Office',
      items: [
        { id: 'import', label: 'Import template', icon: Upload      },
        { id: 'debug',  label: 'Self-check',      icon: Stethoscope },
      ],
    },
  ]

  const pct = jobCtx && jobCtx.total > 0 ? Math.round((jobCtx.done / jobCtx.total) * 100) : 0

  return (
    <aside
      className="relative overflow-hidden flex flex-col shrink-0 bg-ink text-white border-r border-white/[0.06] transition-[width] duration-150"
      style={{ width: collapsed ? 64 : 232 }}
    >
      {/* Logo lockup — tight-cropped mark sized to match the visual weight of
          the SKS mark in eq-solves-service. When expanded, the EQ glyph leads
          and the wordmark sits stacked beside it so the big cropped mark
          doesn't squeeze the text. When collapsed, only the mark is shown
          and it sits flush. */}
      <div
        className={cn(
          'flex items-center gap-3 border-b border-white/[0.08] shrink-0',
          collapsed ? 'h-16 px-3 justify-center' : 'h-[72px] px-4',
        )}
      >
        <EqMark
          variant="white"
          size={collapsed ? 30 : 40}
          fit="tight"
          aria-hidden
        />
        {!collapsed && (
          <div className="leading-[1.05] tracking-tight">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
              Solves
            </div>
            <div className="text-[18px] font-bold text-sky">
              Assets
            </div>
          </div>
        )}
      </div>

      {/* Active job card */}
      {jobCtx && !collapsed && (
        <div className="p-3">
          <div className="rounded-lg p-2.5 bg-sky/[0.08] border border-sky/[0.2]">
            <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/55 mb-1">
              Active job
            </div>
            <div className="text-[13px] font-bold leading-tight text-white truncate">
              {jobCtx.name}
            </div>
            <div className="text-[11px] font-mono text-white/65 mt-0.5 truncate">
              {jobCtx.site_code} · {jobCtx.classification_code}
            </div>
            <div className="flex items-center gap-1.5 mt-2">
              <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-sky rounded-full transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="text-[10px] font-bold font-mono text-sky tabular-nums">
                {pct}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Nav groups */}
      <nav className="flex-1 px-2 pt-2 pb-3 overflow-y-auto no-scrollbar">
        {groups.map(g => (
          <div key={g.group} className="mb-2">
            {!collapsed && (
              <div className="px-2.5 pt-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                {g.group}
              </div>
            )}
            {g.items.map(item => (
              <SidebarItem
                key={item.id}
                item={item}
                isActive={item.id === active}
                collapsed={collapsed}
                onClick={() => !item.disabled && onNavigate(item.id)}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* Decorative brand watermark — same pattern as eq-solves-service's
          faded SKS mark bottom-left. Huge, low-opacity, anchored to the
          bottom-left and partly tucked under the collapse bar. Hidden when
          collapsed (no room) and aria-hidden since it's purely decorative. */}
      {!collapsed && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-32 select-none opacity-[0.06]"
        >
          <EqMark variant="white" size={90} fit="tight" aria-hidden />
        </div>
      )}

      {/* Collapse toggle */}
      <div className="relative z-10 p-2 border-t border-white/[0.08] bg-ink/80 backdrop-blur-sm">
        <button
          onClick={() => setCollapsed(c => !c)}
          className={cn(
            'flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md',
            'text-white/70 text-[12px] hover:bg-white/[0.07] hover:text-white',
            'transition-colors duration-120 cursor-pointer',
            collapsed ? 'justify-center' : 'justify-start',
          )}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight size={16} strokeWidth={2} />
          ) : (
            <>
              <ChevronLeft size={16} strokeWidth={2} />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  )
}

function SidebarItem({
  item,
  isActive,
  collapsed,
  onClick,
}: {
  item: NavItem
  isActive: boolean
  collapsed: boolean
  onClick: () => void
}) {
  const Icon = item.icon
  return (
    <button
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      disabled={item.disabled}
      className={cn(
        'relative flex items-center gap-2.5 my-0.5 w-full rounded-md',
        'text-[13px] font-medium transition-colors duration-120',
        collapsed ? 'p-[9px] justify-center' : 'px-2.5 py-2 justify-start',
        item.disabled
          ? 'text-white/30 cursor-not-allowed'
          : isActive
          ? 'text-white bg-white/[0.13] cursor-pointer'
          : 'text-white/70 hover:bg-white/[0.07] hover:text-white cursor-pointer',
      )}
    >
      {isActive && !collapsed && (
        <span className="absolute -left-2 top-1.5 bottom-1.5 w-0.5 bg-sky rounded-full" />
      )}
      <Icon size={15} strokeWidth={2} />
      {!collapsed && <span>{item.label}</span>}
    </button>
  )
}
