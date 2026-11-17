import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Printer, CalendarDays } from 'lucide-react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { hasFeature } from '../utils/featureGate'
import UpgradeWall from '../components/UpgradeWall'
import { Button } from '../components/ui'
import { notify } from '../utils/toast'
import { buildReport, isCountedSale } from './reports/buildReport'
import { getPeriod, RANGES } from './reports/period'
import { rs, pct, plural } from './reports/format'
import { Change, Choice } from './reports/ui'
import { downloadExcel, printReport, EXCEL_LABEL } from './reports/exports'
import OverviewTab from './reports/OverviewTab'
import SoldItemsTab from './reports/SoldItemsTab'
import ProductsTab from './reports/ProductsTab'
import DaysTab from './reports/DaysTab'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'items', label: 'Sold items' },
  { id: 'products', label: 'Products' },
  { id: 'days', label: 'Days' }
]

const PAGE = 1000
// Supabase returns at most 1000 rows per request: read every page, in a fixed order, so a
// busy period is not silently cut short.
async function fetchAll(makeQuery, { required = false } = {}) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (error) {
      if (required) throw error
      return { data: rows.length ? rows : null, error }
    }
    rows.push(...(data || []))
    if (!data || data.length < PAGE) return { data: rows, error: null }
  }
}

// Sales, their lines, expenses, purchases and cost corrections for one period, from the server.
// Quotations and voided sales are left out; a sale with no sale_type counts as a sale.
async function fetchPeriodRows(shopId, start, end, { withPurchases = true } = {}) {
  const a = start.toISOString()
  const b = end.toISOString()
  const [salesRes, itemsRes, expensesRes, purchasesRes, costAdjRes] = await Promise.all([
    fetchAll(() => supabase.from('sales').select('*').eq('shop_id', shopId).gte('created_at', a).lte('created_at', b), { required: true }),
    fetchAll(() => supabase.from('sale_items').select('*, products(name, category_id, inventory_mode, categories(name)), sales!inner(created_at, sale_type, shop_id, status)').eq('sales.shop_id', shopId).gte('sales.created_at', a).lte('sales.created_at', b), { required: true }),
    fetchAll(() => supabase.from('expenses').select('*').eq('shop_id', shopId).gte('created_at', a).lte('created_at', b), { required: true }),
    withPurchases
      ? fetchAll(() => supabase.from('purchases').select('*, purchase_items(*)').eq('shop_id', shopId).gte('created_at', a).lte('created_at', b))
      : Promise.resolve({ data: [] }),
    fetchAll(() => supabase.from('batch_cost_adjustments').select('*').eq('shop_id', shopId).gte('adjusted_at', a).lte('adjusted_at', b))
  ])
  const sales = (salesRes.data || []).filter(isCountedSale)
  const ids = new Set(sales.map(x => String(x.id)))
  return {
    raw: { sales: salesRes.data, items: itemsRes.data, expenses: expensesRes.data, purchases: purchasesRes.data },
    sales,
    items: (itemsRes.data || []).filter(i => ids.has(String(i.sale_id))),
    expenses: expensesRes.data || [],
    purchases: purchasesRes.data || [],
    costAdjustments: costAdjRes?.data || []
  }
}

// The same rows from this device, when the server cannot be reached
async function readLocalRows(shopId, start, end) {
  const sid = String(shopId)
  const inRange = (x) => String(x.shop_id) === sid && new Date(x.created_at) >= start && new Date(x.created_at) <= end
  const [lSales, lItems, lExpenses, lPurchases, lPurchaseItems] = await Promise.all([
    db.sales.toArray(),
    db.sale_items.toArray(),
    db.expenses.toArray(),
    db.purchases.toArray(),
    db.purchase_items ? db.purchase_items.toArray().catch(() => []) : Promise.resolve([])
  ])
  const sales = lSales.filter(x => inRange(x) && isCountedSale(x))
  const saleIds = new Set(sales.map(s => s.id))
  const itemsByPurchase = (lPurchaseItems || []).reduce((acc, pi) => { (acc[pi.purchase_id] ||= []).push(pi); return acc }, {})
  return {
    sales,
    items: lItems.filter(i => saleIds.has(i.sale_id)),
    expenses: lExpenses.filter(inRange),
    purchases: lPurchases.filter(inRange).map(p => ({ ...p, purchase_items: p.purchase_items || itemsByPurchase[p.id] || [] })),
    costAdjustments: []
  }
}

