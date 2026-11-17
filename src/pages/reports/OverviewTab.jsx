import { useMemo, useState } from 'react'
import { TrendingUp, Receipt, ShoppingBag } from 'lucide-react'
import { Panel, Margin, ProfitText, Choice, Empty } from './ui'
import { rs, pct, plural } from './format'

function Line({ label, value, strong = false, minus = false, note, indent = false }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-2 ${strong ? '' : 'border-b border-black/[0.05] dark:border-white/[0.06]'}`}>
      <dt className={`${indent ? 'pl-3 ' : ''}${strong ? 'font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]' : 'text-[#5f6368] dark:text-gray-400'}`}>
        {label}{note && <span className="block text-xs font-normal text-[#6e6e73] dark:text-gray-500">{note}</span>}
      </dt>
      <dd className={`tabular-nums text-right ${strong ? 'font-bold text-[#1d1d1f] dark:text-[#f5f5f7]' : 'text-[#1d1d1f] dark:text-gray-200'}`}>
        {minus && value ? '− ' : ''}{rs(Math.abs(value))}
      </dd>
    </div>
  )
}

function Bar({ value, max, color }) {
  return (
    <div className="h-1.5 rounded-full bg-[#e8e8ed] dark:bg-[#2c2c2e] overflow-hidden" aria-hidden="true">
      <div className="h-full rounded-full" style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%`, background: color }} />
    </div>
  )
}

