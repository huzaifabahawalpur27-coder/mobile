import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, ChevronRight, ChevronDown, Smartphone, Package, User, Receipt } from 'lucide-react'

// Detailed list of the latest completed sales for the Dashboard: customer, time,
// every product line (name, IMEI for phones, quantity x price, returns) and the
// payment breakdown (method, discount, paid, due).

const ITEMS_COLLAPSED = 3

const money = (n) => `Rs. ${Math.round(Number(n) || 0).toLocaleString()}`

const parseSnapshot = (snap) => {
  if (!snap) return null
  if (typeof snap === 'object') return snap
  try {
    const parsed = JSON.parse(snap)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

const describeItem = (it) => {
  const snap = parseSnapshot(it.imei_snapshot)
  const isPhone = Boolean(it.phone_id || snap?.imei_1)
  const qty = Number(it.quantity || 1)
  const unit = Number(it.unit_price ?? it.price ?? 0)
  const lineTotal = Number(it.line_total ?? it.subtotal ?? unit * qty)
  // POS adds "[IMEI: ...]" to phone names; show the IMEI on its own line instead
  let name = String(it.product_name || it.products?.name || '').replace(/\s*\[IMEI:[^\]]*\]\s*/i, ' ').trim()
  if (!name && snap) name = `${snap.brand && snap.brand !== 'Unknown' ? `${snap.brand} ` : ''}${snap.model || 'Mobile phone'}`.trim()
  if (!name) name = 'Item'
  const specs = snap ? [snap.storage, snap.color, snap.condition, snap.pta_status].filter(Boolean).join(' · ') : ''
  return {
    key: it.id || `${it.product_id}-${it.phone_id}-${name}`,
    isPhone,
    name,
    imei: snap ? [snap.imei_1, snap.imei_2].filter(Boolean).join(' / ') : '',
    specs,
    category: it.products?.categories?.name || '',
    qty,
    unit,
    lineTotal,
    returned: Number(it.returned_qty || 0)
  }
}

const paymentLabel = (s) => {
  const type = String(s.payment_type || s.payment_method || 'cash').toLowerCase()
  if (type === 'split' && Array.isArray(s.payment_details) && s.payment_details.length > 0) {
    return s.payment_details
      .map(p => `${p.provider || p.method || 'cash'} ${money(p.amount)}`)
      .join(' + ')
  }
  if (s.online_provider && type !== 'cash' && type !== 'credit') return `${type} · ${s.online_provider}`
  return type
}

const badgeClass = (type) => {
  if (type === 'cash') return 'bg-[#34c759]/10 text-[#248a3d]'
  if (type === 'credit') return 'bg-[#ff9500]/10 text-[#c93400]'
  return 'bg-[#5856d6]/10 text-[#5856d6]'
}

function SaleCard({ sale }) {
  const [expanded, setExpanded] = useState(false)
  const items = (sale.sale_items || []).map(describeItem)
  const shown = expanded ? items : items.slice(0, ITEMS_COLLAPSED)
  const hidden = items.length - shown.length

  const gross = Number(sale.total_amount || 0)
  const discount = Number(sale.discount || 0)
  const net = Number(sale.net_amount ?? (gross - discount))
  const paid = sale.paid_amount != null ? Math.min(Number(sale.paid_amount), net) : null
  const due = paid != null ? Math.max(0, net - paid) : 0
  const type = String(sale.payment_type || sale.payment_method || 'cash').toLowerCase()
  const unitCount = items.reduce((sum, i) => sum + i.qty, 0)

  const when = sale.created_at ? new Date(sale.created_at) : null
  const isToday = when && when.toDateString() === new Date().toDateString()
  const timeStr = when
    ? `${isToday ? 'Today' : when.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}, ${when.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}`
    : ''
  const invoice = sale.invoice_number || (sale.invoice_token ? `INV-${sale.invoice_token}` : `#${sale.id}`)
  const customer = sale.customer_name || sale.customers?.name || 'Walk-in customer'
  const phone = sale.customer_phone || sale.customers?.phone || ''

  return (
    <li className="rounded-[18px] border border-black/[0.06] dark:border-white/[0.08] bg-[#fbfbfd] dark:bg-white/[0.02] p-3.5 sm:p-4 flex flex-col gap-3">
      {/* Header: customer, time, invoice, total */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-1.5 min-w-0">
            <User size={14} className="text-[#0071e3] shrink-0" aria-hidden="true" />
            <span className="truncate">{customer}</span>
          </p>
          <p className="text-xs text-[#6e6e73] dark:text-gray-400 mt-0.5 flex flex-wrap gap-x-2">
            <span className="tabular-nums">{timeStr}</span>
            <span className="inline-flex items-center gap-1"><Receipt size={12} aria-hidden="true" />{invoice}</span>
            {phone && <span className="tabular-nums">{phone}</span>}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-bold text-sm sm:text-base text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">{money(net)}</p>
          <span className={`text-xs font-semibold capitalize px-2 py-0.5 rounded-full inline-block mt-0.5 ${badgeClass(type)}`}>
            {type}
          </span>
        </div>
      </div>

      {/* Products */}
      {items.length > 0 ? (
        <ul className="divide-y divide-black/[0.05] dark:divide-white/[0.06] border-y border-black/[0.05] dark:border-white/[0.06]">
          {shown.map(it => (
            <li key={it.key} className="py-2 flex items-start justify-between gap-3 text-xs">
              <div className="flex items-start gap-2 min-w-0">
                <span className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${it.isPhone ? 'bg-[#af52de]/10 text-[#af52de]' : 'bg-[#0071e3]/10 text-[#0071e3]'}`}>
                  {it.isPhone ? <Smartphone size={13} aria-label="Phone" /> : <Package size={13} aria-label="Product" />}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-[#1d1d1f] dark:text-gray-100 break-words">{it.name}</p>
                  {it.imei && <p className="text-[#6e6e73] dark:text-gray-400 tabular-nums break-all">IMEI {it.imei}</p>}
                  {(it.specs || it.category) && (
                    <p className="text-[#6e6e73] dark:text-gray-400">{[it.specs, it.category].filter(Boolean).join(' · ')}</p>
                  )}
                  {it.returned > 0 && (
                    <p className="text-[#c93400] font-semibold">{it.returned} returned</p>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0 tabular-nums">
                <p className="font-semibold text-[#1d1d1f] dark:text-gray-100">{money(it.lineTotal)}</p>
                <p className="text-[#6e6e73] dark:text-gray-400">{it.qty} × {money(it.unit)}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-[#6e6e73] italic">Item details are not available for this sale.</p>
      )}

      {(hidden > 0 || (expanded && items.length > ITEMS_COLLAPSED)) && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="self-start text-xs font-semibold text-[#0071e3] hover:underline inline-flex items-center gap-1 rounded-md focus-visible:outline-2 focus-visible:outline-[#0071e3]"
        >
          <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
          {expanded ? 'Show fewer items' : `Show ${hidden} more item${hidden === 1 ? '' : 's'}`}
        </button>
      )}

      {/* Payment breakdown */}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5 text-xs">
        <div>
          <dt className="text-[#6e6e73] dark:text-gray-400">Items</dt>
          <dd className="font-semibold text-[#1d1d1f] dark:text-gray-100 tabular-nums">{unitCount} unit{unitCount === 1 ? '' : 's'}</dd>
        </div>
        <div>
          <dt className="text-[#6e6e73] dark:text-gray-400">Discount</dt>
          <dd className="font-semibold text-[#1d1d1f] dark:text-gray-100 tabular-nums">{discount > 0 ? money(discount) : '—'}</dd>
        </div>
        <div>
          <dt className="text-[#6e6e73] dark:text-gray-400">Paid</dt>
          <dd className="font-semibold text-[#248a3d] tabular-nums">{paid != null ? money(paid) : money(net)}</dd>
        </div>
        <div>
          <dt className="text-[#6e6e73] dark:text-gray-400">Due</dt>
          <dd className={`font-semibold tabular-nums ${due > 0 ? 'text-[#c93400]' : 'text-[#1d1d1f] dark:text-gray-100'}`}>{due > 0 ? money(due) : '—'}</dd>
        </div>
        <div className="col-span-2 sm:col-span-4">
          <dt className="sr-only">Payment</dt>
          <dd className="text-[#6e6e73] dark:text-gray-400 break-words">
            Paid by {paymentLabel(sale)}
            {sale.transaction_ref ? ` · Ref ${sale.transaction_ref}` : ''}
            {sale.created_by ? ` · Cashier ${sale.created_by}` : ''}
          </dd>
        </div>
      </dl>
    </li>
  )
}

export default function RecentSalesFeed({ sales = [], todayOrdersCount = 0 }) {
  return (
    <section
      aria-labelledby="recent-sales-heading"
      className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl p-5 sm:p-6 rounded-[24px] border border-black/[0.05] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)]"
    >
      <div className="flex justify-between items-center gap-3 mb-4">
        <div>
          <h3 id="recent-sales-heading" className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] text-[15px] flex items-center gap-1.5">
            <Clock size={16} className="text-[#0071e3]" aria-hidden="true" />
            <span>Recent checkout activity</span>
          </h3>
          <p className="text-[#6e6e73] text-xs">Latest completed sales with products, IMEIs and payment</p>
        </div>
        <Link to="/sales" className="text-xs text-[#0071e3] font-semibold hover:underline flex items-center gap-0.5 shrink-0">
          <span>All orders</span>
          <ChevronRight size={13} aria-hidden="true" />
        </Link>
      </div>

      {sales.length > 0 ? (
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {sales.map(s => <SaleCard key={s.id} sale={s} />)}
        </ul>
      ) : (
        <div className="py-9 text-center text-[#6e6e73] text-xs italic bg-[#f5f5f7] dark:bg-white/[0.03] rounded-[18px]">
          No recent sales recorded yet.
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-black/[0.04] dark:border-white/[0.06] flex justify-between items-center text-xs">
        <span className="text-[#6e6e73] font-medium">Total orders today</span>
        <span className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">{todayOrdersCount} invoices</span>
      </div>
    </section>
  )
}