async function cacheRows(rows, phones) {
  const { sales, items, expenses, purchases } = rows.raw
  if (sales) await db.sales.bulkPut(JSON.parse(JSON.stringify(sales))).catch(() => {})
  if (items && db.sale_items) {
    const ids = (sales || []).map(s => s.id).filter(Boolean)
    if (ids.length > 0) await db.sale_items.where('sale_id').anyOf(ids).delete().catch(() => {})
    await db.sale_items.bulkPut(JSON.parse(JSON.stringify(items))).catch(() => {})
  }
  if (expenses) await db.expenses.bulkPut(JSON.parse(JSON.stringify(expenses))).catch(() => {})
  if (purchases) await db.purchases.bulkPut(JSON.parse(JSON.stringify(purchases))).catch(() => {})
  if (phones && db.phones) await db.phones.bulkPut(JSON.parse(JSON.stringify(phones))).catch(() => {})
}

function KpiCard({ label, value, sub, change, tone = 'ink' }) {
  const toneCls = {
    ink: 'text-[#1d1d1f] dark:text-[#f5f5f7]',
    good: 'text-[#248a3d] dark:text-[#34d399]',
    bad: 'text-[#d70015] dark:text-[#ff6b6b]',
    accent: 'text-[#0071e3] dark:text-[#0a84ff]'
  }[tone]
  return (
    <div className="bg-white dark:bg-[#1c1c1e] rounded-[20px] border border-black/[0.06] dark:border-white/[0.08] shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 sm:p-5 min-w-0">
      <p className="text-xs font-semibold text-[#5f6368] dark:text-gray-400">{label}</p>
      <p className={`mt-1 text-xl sm:text-2xl font-bold tracking-tight tabular-nums truncate ${toneCls}`}>{value}</p>
      {sub && <p className="text-xs text-[#5f6368] dark:text-gray-400 mt-0.5">{sub}</p>}
      <div className="mt-1.5 min-h-[18px]">{change}</div>
    </div>
  )
}

