import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Panel, Margin, ProfitText, Choice, Empty } from './ui'
import { rs, pct, plural, timeOf } from './format'

const SUMS = ['qty', 'revenue', 'discount', 'purchaseCost', 'extraCost', 'cost', 'profit']

export default function SoldItemsTab({ report }) {
  const [kind, setKind] = useState('all')
  const [query, setQuery] = useState('')

  // Same days as the report, narrowed by the filters, with day totals worked out again
  const days = useMemo(() => {
    const q = query.trim().toLowerCase()
    return report.soldDays.map(d => {
      const lines = d.lines.filter(l =>
        (kind === 'all' || (kind === 'phone') === l.isPhone) &&
        (!q || `${l.name} ${l.imei} ${l.customer} ${l.invoice} ${l.category}`.toLowerCase().includes(q)))
      const day = { ...d, lines }
      for (const f of SUMS) day[f] = lines.reduce((s, l) => s + l[f], 0)
      return day
    }).filter(d => d.lines.length > 0)
  }, [report.soldDays, kind, query])

  const total = days.reduce((t, d) => { for (const f of SUMS) t[f] += d[f]; return t }, Object.fromEntries(SUMS.map(f => [f, 0])))

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <label className="relative flex-1 min-w-0">
          <span className="sr-only">Search sold items</span>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6e6e73]" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Item, IMEI, customer or invoice"
            className="w-full min-h-[40px] pl-9 pr-3 rounded-full bg-white dark:bg-[#1c1c1e] border border-black/[0.08] dark:border-white/[0.1] text-sm text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-[#0071e3]"
          />
        </label>
        <Choice label="Show" value={kind} onChange={setKind} options={[
          { id: 'all', label: 'All' }, { id: 'phone', label: 'Phones' }, { id: 'product', label: 'Accessories' }
        ]} />
      </div>

      {days.length > 0 && (
        <p className="text-xs text-[#5f6368] dark:text-gray-400 px-1">
          {plural(total.qty, 'item')} · sales <b className="text-[#1d1d1f] dark:text-gray-100">{rs(total.revenue)}</b> · cost {rs(total.cost)} · profit <ProfitText value={total.profit} /> ({pct(total.profit, total.revenue)})
        </p>
      )}

      {days.length === 0 ? (
        <Panel><Empty>{report.soldDays.length ? 'No sold items match these filters.' : 'No items sold in this period.'}</Empty></Panel>
      ) : days.map(day => (
        <Panel key={day.key} bodyClassName="">
          {/* Day header with totals */}
          <div className="px-4 sm:px-5 py-3.5 bg-[#f5f5f7]/80 dark:bg-[#2c2c2e]/80 rounded-t-[20px] border-b border-black/[0.05] dark:border-white/[0.06]">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="font-semibold text-sm text-[#1d1d1f] dark:text-[#f5f5f7]">{day.label}</h2>
              <span className="text-xs text-[#5f6368] dark:text-gray-400">{plural(day.qty, 'item')} sold</span>
            </div>
            <dl className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-1 text-xs">
              <div><dt className="text-[#5f6368] dark:text-gray-400">Sales</dt><dd className="font-semibold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">{rs(day.revenue)}</dd></div>
              <div><dt className="text-[#5f6368] dark:text-gray-400">Purchase cost</dt><dd className="font-semibold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">{rs(day.purchaseCost)}</dd></div>
              <div><dt className="text-[#5f6368] dark:text-gray-400">Extra cost</dt><dd className="font-semibold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">{day.extraCost > 0 ? rs(day.extraCost) : '—'}</dd></div>
              <div><dt className="text-[#5f6368] dark:text-gray-400">Discount</dt><dd className="font-semibold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">{day.discount > 0 ? rs(day.discount) : '—'}</dd></div>
              <div><dt className="text-[#5f6368] dark:text-gray-400">Profit</dt><dd><ProfitText value={day.profit} className="font-bold" /> <span className="text-[#5f6368] dark:text-gray-400">({pct(day.profit, day.revenue)})</span></dd></div>
            </dl>
          </div>

          {/* Wide screens: table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Items sold on {day.label}</caption>
              <thead className="text-[#5f6368] dark:text-gray-400 font-semibold border-b border-black/[0.05] dark:border-white/[0.06]">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Time</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Item</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Qty</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Sale price</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Discount</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Purchase cost</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Extra cost</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Profit</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                {day.lines.map(l => (
                  <tr key={l.key} className="align-top">
                    <td className="px-4 py-2.5 tabular-nums text-[#5f6368] dark:text-gray-400 whitespace-nowrap">{timeOf(l.date)}</td>
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{l.name}</p>
                      {l.imei && <p className="text-[#5f6368] dark:text-gray-400 tabular-nums">IMEI {l.imei}</p>}
                      <p className="text-[#5f6368] dark:text-gray-400">{l.customer} · {l.invoice} · {l.category}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{l.qty}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-nowrap">{rs(l.unitPrice)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{l.discount > 0 ? rs(l.discount) : '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{rs(l.purchaseCost)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{l.extraCost > 0 ? rs(l.extraCost) : '—'}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap"><ProfitText value={l.profit} className="font-bold" /></td>
                    <td className="px-4 py-2.5 text-right"><Margin profit={l.profit} revenue={l.revenue} kind={l.isPhone ? 'phone' : 'product'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: one card per item */}
          <ul className="md:hidden divide-y divide-black/[0.05] dark:divide-white/[0.06]">
            {day.lines.map(l => (
              <li key={l.key} className="px-4 py-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-[#1d1d1f] dark:text-[#f5f5f7] break-words">{l.name}</p>
                    {l.imei && <p className="text-[#5f6368] dark:text-gray-400 tabular-nums break-all">IMEI {l.imei}</p>}
                    <p className="text-[#5f6368] dark:text-gray-400">{timeOf(l.date)} · {l.customer} · {l.invoice}</p>
                  </div>
                  <ProfitText value={l.profit} className="font-bold text-sm shrink-0" />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Sale price</dt><dd className="tabular-nums font-semibold">{l.qty > 1 ? `${l.qty} × ` : ''}{rs(l.unitPrice)}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Purchase</dt><dd className="tabular-nums">{rs(l.purchaseCost)}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Discount</dt><dd className="tabular-nums">{l.discount > 0 ? rs(l.discount) : '—'}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Extra cost</dt><dd className="tabular-nums">{l.extraCost > 0 ? rs(l.extraCost) : '—'}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Margin</dt><dd><Margin profit={l.profit} revenue={l.revenue} kind={l.isPhone ? 'phone' : 'product'} /></dd></div>
                </dl>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  )
}
