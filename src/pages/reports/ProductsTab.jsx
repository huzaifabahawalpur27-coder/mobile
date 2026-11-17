import { useMemo, useState } from 'react'
import { Search, Smartphone, Package } from 'lucide-react'
import { Panel, Margin, ProfitText, Choice, Empty } from './ui'
import { rs, pct, plural } from './format'

const selectCls = 'min-h-[40px] px-3 rounded-full bg-white dark:bg-[#1c1c1e] border border-black/[0.08] dark:border-white/[0.1] text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-[#0071e3]'

function Stock({ value }) {
  const n = Number(value) || 0
  if (n <= 0) return <span className="text-[#6e6e73] dark:text-gray-400">Out of stock</span>
  if (n <= 3) return <span className="font-semibold text-[#a15c00] dark:text-[#fbbf24]">{n} left</span>
  return <span className="font-semibold text-[#1d1d1f] dark:text-gray-100 tabular-nums">{n}</span>
}

function Kind({ type }) {
  const phone = type === 'phone'
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${phone ? 'text-[#8944ab] dark:text-[#d0a6f0]' : 'text-[#0062c4] dark:text-[#64b5ff]'}`}>
      {phone ? <Smartphone size={12} aria-hidden="true" /> : <Package size={12} aria-hidden="true" />}
      {phone ? 'Phone' : 'Accessory'}
    </span>
  )
}

export default function ProductsTab({ report }) {
  const { productList, flowStats } = report
  const [kind, setKind] = useState('all')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [stock, setStock] = useState('all')
  const [sortBy, setSortBy] = useState('revenue')

  const categories = useMemo(() => [...new Set(productList.map(p => p.category).filter(Boolean))].sort(), [productList])

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return productList
      .filter(p => {
        if (kind === 'product' && p.item_type !== 'product') return false
        if (kind === 'phone' && p.item_type !== 'phone') return false
        if (q && !`${p.name} ${p.category}`.toLowerCase().includes(q)) return false
        if (category !== 'all' && p.category !== category) return false
        const n = Number(p.stock)
        if (stock === 'in_stock') return n > 0
        if (stock === 'low_stock') return n > 0 && n <= 3
        if (stock === 'out_of_stock') return n <= 0
        if (stock === 'sold') return p.qty > 0
        return true
      })
      .sort((a, b) => {
        if (sortBy === 'qty') return b.qty - a.qty
        if (sortBy === 'profit') return b.profit - a.profit
        if (sortBy === 'margin') return b.margin - a.margin
        if (sortBy === 'slow') return a.qty - b.qty
        if (sortBy === 'bought') return (b.inwardQty || 0) - (a.inwardQty || 0)
        return b.revenue - a.revenue
      })
  }, [productList, kind, search, category, stock, sortBy])

  const totals = list.reduce((t, p) => ({
    bought: t.bought + (p.inwardQty || 0), sold: t.sold + p.qty, revenue: t.revenue + p.revenue,
    cost: t.cost + p.cost, profit: t.profit + p.profit, stock: t.stock + Math.max(0, Number(p.stock) || 0)
  }), { bought: 0, sold: 0, revenue: 0, cost: 0, profit: 0, stock: 0 })

  const sold = productList.filter(p => p.qty > 0)
  const top = (fn) => [...sold].sort(fn)[0]
  const highlights = sold.length ? [
    { label: 'Most sales', p: top((a, b) => b.revenue - a.revenue), value: (p) => rs(p.revenue) },
    { label: 'Most units', p: top((a, b) => b.qty - a.qty), value: (p) => `${p.qty} sold` },
    { label: 'Most profit', p: top((a, b) => b.profit - a.profit), value: (p) => rs(p.profit) }
  ] : []

  return (
    <div className="space-y-4">
      {/* Stock position */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { title: 'Phones', stockUnits: flowStats.phoneStockUnits, stockValue: flowStats.phoneStockValue, bought: flowStats.phonePurchasedUnits, sold: flowStats.phoneSoldUnits, unit: 'phone' },
          { title: 'Accessories', stockUnits: flowStats.bulkStockUnits, stockValue: flowStats.bulkStockValue, bought: flowStats.bulkPurchasedUnits, sold: flowStats.bulkSoldUnits, unit: 'unit' }
        ].map(s => (
          <Panel key={s.title} bodyClassName="p-4">
            <p className="text-xs font-semibold text-[#5f6368] dark:text-gray-400">{s.title} in stock</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">{rs(s.stockValue)}</p>
            <p className="text-xs text-[#5f6368] dark:text-gray-400 mt-0.5">{plural(s.stockUnits, s.unit)} on hand · this period {s.bought} bought, {s.sold} sold</p>
          </Panel>
        ))}
        <Panel bodyClassName="p-4">
          <p className="text-xs font-semibold text-[#5f6368] dark:text-gray-400">All stock at cost</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">{rs(flowStats.totalStockValuation)}</p>
          <p className="text-xs text-[#5f6368] dark:text-gray-400 mt-0.5">What the stock on hand cost to buy</p>
        </Panel>
      </div>

      {/* Highlights in one compact strip */}
      {highlights.length > 0 && (
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-px rounded-[20px] overflow-hidden border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.06] dark:bg-white/[0.08]">
          {highlights.map(h => (
            <div key={h.label} className="bg-white dark:bg-[#1c1c1e] px-4 py-3 flex items-baseline justify-between gap-3 sm:block">
              <dt className="text-xs font-semibold text-[#5f6368] dark:text-gray-400 shrink-0">{h.label}</dt>
              <dd className="min-w-0 text-right sm:text-left">
                <span className="block text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate" title={h.p.name}>{h.p.name}</span>
                <span className="text-xs text-[#5f6368] dark:text-gray-400 tabular-nums">{h.value(h.p)}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/* Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-2">
        <label className="relative flex-1 min-w-0">
          <span className="sr-only">Search products</span>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6e6e73]" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Product or category"
            className="w-full min-h-[40px] pl-9 pr-3 rounded-full bg-white dark:bg-[#1c1c1e] border border-black/[0.08] dark:border-white/[0.1] text-sm text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-[#0071e3]"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Choice label="Type" value={kind} onChange={setKind} options={[
            { id: 'all', label: 'All' }, { id: 'phone', label: 'Phones' }, { id: 'product', label: 'Accessories' }
          ]} />
          <select aria-label="Category" value={category} onChange={e => setCategory(e.target.value)} className={selectCls}>
            <option value="all">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select aria-label="Stock" value={stock} onChange={e => setStock(e.target.value)} className={selectCls}>
            <option value="all">Any stock</option>
            <option value="sold">Sold this period</option>
            <option value="in_stock">In stock</option>
            <option value="low_stock">3 or fewer left</option>
            <option value="out_of_stock">Out of stock</option>
          </select>
          <select aria-label="Sort by" value={sortBy} onChange={e => setSortBy(e.target.value)} className={selectCls}>
            <option value="revenue">Most sales</option>
            <option value="profit">Most profit</option>
            <option value="qty">Most units sold</option>
            <option value="margin">Highest margin</option>
            <option value="bought">Most bought</option>
            <option value="slow">Slowest selling</option>
          </select>
        </div>
      </div>

      {list.length === 0 ? <Panel><Empty>No products match these filters.</Empty></Panel> : (
        <>
          {/* Totals first, so they are never cut off */}
          <Panel bodyClassName="px-4 py-3">
            <dl className="grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-2 text-xs">
              <div><dt className="text-[#5f6368] dark:text-gray-400">Products</dt><dd className="font-semibold tabular-nums">{list.length}</dd></div>
              <div><dt className="text-[#5f6368] dark:text-gray-400">Bought</dt><dd className="font-semibold tabular-nums">{totals.bought}</dd></div>
              <div><dt className="text-[#5f6368] dark:text-gray-400">Sold</dt><dd className="font-semibold tabular-nums">{totals.sold}</dd></div>
              <div><dt className="text-[#5f6368] dark:text-gray-400">Sales</dt><dd className="font-semibold tabular-nums">{rs(totals.revenue)}</dd></div>
              <div><dt className="text-[#5f6368] dark:text-gray-400">Cost</dt><dd className="font-semibold tabular-nums">{rs(totals.cost)}</dd></div>
              <div><dt className="text-[#5f6368] dark:text-gray-400">Profit</dt><dd><ProfitText value={totals.profit} /> <span className="text-[#5f6368] dark:text-gray-400">({pct(totals.profit, totals.revenue)})</span></dd></div>
            </dl>
          </Panel>

          {/* Wide screens: table */}
          <Panel bodyClassName="" className="hidden md:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Products with units bought and sold, sales, cost, profit and stock</caption>
                <thead className="bg-[#f5f5f7]/80 dark:bg-[#2c2c2e]/80 text-[#5f6368] dark:text-gray-400 border-b border-black/[0.05] dark:border-white/[0.06]">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">Product</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Bought</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Sold</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Sales</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Cost</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Profit</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Margin</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">In stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                  {list.map(p => (
                    <tr key={p.name} className="align-top">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{p.name}</p>
                        <p className="text-[#5f6368] dark:text-gray-400"><Kind type={p.item_type} /> · {p.category}</p>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{p.inwardQty || '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold">{p.qty || '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-nowrap">{p.qty > 0 ? rs(p.revenue) : '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                        {p.qty > 0 ? (
                          <>
                            <span className="block">{rs(p.cost)}</span>
                            {p.directCost > 0 && <span className="block text-[#5f6368] dark:text-gray-400">{rs(p.baseCost)} + extra {rs(p.directCost)}</span>}
                          </>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">{p.qty > 0 ? <ProfitText value={p.profit} /> : '—'}</td>
                      <td className="px-3 py-3 text-right">{p.qty > 0 ? <Margin profit={p.profit} revenue={p.revenue} kind={p.item_type} /> : '—'}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap"><Stock value={p.stock} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Phones: one card per product */}
          <ul className="md:hidden space-y-2">
            {list.map(p => (
              <li key={p.name} className="bg-white dark:bg-[#1c1c1e] rounded-2xl border border-black/[0.06] dark:border-white/[0.08] px-4 py-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] break-words">{p.name}</p>
                    <p className="text-[#5f6368] dark:text-gray-400"><Kind type={p.item_type} /> · {p.category}</p>
                  </div>
                  <span className="shrink-0 text-right"><Stock value={p.stock} /></span>
                </div>
                {p.qty > 0 ? (
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                    <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Sold</dt><dd className="tabular-nums font-semibold">{p.qty}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Sales</dt><dd className="tabular-nums font-semibold">{rs(p.revenue)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Cost</dt><dd className="tabular-nums">{rs(p.cost)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Profit</dt><dd><ProfitText value={p.profit} /></dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Margin</dt><dd><Margin profit={p.profit} revenue={p.revenue} kind={p.item_type} /></dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-[#5f6368] dark:text-gray-400">Bought</dt><dd className="tabular-nums">{p.inwardQty || '—'}</dd></div>
                  </dl>
                ) : (
                  <p className="mt-1.5 text-[#5f6368] dark:text-gray-400">Not sold this period{p.inwardQty ? ` · ${p.inwardQty} bought` : ''}</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