function Reports() {
  const { user } = useAuth()
  const shopId = user?.shop_id
  const [range, setRange] = useState('today')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  // 'live' = figures from the server; 'cached' = server unavailable, figures from this device
  const [dataSource, setDataSource] = useState(null)
  const [report, setReport] = useState(null)
  const [prevStats, setPrevStats] = useState(null)
  const [exporting, setExporting] = useState(false)
  const tabRefs = useRef({})

  const period = useMemo(() => getPeriod(range, customStart, customEnd), [range, customStart, customEnd])

  useEffect(() => {
    if (!shopId) return
    let cancelled = false
    const { start, end, prev } = period

    const load = async () => {
      setLoading(true)
      try {
        if (!navigator.onLine) throw new Error('Offline')
        const work = Promise.all([
          fetchPeriodRows(shopId, start, end),
          prev ? fetchPeriodRows(shopId, prev.start, prev.end, { withPurchases: false }) : Promise.resolve(null),
          fetchAll(() => supabase.from('products').select('id, name, stock_quantity, cost_price, sale_price, category_id, inventory_mode, categories(name)').eq('shop_id', shopId)),
          fetchAll(() => supabase.from('categories').select('*').eq('shop_id', shopId)),
          // all columns: purchase_date and sold_at exist only on some databases
          fetchAll(() => supabase.from('phones').select('*').eq('shop_id', shopId)),
          fetchAll(() => supabase.from('stock_batches').select('*').eq('shop_id', shopId).eq('status', 'active').gt('qty_remaining', 0))
        ])
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
        const [rows, prevRows, productsRes, catsRes, phonesRes, batchesRes] = await Promise.race([work, timeout])
        const catalog = {
          liveProducts: productsRes.data || [],
          catList: catsRes.data || [],
          phones: phonesRes.data || [],
          activeBatches: batchesRes?.data || []
        }
        await cacheRows(rows, phonesRes.data)
        if (cancelled) return
        setReport(buildReport({ ...rows, ...catalog, startDate: start, endDate: end }))
        setPrevStats(prevRows ? buildReport({ ...prevRows, ...catalog, startDate: prev.start, endDate: prev.end }).stats : null)
        setDataSource('live')
      } catch (e) {
        console.warn('Reports: calculating from this device...', e)
        try {
          const sid = String(shopId)
          const [rows, prevRows, lProducts, lCats, lPhones] = await Promise.all([
            readLocalRows(shopId, start, end),
            prev ? readLocalRows(shopId, prev.start, prev.end) : Promise.resolve(null),
            db.products.toArray(),
            db.categories.toArray(),
            db.phones ? db.phones.toArray().catch(() => []) : Promise.resolve([])
          ])
          const catalog = {
            liveProducts: lProducts.filter(x => String(x.shop_id) === sid),
            catList: lCats.filter(x => String(x.shop_id) === sid),
            phones: (lPhones || []).filter(x => String(x.shop_id) === sid),
            activeBatches: []
          }
          if (cancelled) return
          setReport(buildReport({ ...rows, ...catalog, startDate: start, endDate: end }))
          setPrevStats(prevRows ? buildReport({ ...prevRows, ...catalog, purchases: [], startDate: prev.start, endDate: prev.end }).stats : null)
          setDataSource('cached')
        } catch (err) {
          console.error('Reports: could not read figures from this device either', err)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [shopId, period])

  const onTabKey = (e, i) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
    let next = null
    if (step) next = (i + step + TABS.length) % TABS.length
    if (e.key === 'Home') next = 0
    if (e.key === 'End') next = TABS.length - 1
    if (next === null) return
    e.preventDefault()
    setTab(TABS[next].id)
    tabRefs.current[TABS[next].id]?.focus()
  }

  const onExcel = async () => {
    if (!report) return
    setExporting(true)
    try {
      await downloadExcel(tab, report, period)
    } catch (err) {
      notify(`Could not make the Excel file: ${err.message}`, 'error')
    } finally {
      setExporting(false)
    }
  }

  if (!hasFeature('reports')) return <UpgradeWall feature="reports" />

  const s = report?.stats
  const prev = period.prev ? prevStats : null

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-12">
      {dataSource === 'cached' && !loading && (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
          <strong>Showing figures saved on this device.</strong> The server could not be reached, so these
          totals may be incomplete or out of date. Reload when you are online for exact figures.
        </div>
      )}

      {/* Title, the dates covered, period choice and actions */}
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">Reports</h1>
          <p className="mt-1 text-sm text-[#5f6368] dark:text-gray-400 flex items-center gap-1.5">
            <CalendarDays size={15} aria-hidden="true" className="shrink-0" />
            <span><b className="font-semibold text-[#1d1d1f] dark:text-gray-200">{period.name}</b> · {period.dates}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Choice label="Period" value={range} onChange={setRange} options={RANGES} />
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onExcel} loading={exporting} disabled={!report || loading}>
              <Download size={14} aria-hidden="true" /> {EXCEL_LABEL[tab]}
            </Button>
            <Button variant="primary" size="sm" onClick={() => report && printReport(report, period, shopId)} disabled={!report || loading}>
              <Printer size={14} aria-hidden="true" /> Print report
            </Button>
          </div>
        </div>
      </header>

      {range === 'custom' && (
        <div className="flex flex-wrap items-end gap-3 bg-white dark:bg-[#1c1c1e] rounded-[20px] border border-black/[0.06] dark:border-white/[0.08] p-3.5">
          <label className="text-xs font-semibold text-[#5f6368] dark:text-gray-400">
            From
            <input type="date" value={customStart} max={customEnd || undefined} onChange={e => setCustomStart(e.target.value)}
              className="block mt-1 min-h-[40px] px-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-black/[0.06] dark:border-white/[0.08] text-sm text-[#1d1d1f] dark:text-[#f5f5f7]" />
          </label>
          <label className="text-xs font-semibold text-[#5f6368] dark:text-gray-400">
            To
            <input type="date" value={customEnd} min={customStart || undefined} onChange={e => setCustomEnd(e.target.value)}
              className="block mt-1 min-h-[40px] px-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-black/[0.06] dark:border-white/[0.08] text-sm text-[#1d1d1f] dark:text-[#f5f5f7]" />
          </label>
          {(customStart || customEnd) && (
            <Button variant="ghost" size="sm" onClick={() => { setCustomStart(''); setCustomEnd('') }}>Clear dates</Button>
          )}
        </div>
      )}

      {loading && !report ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-pulse" aria-label="Loading report">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-28 bg-[#e5e5ea]/60 dark:bg-[#2c2c2e]/60 rounded-[20px]" />)}
        </div>
      ) : !report ? (
        <p className="text-sm text-[#5f6368]">The report could not be loaded. Check the connection and try again.</p>
      ) : (
        <div className={`space-y-5 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading || undefined}>
          {/* The four figures that matter most, with the change from the period before */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <KpiCard label="Sales" value={rs(s.netSales)} sub={`${plural(s.salesCount, 'sale')} · ${plural(s.totalUnitsSold, 'item')}`}
              change={prev && <Change now={s.netSales} before={prev.netSales} prevName={period.prevName} />} />
            <KpiCard label="Profit on sales" value={rs(s.grossProfit)} tone={s.grossProfit < 0 ? 'bad' : 'good'} sub={`${pct(s.grossProfit, s.netSales)} of sales`}
              change={prev && <Change now={s.grossProfit} before={prev.grossProfit} prevName={period.prevName} />} />
            <KpiCard label="Shop expenses" value={rs(s.expenses)} sub={plural(report.expenseBreakdown.length, 'type')}
              change={prev && <Change now={s.expenses} before={prev.expenses} prevName={period.prevName} risingIsGood={false} />} />
            <KpiCard label="Net profit" value={rs(s.netProfit)} tone={s.netProfit < 0 ? 'bad' : 'accent'} sub="After costs and expenses"
              change={prev && <Change now={s.netProfit} before={prev.netProfit} prevName={period.prevName} />} />
          </div>

          {/* Tabs: one row; scrolls sideways on narrow screens */}
          <div className="overflow-x-auto -mx-1 px-1 pb-1">
            <div role="tablist" aria-label="Report sections" className="inline-flex gap-1 p-1 rounded-full bg-[#e8e8ed] dark:bg-[#2c2c2e] whitespace-nowrap">
              {TABS.map((t, i) => {
                const count = t.id === 'items' ? report.soldLines.length : t.id === 'products' ? report.productList.filter(p => p.qty > 0).length : null
                const selected = tab === t.id
                return (
                  <button
                    key={t.id}
                    ref={el => { tabRefs.current[t.id] = el }}
                    id={`tab-${t.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`panel-${t.id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setTab(t.id)}
                    onKeyDown={e => onTabKey(e, i)}
                    className={`min-h-[40px] px-4 rounded-full text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-[#0071e3] ${
                      selected
                        ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-xs'
                        : 'text-[#5f6368] dark:text-gray-400 hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
                    }`}
                  >
                    {t.label}{count != null && <span className="ml-1 font-normal text-[#6e6e73] dark:text-gray-500">({count})</span>}
                  </button>
                )
              })}
            </div>
          </div>

          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === 'overview' && <OverviewTab report={report} />}
            {tab === 'items' && <SoldItemsTab report={report} />}
            {tab === 'products' && <ProductsTab report={report} />}
            {tab === 'days' && <DaysTab report={report} period={period} />}
          </div>
        </div>
      )}
    </div>
  )
}

export default Reports
