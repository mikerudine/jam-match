import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function CollapseSection({
  title,
  summary,
  open,
  onToggle,
  children,
  className,
}: {
  title: string
  summary?: string
  open: boolean
  onToggle: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-2xl border border-line bg-panel/70', className)}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
      >
        <span>
          <span className="block text-sm font-semibold text-cream">{title}</span>
          {summary ? (
            <span className="mt-0.5 block text-xs text-mute">{summary}</span>
          ) : null}
        </span>
        <span className="shrink-0 text-xs font-semibold text-teal">
          {open ? '⌃' : '⌄'}
        </span>
      </button>
      {open ? <div className="border-t border-line/60 px-3 pb-3 pt-2">{children}</div> : null}
    </div>
  )
}
