// Small shared pieces for the Reports screens.
import { rs, pct, marginTone } from './format'

export function Panel({ title, subtitle, action, children, className = '', bodyClassName = 'p-4 sm:p-5', id }) {
  return (
    <section
      aria-labelledby={title && id ? `${id}-title` : undefined}
      className={`bg-white dark:bg-[#1c1c1e] rounded-[20px] border border-black/[0.06] dark:border-white/[0.08] shadow-[0_1px_3px_rgba(0,0,0,0.04)] ${className}`}
    >
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-2 px-4 sm:px-5 pt-4 sm:pt-5">
          <div className="min-w-0">
            {title && <h2 id={id ? `${id}-title` : undefined} className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{title}</h2>}
            {subtitle && <p className="text-xs text-[#6e6e73] dark:text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

export function Margin({ profit, revenue, kind, className = '' }) {
  const t = marginTone(profit, revenue, kind)
  return <span className={`tabular-nums ${t.cls} ${className}`} title={t.label || undefined}>{pct(profit, revenue)}</span>
}

export function ProfitText({ value, className = '' }) {
  return (
    <span className={`tabular-nums font-semibold ${value < 0 ? 'text-[#d70015] dark:text-[#ff6b6b]' : 'text-[#248a3d] dark:text-[#34d399]'} ${className}`}>
      {rs(value)}
    </span>
  )
}

// Change against the previous period. For costs (expenses) a rise is bad.
export function Change({ now, before, prevName, risingIsGood = true }) {
  if (before == null) return null
  if (!before) {
    return <span className="text-xs text-[#6e6e73] dark:text-gray-400">{now ? `None ${prevName}` : `Same as ${prevName}`}</span>
  }
  const change = ((now - before) / Math.abs(before)) * 100
  if (Math.abs(change) < 0.5) return <span className="text-xs text-[#6e6e73] dark:text-gray-400">Same as {prevName}</span>
  const up = change > 0
  const good = up === risingIsGood
  return (
    <span className={`text-xs font-semibold ${good ? 'text-[#248a3d] dark:text-[#34d399]' : 'text-[#d70015] dark:text-[#ff6b6b]'}`}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span> {Math.abs(change) >= 1000 ? '>999' : Math.round(Math.abs(change))}%
      <span className="font-normal text-[#6e6e73] dark:text-gray-400"> vs {prevName}</span>
      <span className="sr-only">{up ? ' (up)' : ' (down)'}</span>
    </span>
  )
}

// A row of choices that behave like radio buttons (filters inside a tab)
export function Choice({ label, value, onChange, options, className = '' }) {
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex max-w-full overflow-x-auto gap-1 p-1 rounded-full bg-[#e8e8ed] dark:bg-[#2c2c2e] ${className}`}>
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`shrink-0 whitespace-nowrap min-h-[36px] px-3 sm:px-3.5 rounded-full text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-[#0071e3] ${
            value === o.id
              ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-xs'
              : 'text-[#5f6368] dark:text-gray-400 hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Empty({ children }) {
  return <p className="py-10 text-center text-sm text-[#6e6e73] dark:text-gray-400">{children}</p>
}
