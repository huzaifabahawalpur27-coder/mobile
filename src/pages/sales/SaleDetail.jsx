import { useState } from 'react'
import { AlertTriangle, Printer, Undo2, ShoppingCart, MoreHorizontal, Trash2 } from 'lucide-react'
import { Modal, Button } from '../../components/ui'
import { rs, pct } from '../reports/format'
import { COST_SOURCE } from '../../utils/profit.js'
import { lineProfits, saleFigures, invoiceLabel, paymentLabel, customerName, isQuotation } from './saleItems'

export default function SaleDetail({
  sale, items, loading, returnQtys, setReturnQtys, refundType, setRefundType, returning,
  onReturn, onPrint, onConvert, onDelete, onClose
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const quotation = isQuotation(sale)
  const lines = lineProfits(sale, items)
  const fig = saleFigures({ ...sale, sale_items: items })
  const gross = lines.reduce((s, l) => s + l.gross, 0)
  const extras = lines.reduce((s, l) => s + l.qty * l.extras, 0)
  const anyReturnable = !quotation && lines.some(l => l.qty > 0)

  const footer = (
    <div className="w-full flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
      <div className="relative">
        <Button variant="ghost" size="sm" aria-expanded={moreOpen} aria-haspopup="menu" onClick={() => setMoreOpen(v => !v)}>
          <MoreHorizontal size={16} aria-hidden="true" /> More
        </Button>
        {moreOpen && (
          <div role="menu" className="absolute bottom-full left-0 mb-1 min-w-[200px] rounded-xl border border-black/[0.08] dark:border-white/[0.12] bg-white dark:bg-[#2c2c2e] shadow-lg p-1 z-10">
            <button role="menuitem" type="button" onClick={() => { setMoreOpen(false); onDelete() }}
              className="w-full min-h-[40px] px-3 rounded-lg flex items-center gap-2 text-sm font-semibold text-[#d70015] dark:text-[#ff6b6b] hover:bg-[#ff3b30]/10">
              <Trash2 size={15} aria-hidden="true" /> Delete {quotation ? 'quotation' : 'sale'}…
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button variant="secondary" onClick={onPrint} disabled={loading}>
          <Printer size={15} aria-hidden="true" /> Print {quotation ? 'quotation' : 'invoice'}
        </Button>
        {quotation ? (
          <Button variant="primary" onClick={onConvert}><ShoppingCart size={15} aria-hidden="true" /> Convert to sale</Button>
        ) : anyReturnable && (
          <Button variant="danger" onClick={onReturn} loading={returning} disabled={loading}>
            <Undo2 size={15} aria-hidden="true" /> {returning ? 'Saving return…' : 'Return items'}
          </Button>
        )}
      </div>
    </div>
  )

  return (
    <Modal open onClose={onClose} size="xl" title={`${quotation ? 'Quotation' : 'Invoice'} ${invoiceLabel(sale)}`} footer={footer}>
      <p className="text-sm text-[#5f6368] dark:text-gray-400 -mt-1 mb-4">
        {new Date(sale.created_at).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })} · <b className="text-[#1d1d1f] dark:text-gray-100">{customerName(sale)}</b> · {paymentLabel(sale)}
        {sale.transaction_ref ? ` · Ref ${sale.transaction_ref}` : ''}
      </p>

      {loading ? (
        <p className="py-10 text-center text-sm text-[#5f6368]">Loading items…</p>
      ) : (
        <>
          <ul className="space-y-2">
            {lines.map(l => {
              const it = l.item
              const returned = Number(it.returned_qty || 0)
              const fully = l.qty <= 0
              const inputId = `ret-${it.id}`
              return (
                <li key={it.id} className={`rounded-2xl border px-3.5 py-3 text-xs ${fully ? 'border-black/[0.06] bg-black/[0.02] dark:bg-white/[0.02] opacity-70' : 'border-black/[0.08] dark:border-white/[0.1]'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] break-words">
                        {it.display_name}
                        {fully && <span className="ml-2 align-middle text-xs font-semibold text-[#d70015] dark:text-[#ff6b6b]">Returned</span>}
                      </p>
                      {it.specs && <p className="text-[#5f6368] dark:text-gray-400">{it.specs}</p>}
                      {(it.imei || it.imei2) && <p className="text-[#5f6368] dark:text-gray-400 tabular-nums break-all">IMEI {[it.imei, it.imei2].filter(Boolean).join(' / ')}</p>}
                    </div>
                    {!quotation && !fully && (
                      <p className={`shrink-0 text-right text-sm font-bold tabular-nums ${l.profit < 0 ? 'text-[#d70015] dark:text-[#ff6b6b]' : 'text-[#248a3d] dark:text-[#34d399]'}`}>
                        {rs(l.profit)}
                        <span className="block text-xs font-normal text-[#5f6368] dark:text-gray-400">profit · {pct(l.profit, l.revenue)}</span>
                      </p>
                    )}
                  </div>

                  <dl className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-1">
                    <div><dt className="text-[#5f6368] dark:text-gray-400">Sale price</dt><dd className="font-semibold tabular-nums">{it.quantity > 1 ? `${it.quantity} × ` : ''}{rs(it.unit_price)}</dd></div>
                    <div><dt className="text-[#5f6368] dark:text-gray-400">Discount share</dt><dd className="tabular-nums">{l.discount > 0 ? rs(l.discount) : '—'}</dd></div>
                    {!quotation && <div><dt className="text-[#5f6368] dark:text-gray-400">Purchase cost</dt><dd className="tabular-nums">{rs(it.base_cost)}</dd></div>}
                    {!quotation && <div><dt className="text-[#5f6368] dark:text-gray-400">Extra cost</dt><dd className="tabular-nums">{Number(it.direct_cost) > 0 ? rs(it.direct_cost) : '—'}</dd></div>}
                    <div><dt className="text-[#5f6368] dark:text-gray-400">Kept</dt><dd className="tabular-nums">{l.qty}{returned > 0 ? ` (${returned} returned)` : ''}</dd></div>
                  </dl>

                  {!quotation && (
                    <p className="mt-1.5 text-[#5f6368] dark:text-gray-400">Cost from: {COST_SOURCE[it.cost_source] || 'Unknown'}</p>
                  )}
                  {!quotation && l.issue && (
                    <p className={`mt-0.5 flex items-center gap-1 font-semibold ${l.issue.level === 'problem' ? 'text-[#d70015] dark:text-[#ff6b6b]' : 'text-[#a15c00] dark:text-[#fbbf24]'}`}>
                      <AlertTriangle size={12} aria-hidden="true" /> {l.issue.text}
                    </p>
                  )}

                  {!quotation && !fully && (
                    <div className="mt-2 flex items-center gap-2">
                      <label htmlFor={inputId} className="text-[#5f6368] dark:text-gray-400">Return</label>
                      <input
                        id={inputId}
                        type="number"
                        inputMode="numeric"
                        min="0"
                        max={l.qty}
                        value={returnQtys[it.id] || ''}
                        onChange={e => setReturnQtys(prev => ({ ...prev, [it.id]: e.target.value }))}
                        placeholder="0"
                        className="w-20 min-h-[40px] rounded-lg border border-black/[0.12] dark:border-white/[0.15] bg-white dark:bg-[#2c2c2e] px-2 text-center text-sm font-semibold"
                      />
                      <span className="text-[#5f6368] dark:text-gray-400">of {l.qty}</span>
                    </div>
                  )}
                </li>
              )
            })}
            {lines.length === 0 && <li className="py-6 text-center text-sm text-[#5f6368]">No items were saved with this {quotation ? 'quotation' : 'sale'}.</li>}
          </ul>

          {/* Totals */}
          <dl className="mt-4 rounded-2xl bg-[#f5f5f7] dark:bg-white/[0.04] p-3.5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
            <div><dt className="text-[#5f6368] dark:text-gray-400">Before discount</dt><dd className="font-semibold tabular-nums">{rs(gross)}</dd></div>
            <div><dt className="text-[#5f6368] dark:text-gray-400">Discount</dt><dd className="font-semibold tabular-nums">{Number(sale.discount) > 0 ? rs(sale.discount) : '—'}</dd></div>
            <div><dt className="text-[#5f6368] dark:text-gray-400">Total</dt><dd className="text-sm font-bold tabular-nums">{rs(fig.net)}</dd></div>
            {!quotation && <div><dt className="text-[#5f6368] dark:text-gray-400">Paid</dt><dd className="font-semibold tabular-nums">{rs(fig.paid)}{fig.due > 0 && <span className="block font-semibold text-[#a15c00] dark:text-[#fbbf24]">{rs(fig.due)} still due</span>}</dd></div>}
            {!quotation && <div><dt className="text-[#5f6368] dark:text-gray-400">Cost of items</dt><dd className="font-semibold tabular-nums">{rs(fig.cost)}{extras > 0 && <span className="block font-normal text-[#5f6368] dark:text-gray-400">incl. {rs(extras)} extra costs</span>}</dd></div>}
            {!quotation && <div><dt className="text-[#5f6368] dark:text-gray-400">Profit</dt><dd className={`text-sm font-bold tabular-nums ${fig.profit < 0 ? 'text-[#d70015] dark:text-[#ff6b6b]' : 'text-[#248a3d] dark:text-[#34d399]'}`}>{rs(fig.profit)} <span className="text-xs font-normal text-[#5f6368] dark:text-gray-400">({pct(fig.profit, fig.revenue)})</span></dd></div>}
          </dl>

          {anyReturnable && (
            <fieldset className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <legend className="sr-only">How to refund returned items</legend>
              <span className="text-xs font-semibold text-[#5f6368] dark:text-gray-400">Refund returns as</span>
              <label className="inline-flex items-center gap-1.5 min-h-[40px] cursor-pointer">
                <input type="radio" name="refund" checked={refundType === 'cash'} onChange={() => setRefundType('cash')} /> Cash back
              </label>
              {sale.customer_id && (
                <label className="inline-flex items-center gap-1.5 min-h-[40px] cursor-pointer">
                  <input type="radio" name="refund" checked={refundType === 'credit'} onChange={() => setRefundType('credit')} /> Off the customer's balance
                </label>
              )}
            </fieldset>
          )}
        </>
      )}
    </Modal>
  )
}
