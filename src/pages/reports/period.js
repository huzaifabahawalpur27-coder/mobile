// The dates a report covers, a readable label for them, and the period just before it
// (same length) for the "vs previous" figures on the cards.

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

const fmtDay = (d, withYear = true) => d.toLocaleDateString('en-PK', {
  weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {})
})
const fmtRange = (a, b) => {
  if (startOfDay(a).getTime() === startOfDay(b).getTime()) return fmtDay(a)
  const sameYear = a.getFullYear() === b.getFullYear()
  return `${fmtDay(a, !sameYear)} – ${fmtDay(b)}`
}

export const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: '7 days' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' }
]

export function getPeriod(range, customStart = '', customEnd = '', now = new Date()) {
  const today = startOfDay(now)
  let start = today
  let end = endOfDay(now)
  let prev = null
  let name = ''
  let prevName = 'previous period'

  if (range === 'today') {
    name = 'Today'
    prev = { start: addDays(today, -1), end: endOfDay(addDays(today, -1)) }
    prevName = 'yesterday'
  } else if (range === 'week') {
    // the last 7 days including today
    start = addDays(today, -6)
    name = 'Last 7 days'
    prev = { start: addDays(start, -7), end: endOfDay(addDays(start, -1)) }
    prevName = 'previous 7 days'
  } else if (range === 'month') {
    start = new Date(today.getFullYear(), today.getMonth(), 1)
    name = 'This month'
    // the same days of last month (1st to today's date, or its last day)
    const prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const prevLast = new Date(today.getFullYear(), today.getMonth(), 0).getDate()
    const prevEnd = new Date(today.getFullYear(), today.getMonth() - 1, Math.min(today.getDate(), prevLast))
    prev = { start: prevStart, end: endOfDay(prevEnd) }
    prevName = 'same days last month'
  } else if (range === 'all') {
    start = new Date(2000, 0, 1)
    name = 'All time'
  } else if (range === 'custom') {
    if (customStart) start = startOfDay(new Date(`${customStart}T00:00:00`))
    if (customEnd) end = endOfDay(new Date(`${customEnd}T00:00:00`))
    if (end < start) end = endOfDay(start)
    name = 'Custom'
    const days = Math.round((startOfDay(end) - start) / 86400000) + 1
    prev = { start: addDays(start, -days), end: endOfDay(addDays(start, -1)) }
    prevName = `previous ${days} day${days === 1 ? '' : 's'}`
  }

  return {
    range,
    start,
    end,
    name,
    dates: range === 'all' ? 'Every sale recorded' : fmtRange(start, end),
    prev,
    prevName
  }
}
