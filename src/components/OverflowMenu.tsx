import { useEffect, useRef, useState } from 'react'
import { navigate } from '../lib/router'
import { signOut } from '../lib/constants'

interface Props {
  /** Show "Change name" — only useful in the capture flow */
  showChangeName?: boolean
  /** Label for the home action. Default "Home". */
  homeLabel?: string
  /** Called when user clicks "Change name" — page handles the prompt */
  onChangeName?: () => void
  /** Extra custom items at the top */
  extra?: Array<{ label: string; onClick: () => void; danger?: boolean }>
}

export function OverflowMenu({ showChangeName, homeLabel = 'Home', onChangeName, extra }: Props) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // Defer to next tick so the opening click doesn't instantly close
    setTimeout(() => document.addEventListener('click', onClick), 0)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const go = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-2 -mr-2 rounded-lg hover:bg-sky-soft active:bg-border"
        aria-label="More options"
        aria-expanded={open}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>

      {open ? (
        <div className="absolute right-0 top-full mt-1 min-w-[200px] bg-white border border-border rounded-xl shadow-lg py-1.5 z-30">
          {extra?.map((item) => (
            <MenuItem
              key={item.label}
              onClick={() => go(item.onClick)}
              danger={item.danger}
            >
              {item.label}
            </MenuItem>
          ))}
          {extra && extra.length > 0 ? <MenuDivider /> : null}
          <MenuItem onClick={() => go(() => navigate('/'))}>{homeLabel}</MenuItem>
          <MenuItem onClick={() => go(() => navigate('/'))}>Switch job</MenuItem>
          {showChangeName && onChangeName ? (
            <MenuItem onClick={() => go(onChangeName)}>Change name</MenuItem>
          ) : null}
          <MenuDivider />
          <MenuItem onClick={() => go(() => navigate('/debug'))}>Self-check</MenuItem>
          <MenuItem
            onClick={() =>
              go(() => {
                if (!confirm('Clear your captured name and return to the start? You can re-enter it on the next job.')) return
                signOut()
                navigate('/')
              })
            }
            danger
          >
            Sign out
          </MenuItem>
        </div>
      ) : null}
    </div>
  )
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-2 text-sm hover:bg-sky-soft ${
        danger ? 'text-bad' : 'text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function MenuDivider() {
  return <div className="my-1 h-px bg-border" />
}
