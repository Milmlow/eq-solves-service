import { Sidebar } from './Sidebar'
import type { JobContext, NavId } from './Sidebar'
import { TopBar } from './TopBar'
import { cn } from '../../lib/cn'

type Props = {
  active: NavId
  onNavigate: (id: NavId) => void
  title: string
  subtitle?: string
  breadcrumb?: React.ReactNode
  jobCtx?: JobContext | null
  online: boolean
  pending: number
  syncing: boolean
  onSync: () => void
  captureBy: string | null
  onChangeName: () => void
  onOpenSearch?: () => void
  children: React.ReactNode
  /** Set false to drop the 24px main padding (e.g. full-bleed JobScreen) */
  padded?: boolean
  /** Override main background (default gray-50) */
  bgClassName?: string
}

export function AppShell({
  active,
  onNavigate,
  title,
  subtitle,
  breadcrumb,
  jobCtx,
  online,
  pending,
  syncing,
  onSync,
  captureBy,
  onChangeName,
  onOpenSearch,
  children,
  padded = true,
  bgClassName = 'bg-gray-50',
}: Props) {
  return (
    <div className={cn('flex h-screen text-ink font-sans', bgClassName)}>
      <Sidebar active={active} onNavigate={onNavigate} jobCtx={jobCtx} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          title={title}
          subtitle={subtitle}
          breadcrumb={breadcrumb}
          online={online}
          pending={pending}
          syncing={syncing}
          onSync={onSync}
          captureBy={captureBy}
          onChangeName={onChangeName}
          onOpenSearch={onOpenSearch}
        />
        <main
          className={cn('flex-1 overflow-y-auto min-w-0', padded && 'p-6')}
        >
          {children}
        </main>
      </div>
    </div>
  )
}

export type { NavId, JobContext }
