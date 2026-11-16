import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, ChevronRight, ChevronDown, Smartphone, Package, User, Receipt } from 'lucide-react'

// Latest completed sales for the Dashboard: one compact row each (customer, time,
// total, payment); tapping a row shows every product line (name, IMEI for phones, quantity x price, returns) and the
// payment breakdown (method, discount, paid, due).

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

function SaleRow({ sale }) {
  const [open, setOpen] = useState(false)
  const items = (sale.sale_items || []).map(describeItem)
  const detailsId = `sale-details-${sale.id}`

  const gross = Number(sale.total_amount || 0)
  const discount = Number(sale.discount || 0)
  const net = Number(sale.net_amount ?? (gross - discount))
  const paid = sale.paid_amount != null ? Math.min(Number(sale.paid_amount), net) : null
  const due = paid != null ? Math.max(0, net - paid) : 0
  const type = String(sale.payment_type || sale.payment_method || 'cash').toLowerCase()
  const unitCount = items.reduce((sum, i) => sum + i.qty, 0)

  const when = sale.created_at ? new Date(sale.created_at) : null
  const isToday = when && when.toDateString() === new Date().toDateString()
  const clock = when ? when.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }) : ''
  const timeStr = when ? (isToday ? clock : `${when.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}, ${clock}`) : ''
  const invoice = sale.invoice_number || (sale.invoice_token ? `INV-${sale.invoice_token}` : `#${sale.id}`)
  const customer = sale.customer_name || sale.customers?.name || 'Walk-in customer'
  const phone = sale.customer_phone || sale.customers?.phone || ''

  return (
    <li className="py-1">
      {/* Basic details: the whole row opens the details */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={detailsId}
        className="w-full text-left py-2 px-2 rounded-[14px] flex items-center justify-between gap-3 hover:bg-[#f5f5f7]/60 dark:hover:bg-white/[0.03] transition focus-visible:outline-2 focus-visible:outline-[#0071e3]"
      >
        <span className="flex items-center gap-3 min-w-0">
          <span className="w-9 h-9 rounded-full bg-[#f5f5f7] dark:bg-white/10 text-[#0071e3] font-bold text-xs flex items-center justify-center shrink-0 tabular-nums">
            #{sale.id}
          </span>
          <span className="min-w-0">
            <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] text-xs sm:text-sm block truncate">{customer}</span>
            <span className="text-xs text-[#6e6e73] dark:text-gray-400 block truncate tabular-nums">
              {timeStr}{items.length > 0 ? ` · ${unitCount} item${unitCount === 1 ? '' : 's'}` : ''}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span className="text-right">
            <span className="font-bold text-xs sm:text-sm text-[#1d1d1f] dark:text-[#f5f5f7] block tabular-nums">{money(net)}</span>
            <span className={`text-xs font-semibold capitalize px-2 py-0.5 rounded-full inline-block ${badgeClass(type)}`}>{type}</span>
          </span>
          <ChevronDown size={16} className={`text-[#6e6e73] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          <span className="sr-only">{open ? 'Hide details' : 'Show details'}</span>
        </span>
      </button>

      {/* Details */}
      {open && (
        <div id={detailsId} className="mt-1 mx-2 mb-2 rounded-[16px] border border-black/[0.06] dark:border-white/[0.08] bg-[#fbfbfd] dark:bg-white/[0.02] p-3 flex flex-col gap-3">
          <p className="text-xs text-[#6e6e73] dark:text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5">
            <span className="inline-flex items-center gap-1"><Receipt size={12} aria-hidden="true" />{invoice}</span>
            {phone && <span className="inline-flex items-center gap-1 tabular-nums"><User size={12} aria-hidden="true" />{phone}</span>}
            {when && <span className="tabular-nums">{when.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}, {clock}</span>}
          </p>

          {items.length > 0 ? (
            <ul className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
              {items.map(it => (
                <li key={it.key} className="py-2 first:pt-0 flex items-start justify-between gap-3 text-xs">
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
                      {it.returned > 0 && <p className="text-[#c93400] font-semibold">{it.returned} returned</p>}
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

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs pt-2 border-t border-black/[0.05] dark:border-white/[0.06]">
            <div className="flex justify-between gap-2">
              <dt className="text-[#6e6e73] dark:text-gray-400">Subtotal</dt>
              <dd className="font-semibold text-[#1d1d1f] dark:text-gray-100 tabular-nums">{money(gross)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[#6e6e73] dark:text-gray-400">Discount</dt>
              <dd className="font-semibold text-[#1d1d1f] dark:text-gray-100 tabular-nums">{discount > 0 ? money(discount) : '—'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[#6e6e73] dark:text-gray-400">Paid</dt>
              <dd className="font-semibold text-[#248a3d] tabular-nums">{paid != null ? money(paid) : money(net)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[#6e6e73] dark:text-gray-400">Due</dt>
              <dd className={`font-semibold tabular-nums ${due > 0 ? 'text-[#c93400]' : 'text-[#1d1d1f] dark:text-gray-100'}`}>{due > 0 ? money(due) : '—'}</dd>
            </div>
            <div className="col-span-2">
              <dt className="sr-only">Payment</dt>
              <dd className="text-[#6e6e73] dark:text-gray-400 break-words">
                Paid by {paymentLabel(sale)}
                {sale.transaction_ref ? ` · Ref ${sale.transaction_ref}` : ''}
                {sale.created_by ? ` · Cashier ${sale.created_by}` : ''}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </li>
  )
}

export default function RecentSalesFeed({ sales = [], todayOrdersCount = 0 }) {
  return (
    <section
      aria-labelledby="recent-sales-heading"
      className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl p-5 sm:p-6 rounded-[24px] flex flex-col justify-between border border-black/[0.05] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)]"
    >
      <div className="flex justify-between items-center gap-3 mb-4">
        <div>
          <h3 id="recent-sales-heading" className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] text-[15px] flex items-center gap-1.5">
            <Clock size={16} className="text-[#0071e3]" aria-hidden="true" />
            <span>Recent checkout activity</span>
          </h3>
          <p className="text-[#6e6e73] text-xs">Most recent completed sales. Tap one for its items.</p>
        </div>
        <Link to="/sales" className="text-xs text-[#0071e3] font-semibold hover:underline flex items-center gap-0.5 shrink-0">
          <span>All orders</span>
          <ChevronRight size={13} aria-hidden="true" />
        </Link>
      </div>

      {sales.length > 0 ? (
        <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
          {sales.map(s => <SaleRow key={s.id} sale={s} />)}
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
