import { cn } from '@/lib/utils'

interface ChipSelectProps {
  options: Array<{ value: string; label: string }>
  value: string[]
  onChange: (next: string[]) => void
  multiple?: boolean
}

export function ChipSelect({
  options,
  value,
  onChange,
  multiple = true,
}: ChipSelectProps) {
  function toggle(v: string) {
    if (!multiple) {
      onChange(value.includes(v) ? [] : [v])
      return
    }
    if (value.includes(v)) onChange(value.filter((x) => x !== v))
    else onChange([...value, v])
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const on = value.includes(opt.value)
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition',
              on
                ? 'border-amber/40 bg-amber/20 text-amber'
                : 'border-line bg-panel text-mute hover:text-cream',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
