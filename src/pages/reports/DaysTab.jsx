import { Fragment, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts'
import { Panel, Margin, ProfitText, Empty } from './ui'
import { rs, pct, plural } from './format'

const dayLabel = (d) => d.dateObj.toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short' })
const compact = (v) => (Math.abs(v) >= 1000000 ? `${(v / 1000000).toFixed(1)}m` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))

function Details({ d }) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1.5 text-xs">
      <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Phones sold</dt><dd className="tabular-nums">{d.phonesSold} · {rs(d.phonesRevenue)}</dd></div>
      <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Accessories sold</dt><dd className="tabular-nums">{d.bulkSold} · {rs(d.bulkRevenue)}</dd></div>
      <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Before discounts</dt><dd className="tabular-nums">{rs(d.grossSales)}</dd></div>
      <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Discounts</dt><dd className="tabular-nums">{d.discount > 0 ? rs(d.discount) : '—'}</dd></div>
      <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Cash sales</dt><dd className="tabular-nums">{rs(d.cashSales)}</dd></div>
      <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Bank / wallet sales</dt><dd className="tabular-nums">{rs(d.onlineSales)}</dd></div>
      <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Credit sales</dt><dd className="tabular-nums">{rs(d.creditSales)}</dd></div>
      <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Stock bought</dt><dd className="tabular-nums">{d.purchases > 0 ? rs(d.purchases) : '—'}</dd></div>
    </dl>
  )
}

