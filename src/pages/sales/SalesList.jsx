import { AlertTriangle } from 'lucide-react'
import { rs, pct, timeOf } from '../reports/format'
import { invoiceLabel, paymentLabel, customerName, isQuotation } from './saleItems'

const when = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return `${today ? 'Today' : d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}, ${timeOf(iso)}`
}

function Items({ sale }) {
  const items = sale.sale_items || []
  if (!items.length) return <span className="text-[#6e6e73]">No items saved</span>
  return (
    <span>
      <span className="text-[#1d1d1f] dark:text-gray-100">{items[0].display_name}</span>
      {items.length > 1 && <span className="text-[#5f6368] dark:text-gray-400"> + {items.length - 1} more</span>}
    </span>
  )
}

function Profit({ fig, sale }) {
  if (isQuotation(sale)) return <span className="text-[#6e6e73]">Quotation</span>
  if (!fig.hasLines) return <span className="text-[#6e6e73]">—</span>
  return (
    <span className="inline-flex flex-col items-end">
      <span className={`font-semibold tabular-nums ${fig.profit < 0 ? 'text-[#d70015] dark:text-[#ff6b6b]' : 'text-[#248a3d] dark:text-[#34d399]'}`}>{rs(fig.profit)}</span>
      <span className="text-xs text-[#5f6368] dark:text-gray-400">{pct(fig.profit, fig.revenue)}</span>
      {fig.issues > 0 && (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#a15c00] dark:text-[#fbbf24]" title="Some items have a missing, guessed or too-high cost">
          <AlertTriangle size={11} aria-hidden="true" /> Check cost
        </span>
      )}
    </span>
  )
}

function Paid({ fig, sale }) {
  if (isQuotation(sale)) return null
  if (fig.due > 0) return <span className="text-xs font-semibold text-[#a15c00] dark:text-[#fbbf24]">{rs(fig.due)} due</span>
  return <span className="text-xs text-[#5f6368] dark:text-gray-400">Paid</span>
}

export default function SalesList({ rows, selecting, selected, onToggle, onToggleAll, onOpen }) {
  const allSelected = rows.length > 0 && rows.every(r => selected.includes(r.sale.id))
  return (
    <>
      {/* Wide screens: table */}
      <div className="hidden md:block bg-white dark:bg-[#1c1c1e] rounded-[20px] border border-black/[0.06] dark:border-white/[0.08] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Sales in this period, newest first</caption>
            <thead className="bg-[#f5f5f7]/80 dark:bg-[#2c2c2e]/80 text-xs text-[#5f6368] dark:text-gray-400 border-b border-black/[0.05] dark:border-white/[0.06]">
              <tr>
                {selecting && (
                  <th scope="col" className="pl-4 py-3 w-8">
                    <input type="checkbox" aria-label="Select all shown" checked={allSelected} onChange={onToggleAll} className="w-4 h-4" />
                  </th>
                )}
                <th scope="col" className="px-4 py-3 font-semibold">Invoice</th>
                <th scope="col" className="px-4 py-3 font-semibold">Customer and items</th>
                <th scope="col" className="px-4 py-3 font-semibold text-right">Total</th>
                <th scope="col" className="px-4 py-3 font-semibold text-right">Profit</th>
                <th scope="col" className="px-4 py-3 font-semibold">Payment</th>
                <th scope="col" className="px-4 py-3"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
              {rows.map(({ sale, fig }) => (
                <tr key={sale.id} className={`align-top ${selected.includes(sale.id) ? 'bg-[#0071e3]/[0.05]' : ''}`}>
                  {selecting && (
                    <td className="pl-4 py-3">
                      <input type="checkbox" aria-label={`Select ${invoiceLabel(sale)}`} checked={selected.includes(sale.id)} onChange={() => onToggle(sale.id)} className="w-4 h-4" />
                    </td>
                  )}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{invoiceLabel(sale)}</p>
                    <p className="text-xs text-[#5f6368] dark:text-gray-400">{when(sale.created_at)}</p>
                  </td>
                  <td className="px-4 py-3 min-w-[220px]">
                    <p className="font-medium text-[#1d1d1f] dark:text-gray-100">{customerName(sale)}</p>
                    <p className="text-xs"><Items sale={sale} /></p>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <p className="font-semibold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">{rs(fig.net)}</p>
                    <Paid fig={fig} sale={sale} />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap"><Profit fig={fig} sale={sale} /></td>
                  <td className="px-4 py-3 text-xs text-[#5f6368] dark:text-gray-400">{isQuotation(sale) ? 'Quotation' : paymentLabel(sale)}</td>
                  <td className="px-4 py-2 text-right">
                    <button type="button" onClick={() => onOpen(sale)}
                      className="min-h-[40px] px-3 rounded-lg text-sm font-semibold text-[#0071e3] dark:text-[#0a84ff] hover:bg-[#0071e3]/[0.08] focus-visible:outline-2 focus-visible:outline-[#0071e3]">
                      Open<span className="sr-only"> {invoiceLabel(sale)}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Phones: one card per sale; the whole card opens it */}
      <ul className="md:hidden space-y-2">
        {rows.map(({ sale, fig }) => (
          <li key={sale.id} className={`flex items-stretch gap-2 rounded-2xl border bg-white dark:bg-[#1c1c1e] ${selected.includes(sale.id) ? 'border-[#0071e3]/50' : 'border-black/[0.06] dark:border-white/[0.08]'}`}>
            {selecting && (
              <label className="flex items-center pl-3">
                <span className="sr-only">Select {invoiceLabel(sale)}</span>
                <input type="checkbox" checked={selected.includes(sale.id)} onChange={() => onToggle(sale.id)} className="w-5 h-5" />
              </label>
            )}
            <button type="button" onClick={() => onOpen(sale)} className="flex-1 min-w-0 text-left px-4 py-3 rounded-2xl focus-visible:outline-2 focus-visible:outline-[#0071e3]">
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{customerName(sale)}</span>
                  <span className="block text-xs text-[#5f6368] dark:text-gray-400">{invoiceLabel(sale)} · {when(sale.created_at)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-bold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">{rs(fig.net)}</span>
                  <Paid fig={fig} sale={sale} />
                </span>
              </span>
              <span className="mt-1.5 block text-xs truncate"><Items sale={sale} /></span>
              <span className="mt-1.5 flex items-center justify-between gap-3 text-xs">
                <span className="text-[#5f6368] dark:text-gray-400">{isQuotation(sale) ? 'Quotation' : paymentLabel(sale)}</span>
                {!isQuotation(sale) && fig.hasLines && (
                  <span className="text-right">
                    Profit <b className={`tabular-nums ${fig.profit < 0 ? 'text-[#d70015] dark:text-[#ff6b6b]' : 'text-[#248a3d] dark:text-[#34d399]'}`}>{rs(fig.profit)}</b>
                    {fig.issues > 0 && <span className="ml-1 font-semibold text-[#a15c00] dark:text-[#fbbf24]">· check cost</span>}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
