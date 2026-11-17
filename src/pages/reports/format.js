// Number and text formatting shared by the Reports screens, exports and print.

export const rs = (n) => {
  const v = Math.round(Number(n) || 0)
  return v < 0 ? `-Rs. ${Math.abs(v).toLocaleString()}` : `Rs. ${v.toLocaleString()}`
}
export const pct = (profit, revenue) => (revenue > 0 ? `${((profit / revenue) * 100).toFixed(1)}%` : '—')
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
export const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }) : '')

// Margin colour: phones normally earn a few percent, accessories much more, so each is
// judged on its own scale. A loss is always red. The value is always written out too.
export function marginTone(profit, revenue, kind) {
  if (!(revenue > 0)) return { cls: 'text-[#6e6e73]', label: '' }
  const m = (profit / revenue) * 100
  if (m < 0) return { cls: 'text-[#d70015] dark:text-[#ff6b6b]', label: 'Loss' }
  if (kind === 'phone') {
    if (m >= 8) return { cls: 'text-[#248a3d] dark:text-[#34d399]', label: 'Good margin for a phone' }
    if (m >= 3) return { cls: 'text-[#1d1d1f] dark:text-gray-100', label: 'Normal margin for a phone' }
    return { cls: 'text-[#a15c00] dark:text-[#fbbf24]', label: 'Low margin for a phone' }
  }
  if (kind === 'product') {
    if (m >= 25) return { cls: 'text-[#248a3d] dark:text-[#34d399]', label: 'Good margin for an accessory' }
    if (m >= 10) return { cls: 'text-[#1d1d1f] dark:text-gray-100', label: 'Normal margin for an accessory' }
    return { cls: 'text-[#a15c00] dark:text-[#fbbf24]', label: 'Low margin for an accessory' }
  }
  return { cls: 'text-[#1d1d1f] dark:text-gray-100', label: '' }
}