export default function OverviewTab({ report }) {
  const { stats, flowStats, productList, soldLines, expenseBreakdown, categoryData, transactions } = report
  const [bestBy, setBestBy] = useState('sales')
  const [txnType, setTxnType] = useState('all')
  const [showAllTxns, setShowAllTxns] = useState(false)

  // Phones and accessories after discounts, from the sold lines
  const split = useMemo(() => {
    const out = { phone: { qty: 0, revenue: 0, profit: 0 }, product: { qty: 0, revenue: 0, profit: 0 } }
    for (const l of soldLines) {
      const t = out[l.isPhone ? 'phone' : 'product']
      t.qty += l.qty; t.revenue += l.revenue; t.profit += l.profit
    }
    return out
  }, [soldLines])

  const best = useMemo(() => productList
    .filter(p => p.qty > 0)
    .sort((a, b) => (bestBy === 'profit' ? b.profit - a.profit : b.revenue - a.revenue))
    .slice(0, 8), [productList, bestBy])

  const cats = [...categoryData].sort((a, b) => b.value - a.value)
  const catMax = cats[0]?.value || 0
  const catTotal = cats.reduce((sum, c) => sum + c.value, 0)
  const expMax = expenseBreakdown[0]?.val || 0
  const txns = transactions.filter(t => txnType === 'all' || t.type === txnType)
  const shownTxns = showAllTxns ? txns : txns.slice(0, 6)

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        {/* Profit and loss: the period in one statement */}
        <Panel id="pl" title="Profit and loss" subtitle="How the period's sales became profit" className="lg:col-span-2">
          <dl className="text-sm">
            <Line label="Sales before discounts" value={stats.grossSales} />
            <Line label="Discounts given" value={stats.totalDiscount} minus />
            <div className="my-1 rounded-xl bg-[#0071e3]/[0.06] dark:bg-[#0a84ff]/10 px-3">
              <Line label="Sales" value={stats.netSales} strong note={plural(stats.salesCount, 'sale')} />
            </div>
            <Line label="Purchase cost of items sold" value={stats.purchaseCostOfSales} minus />
            {stats.totalDirectCosts > 0 && <Line label="Extra costs on items sold" note="Repair, PTA, courier and similar" value={stats.totalDirectCosts} minus />}
            {Boolean(stats.costAdjustments) && (
              <Line label="Stock cost corrections" value={stats.costAdjustments} minus={stats.costAdjustments > 0} />
            )}
            <div className="my-1 rounded-xl bg-[#34c759]/[0.08] px-3">
              <Line label="Profit on sales" value={stats.grossProfit} strong note={`${pct(stats.grossProfit, stats.netSales)} of sales`} />
            </div>
            {stats.creditDue > 0 && (
              <p className="py-2 text-xs text-[#5f6368] dark:text-gray-400 border-b border-black/[0.05] dark:border-white/[0.06]">
                Includes sales on credit: customers still owe {rs(stats.creditDue)} from this period. A sale counts when it is made, paid or not.
              </p>
            )}
            <Line label="Shop expenses" value={stats.expenses} minus />
            <div className="flex items-baseline justify-between gap-3 pt-3 mt-1 border-t-2 border-[#1d1d1f] dark:border-gray-300">
              <dt className="text-base font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Net profit</dt>
              <dd className={`text-xl sm:text-2xl font-bold tabular-nums ${stats.netProfit < 0 ? 'text-[#d70015] dark:text-[#ff6b6b]' : 'text-[#0071e3] dark:text-[#0a84ff]'}`}>{rs(stats.netProfit)}</dd>
            </div>
          </dl>

          {/* Phones vs accessories */}
          <div className="mt-5 grid grid-cols-2 gap-3">
            {[
              { kind: 'phone', title: 'Phones', t: split.phone },
              { kind: 'product', title: 'Accessories', t: split.product }
            ].map(({ kind, title, t }) => (
              <div key={kind} className="rounded-2xl border border-black/[0.06] dark:border-white/[0.08] p-3">
                <p className="text-xs font-semibold text-[#5f6368] dark:text-gray-400">{title} · {t.qty} sold</p>
                <p className="mt-1 text-base font-bold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">{rs(t.revenue)}</p>
                <p className="text-xs mt-0.5">
                  Profit <ProfitText value={t.profit} /> · <Margin profit={t.profit} revenue={t.revenue} kind={kind} />
                </p>
              </div>
            ))}
          </div>
        </Panel>

        <div className="space-y-4 sm:space-y-5">
          <Panel id="exp" title="Shop expenses" subtitle={expenseBreakdown.length ? `${rs(stats.expenses)} in total` : undefined}>
            {expenseBreakdown.length === 0 ? (
              <p className="text-sm text-[#6e6e73] dark:text-gray-400">No expenses in this period.</p>
            ) : (
              <ul className="space-y-3">
                {expenseBreakdown.map(e => (
                  <li key={e.cat} className="space-y-1">
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="text-[#1d1d1f] dark:text-gray-200">{e.cat}</span>
                      <span className="tabular-nums font-semibold text-[#1d1d1f] dark:text-gray-100">{rs(e.val)}</span>
                    </div>
                    <Bar value={e.val} max={expMax} color="#ff3b30" />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel id="bought" title="Stock bought" subtitle="Purchases entered in this period">
            <p className="text-2xl font-bold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">{rs(stats.purchases)}</p>
            <dl className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Phones · {flowStats.phonePurchasedUnits} bought</dt><dd className="tabular-nums">{rs(flowStats.phonePurchasedCost)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Accessories · {flowStats.bulkPurchasedUnits} units</dt><dd className="tabular-nums">{rs(flowStats.bulkPurchasedCost)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Still owed to suppliers</dt><dd className="tabular-nums">{rs(flowStats.phonePurchasedCredit + flowStats.bulkPurchasedCredit)}</dd></div>
            </dl>
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        <Panel
          id="best"
          title="Best sellers"
          subtitle="Top items this period"
          action={<Choice label="Rank best sellers by" value={bestBy} onChange={setBestBy} options={[{ id: 'sales', label: 'By sales' }, { id: 'profit', label: 'By profit' }]} />}
          bodyClassName="px-2 sm:px-3 pb-3 pt-2"
        >
          {best.length === 0 ? <Empty>Nothing sold in this period.</Empty> : (
            <ol className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
              {best.map((p, i) => (
                <li key={p.name} className="flex items-center gap-3 px-2 py-2.5">
                  <span className="w-6 h-6 shrink-0 rounded-full bg-[#f5f5f7] dark:bg-white/10 text-xs font-bold text-[#0071e3] flex items-center justify-center">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate" title={p.name}>{p.name}</p>
                    <p className="text-xs text-[#6e6e73] dark:text-gray-400">
                      {p.qty} sold · profit <ProfitText value={p.profit} className="font-normal" /> · <Margin profit={p.profit} revenue={p.revenue} kind={p.item_type} />
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7] shrink-0">{rs(bestBy === 'profit' ? p.profit : p.revenue)}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel id="cats" title="Profit by category" subtitle="Where the profit came from">
          {cats.length === 0 ? <p className="text-sm text-[#6e6e73] dark:text-gray-400">No profit recorded in this period.</p> : (
            <ul className="space-y-3">
              {cats.slice(0, 10).map(c => (
                <li key={c.name} className="space-y-1">
                  <div className="flex justify-between gap-2 text-xs">
                    <span className="text-[#1d1d1f] dark:text-gray-200">{c.name}</span>
                    <span className="tabular-nums font-semibold text-[#1d1d1f] dark:text-gray-100">{rs(c.value)} <span className="font-normal text-[#6e6e73]">({pct(c.value, catTotal)})</span></span>
                  </div>
                  <Bar value={c.value} max={catMax} color="#0071e3" />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        id="txns"
        title="Money in and out"
        subtitle="Each sale, expense and purchase, newest first"
        action={<Choice label="Show" value={txnType} onChange={(v) => { setTxnType(v); setShowAllTxns(false) }} options={[
          { id: 'all', label: 'All' }, { id: 'Sale', label: 'Sales' }, { id: 'Expense', label: 'Expenses' }, { id: 'Purchase', label: 'Purchases' }
        ]} />}
        bodyClassName="px-2 sm:px-3 pb-3 pt-2"
      >
        {txns.length === 0 ? <Empty>Nothing recorded in this period.</Empty> : (
          <>
            <ul className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
              {shownTxns.map(t => (
                <li key={t.key} className="flex items-center gap-3 px-2 py-2.5">
                  <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${t.type === 'Sale' ? 'bg-[#34c759]/10 text-[#248a3d]' : t.type === 'Expense' ? 'bg-[#ff3b30]/10 text-[#d70015]' : 'bg-[#ff9500]/10 text-[#a15c00]'}`} aria-hidden="true">
                    {t.type === 'Sale' ? <TrendingUp size={16} /> : t.type === 'Expense' ? <Receipt size={16} /> : <ShoppingBag size={16} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] truncate" title={t.label}>{t.label}</p>
                    <p className="text-xs text-[#6e6e73] dark:text-gray-400">
                      {t.date ? new Date(t.date).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                      {t.method ? <span className="capitalize"> · {t.method}</span> : null}
                    </p>
                  </div>
                  <span className={`text-sm font-semibold tabular-nums shrink-0 ${t.dir === 'in' ? 'text-[#248a3d] dark:text-[#34d399]' : 'text-[#d70015] dark:text-[#ff6b6b]'}`}>
                    {t.dir === 'in' ? '+' : '−'} {rs(t.amount)}
                  </span>
                </li>
              ))}
            </ul>
            {txns.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAllTxns(v => !v)}
                aria-expanded={showAllTxns}
                className="mt-2 ml-2 min-h-[40px] px-2 text-sm font-semibold text-[#0071e3] hover:underline rounded-lg focus-visible:outline-2 focus-visible:outline-[#0071e3]"
              >
                {showAllTxns ? 'Show fewer' : `Show all ${txns.length}`}
              </button>
            )}
          </>
        )}
      </Panel>
    </div>
  )
}