export default function DaysTab({ report, period }) {
  const days = report.dailyBreakdown
  const [open, setOpen] = useState(null)
  const toggle = (k) => setOpen(o => (o === k ? null : k))

  if (days.length === 0) return <Panel><Empty>No days to show for this period.</Empty></Panel>

  const newestFirst = [...days].reverse()
  const t = days.reduce((a, d) => ({
    orders: a.orders + d.ordersCount, units: a.units + d.totalUnits, sales: a.sales + d.netSales, cogs: a.cogs + d.cogs,
    profit: a.profit + d.grossProfit, expenses: a.expenses + d.expenses, net: a.net + d.netProfit
  }), { orders: 0, units: 0, sales: 0, cogs: 0, profit: 0, expenses: 0, net: 0 })
  const many = days.length > 1
  const best = many ? [...days].sort((a, b) => b.netSales - a.netSales)[0] : null
  const chart = days.map(d => ({ day: dayLabel(d), Sales: Math.round(d.netSales), Profit: Math.round(d.grossProfit) }))

  return (
    <div className="space-y-4">
      {/* Totals and averages first */}
      <Panel bodyClassName="px-4 py-3">
        <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-x-4 gap-y-2 text-xs">
          <div><dt className="text-[#5f6368] dark:text-gray-400">Days</dt><dd className="font-semibold tabular-nums">{days.length}</dd></div>
          <div><dt className="text-[#5f6368] dark:text-gray-400">Sales</dt><dd className="font-semibold tabular-nums">{rs(t.sales)}</dd></div>
          <div><dt className="text-[#5f6368] dark:text-gray-400">Profit</dt><dd><ProfitText value={t.profit} /> <span className="text-[#5f6368] dark:text-gray-400">({pct(t.profit, t.sales)})</span></dd></div>
          <div><dt className="text-[#5f6368] dark:text-gray-400">Expenses</dt><dd className="font-semibold tabular-nums">{rs(t.expenses)}</dd></div>
          <div><dt className="text-[#5f6368] dark:text-gray-400">Net profit</dt><dd><ProfitText value={t.net} /></dd></div>
          {many && <div><dt className="text-[#5f6368] dark:text-gray-400">Average a day</dt><dd className="font-semibold tabular-nums">{rs(t.sales / days.length)} sales · {rs(t.profit / days.length)} profit</dd></div>}
          {best && best.netSales > 0 && <div><dt className="text-[#5f6368] dark:text-gray-400">Best day</dt><dd className="font-semibold">{dayLabel(best)} · {rs(best.netSales)}</dd></div>}
        </dl>
        {period.range === 'all' && <p className="mt-2 text-xs text-[#5f6368] dark:text-gray-400">Only days with a sale, expense or purchase are listed.</p>}
      </Panel>

      {/* A chart helps only when there is more than one day */}
      {many && (
        <Panel id="days-chart" title="Sales and profit by day">
          <div className="h-56 sm:h-64" role="img" aria-label={`Bar chart of sales and profit for ${plural(days.length, 'day')}. The same figures are in the list below.`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.08)" />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#6e6e73' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
                <YAxis tickFormatter={compact} tick={{ fontSize: 12, fill: '#6e6e73' }} tickLine={false} axisLine={false} width={48} />
                <Tooltip formatter={(v) => rs(v)} cursor={{ fill: 'rgba(0,113,227,0.06)' }} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Sales" fill="#0071e3" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                <Bar dataKey="Profit" fill="#34c759" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      {/* Wide screens: table, newest day first; a row opens to show its details */}
      <Panel bodyClassName="" className="hidden md:block overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Sales, cost, profit and expenses for each day</caption>
            <thead className="bg-[#f5f5f7]/80 dark:bg-[#2c2c2e]/80 text-[#5f6368] dark:text-gray-400 border-b border-black/[0.05] dark:border-white/[0.06]">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Day</th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">Sales made</th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">Items</th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">Sales</th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">Cost of goods</th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">Profit</th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">Margin</th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">Expenses</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Net profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
              {newestFirst.map(d => {
                const isOpen = open === d.dateKey
                const idle = d.ordersCount === 0 && d.expenses === 0 && d.purchases === 0
                return (
                  <Fragment key={d.dateKey}>
                    <tr className={idle ? 'text-[#6e6e73] dark:text-gray-500' : ''}>
                      <th scope="row" className="px-2 py-1.5 font-normal">
                        <button
                          type="button"
                          onClick={() => toggle(d.dateKey)}
                          aria-expanded={isOpen}
                          aria-controls={`day-${d.dateKey}`}
                          className="min-h-[40px] w-full text-left px-2 rounded-lg flex items-center gap-2 hover:bg-[#f5f5f7] dark:hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-[#0071e3]"
                        >
                          <ChevronDown size={14} className={`shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                          <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{dayLabel(d)}</span>
                        </button>
                      </th>
                      <td className="px-3 py-2 text-right tabular-nums">{d.ordersCount || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{d.totalUnits || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-nowrap">{rs(d.netSales)}</td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{rs(d.cogs)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{d.ordersCount ? <ProfitText value={d.grossProfit} /> : '—'}</td>
                      <td className="px-3 py-2 text-right">{d.ordersCount ? <Margin profit={d.grossProfit} revenue={d.netSales} /> : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{d.expenses > 0 ? rs(d.expenses) : '—'}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{idle ? '—' : <ProfitText value={d.netProfit} className="font-bold" />}</td>
                    </tr>
                    {isOpen && (
                      <tr id={`day-${d.dateKey}`} className="bg-[#fbfbfd] dark:bg-white/[0.02]">
                        <td colSpan={9} className="px-6 py-3"><Details d={d} /></td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Phones: one card per day */}
      <ul className="md:hidden space-y-2">
        {newestFirst.map(d => {
          const isOpen = open === d.dateKey
          const idle = d.ordersCount === 0 && d.expenses === 0 && d.purchases === 0
          return (
            <li key={d.dateKey} className="bg-white dark:bg-[#1c1c1e] rounded-2xl border border-black/[0.06] dark:border-white/[0.08]">
              <button
                type="button"
                onClick={() => toggle(d.dateKey)}
                aria-expanded={isOpen}
                aria-controls={`mday-${d.dateKey}`}
                className="w-full text-left px-4 py-3 rounded-2xl focus-visible:outline-2 focus-visible:outline-[#0071e3]"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{dayLabel(d)}</span>
                    <span className="block text-xs text-[#5f6368] dark:text-gray-400">
                      {idle ? 'No activity' : `${plural(d.ordersCount, 'sale')} · ${plural(d.totalUnits, 'item')} · sales ${rs(d.netSales)}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0 text-right">
                    {!idle && <span className="text-xs"><span className="block text-[#5f6368] dark:text-gray-400">Net profit</span><ProfitText value={d.netProfit} className="font-bold text-sm" /></span>}
                    <ChevronDown size={16} className={`text-[#6e6e73] transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </span>
                </span>
              </button>
              {isOpen && (
                <div id={`mday-${d.dateKey}`} className="px-4 pb-3 space-y-2">
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                    <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Cost of goods</dt><dd className="tabular-nums">{rs(d.cogs)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Profit</dt><dd><ProfitText value={d.grossProfit} /> ({pct(d.grossProfit, d.netSales)})</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Expenses</dt><dd className="tabular-nums">{d.expenses > 0 ? rs(d.expenses) : '—'}</dd></div>
                  </dl>
                  <Details d={d} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
