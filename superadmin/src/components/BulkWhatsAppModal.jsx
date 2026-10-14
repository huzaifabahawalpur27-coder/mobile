import { useState, useMemo } from 'react'
import { buildWhatsAppUrl, formatRenewalMessage } from '../utils/whatsappTemplates'
import {
  X, MessageSquare, Check, ExternalLink, Filter,
  Building, Calendar, CreditCard, ChevronRight, AlertCircle, CheckCircle2
} from 'lucide-react'

export default function BulkWhatsAppModal({ shops = [], onClose }) {
  const [filterMode, setFilterMode] = useState('expiring_7') // 'all_needing', 'expiring_3', 'expiring_7', 'overdue'
  const [sentShopIds, setSentShopIds] = useState(new Set())
  const [bankDetails, setBankDetails] = useState(() => 
    localStorage.getItem('superadmin_bank_details') || 
    'Bank: Meezan Bank / HBL\nJazzCash / EasyPaisa: 0300-1234567\nAccount Title: EdgeX POS'
  )

  const handleBankDetailsChange = (val) => {
    setBankDetails(val)
    localStorage.setItem('superadmin_bank_details', val)
  }

  // Calculate days remaining and categories for each shop
  const categorizedShops = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    return shops.map(shop => {
      if (!shop.next_billing_date) {
        return { ...shop, daysLeft: null, category: 'no_date' }
      }
      const due = new Date(shop.next_billing_date)
      due.setHours(0, 0, 0, 0)
      const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24))

      let category = 'normal'
      if (diffDays < 0) category = 'overdue'
      else if (diffDays <= 3) category = 'expiring_3'
      else if (diffDays <= 7) category = 'expiring_7'
      else if (diffDays <= 15) category = 'expiring_15'

      return {
        ...shop,
        daysLeft: diffDays,
        category
      }
    })
  }, [shops])

  const filteredShops = useMemo(() => {
    return categorizedShops.filter(shop => {
      if (!shop.phone) return false // WhatsApp requires a phone
      if (filterMode === 'all_needing') return shop.category === 'overdue' || shop.category === 'expiring_3' || shop.category === 'expiring_7' || shop.category === 'expiring_15'
      if (filterMode === 'overdue') return shop.category === 'overdue'
      if (filterMode === 'expiring_3') return shop.category === 'expiring_3'
      if (filterMode === 'expiring_7') return shop.category === 'expiring_3' || shop.category === 'expiring_7'
      return true
    })
  }, [categorizedShops, filterMode])

  const pendingShops = useMemo(() => {
    return filteredShops.filter(s => !sentShopIds.has(s.id))
  }, [filteredShops, sentShopIds])

  const sendShopWhatsApp = (shop) => {
    const isOverdue = shop.daysLeft !== null && shop.daysLeft < 0
    const msg = formatRenewalMessage({
      shopName: shop.name,
      planName: shop.subscription_plans?.name || shop.subscription_plan || 'Standard',
      expiryDate: shop.next_billing_date,
      amount: shop.subscription_fee || 0,
      bankDetails: bankDetails,
      isOverdue
    })

    const url = buildWhatsAppUrl(shop.phone, msg)
    window.open(url, '_blank')

    setSentShopIds(prev => new Set(prev).add(shop.id))
  }

  const sendNextInQueue = () => {
    if (pendingShops.length > 0) {
      sendShopWhatsApp(pendingShops[0])
    }
  }

  const sentCount = filteredShops.filter(s => sentShopIds.has(s.id)).length
  const totalCount = filteredShops.length

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 z-50 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden border border-slate-200 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-inner shrink-0">
              <MessageSquare size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                <span>Bulk WhatsApp Renewal Reminders</span>
                <span className="text-xs bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                  {totalCount} Shops
                </span>
              </h3>
              <p className="text-xs text-slate-500">Fast 1-click renewal alerts with pre-calculated fees & bank details</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Filters and Controls */}
        <div className="p-4 bg-slate-50/50 border-b border-slate-100 space-y-3 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: 'expiring_7', label: 'Expiring in 7 Days' },
                { id: 'expiring_3', label: 'Expiring in 3 Days' },
                { id: 'overdue', label: 'Overdue / Expired' },
                { id: 'all_needing', label: 'All Expiring (<=15d)' }
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setFilterMode(f.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                    filterMode === f.id
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {pendingShops.length > 0 && (
              <button
                onClick={sendNextInQueue}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/20 transition"
              >
                <span>Send Next ({pendingShops.length} left)</span>
                <ChevronRight size={14} />
              </button>
            )}
          </div>

          {/* Progress Bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-slate-200 h-2 rounded-full overflow-hidden">
              <div
                className="bg-emerald-500 h-full transition-all duration-300"
                style={{ width: `${totalCount > 0 ? (sentCount / totalCount) * 100 : 0}%` }}
              />
            </div>
            <span className="text-xs font-mono font-bold text-slate-600 shrink-0">
              {sentCount} / {totalCount} sent
            </span>
          </div>

          {/* Payment Account Details Accordion */}
          <details className="group">
            <summary className="text-[11px] font-bold text-blue-600 hover:text-blue-800 cursor-pointer list-none flex items-center gap-1 select-none">
              <span>⚙️ Edit Payment / Bank Accounts included in messages</span>
              <span className="group-open:rotate-180 transition-transform">▾</span>
            </summary>
            <div className="mt-2 pt-2 border-t border-slate-200">
              <textarea
                rows={3}
                value={bankDetails}
                onChange={(e) => handleBankDetailsChange(e.target.value)}
                placeholder="Enter bank accounts / JazzCash / EasyPaisa..."
                className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-mono focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <p className="text-[10px] text-slate-400">Saved in browser storage for future broadcasts.</p>
            </div>
          </details>
        </div>

        {/* Shop List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 divide-y divide-slate-100">
          {filteredShops.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              <AlertCircle size={28} className="mx-auto mb-2 text-slate-300" />
              <span>No shops match this filter with valid phone numbers.</span>
            </div>
          ) : (
            filteredShops.map(shop => {
              const isSent = sentShopIds.has(shop.id)
              const isOverdue = shop.daysLeft !== null && shop.daysLeft < 0

              return (
                <div
                  key={shop.id}
                  className={`pt-2.5 first:pt-0 flex items-center justify-between gap-3 p-3 rounded-xl transition ${
                    isSent ? 'bg-slate-50 opacity-70' : 'bg-white hover:bg-slate-50/80 border border-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                        isSent
                          ? 'bg-emerald-100 text-emerald-700'
                          : isOverdue
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {isSent ? <Check size={16} /> : isOverdue ? '!' : `${shop.daysLeft}d`}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-slate-800 text-xs truncate">{shop.name}</h4>
                        <span className="text-[10px] text-slate-500 font-mono">({shop.phone})</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                        <span className="font-semibold text-slate-700">
                          {shop.subscription_plans?.name || shop.subscription_plan || 'Standard'}
                        </span>
                        <span>•</span>
                        <span>Rs. {Number(shop.subscription_fee || 0).toLocaleString()}</span>
                        <span>•</span>
                        <span className={`font-bold ${isOverdue ? 'text-red-600' : 'text-amber-600'}`}>
                          {isOverdue ? `Expired ${Math.abs(shop.daysLeft)}d ago` : `Due in ${shop.daysLeft}d`}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => sendShopWhatsApp(shop)}
                      className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition ${
                        isSent
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/20'
                      }`}
                    >
                      {isSent ? (
                        <>
                          <CheckCircle2 size={13} className="text-emerald-600" />
                          <span>Sent (Resend)</span>
                        </>
                      ) : (
                        <>
                          <MessageSquare size={13} />
                          <span>WhatsApp</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
          <p className="text-[11px] text-slate-500">
            Clicking opens WhatsApp Web or App with pre-filled message.
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl text-xs transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
