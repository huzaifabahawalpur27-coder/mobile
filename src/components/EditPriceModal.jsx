import { useState, useEffect } from 'react'
import { X, DollarSign, TrendingUp, AlertCircle, CheckCircle2, Smartphone, Package, Copy, Check } from 'lucide-react'
import { supabase } from '../services/supabase'
import { db, addToSyncQueue } from '../services/db'

export default function EditPriceModal({
  isOpen,
  onClose,
  item,
  onSuccess,
  userRole = 'admin'
}) {
  const [salePrice, setSalePrice] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [additionalCosts, setAdditionalCosts] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [copiedImei, setCopiedImei] = useState(false)

  // Permission: Owner, Admin, Manager, Superadmin can view and edit cost prices
  const canViewCost = ['owner', 'admin', 'manager', 'superadmin'].includes(userRole)

  const isPhone = Boolean(
    item?.item_type === 'phone' ||
    item?.imei_1 ||
    (item?.brand && item?.model && (item?.storage || item?.pta_status || item?.color))
  )

  useEffect(() => {
    if (item) {
      const sPrice = item.sale_price ?? item.selling_price ?? item.expected_sale_price ?? ''
      const cPrice = item.cost_price ?? ''
      const addCosts = item.additional_costs ?? 0

      setSalePrice(sPrice !== '' && sPrice !== null && sPrice !== undefined ? String(sPrice) : '')
      setCostPrice(cPrice !== '' && cPrice !== null && cPrice !== undefined ? String(cPrice) : '')
      setAdditionalCosts(addCosts ? String(addCosts) : '0')
      setNotes('')
      setErrorMsg('')
    }
  }, [item])

  if (!isOpen || !item) return null

  // Financial calculations
  const parsedSale = parseFloat(salePrice) || 0
  const parsedCost = parseFloat(costPrice) || 0
  const parsedAddCosts = isPhone ? (parseFloat(additionalCosts) || 0) : 0
  const totalCost = parsedCost + parsedAddCosts
  const profit = parsedSale - totalCost
  const marginPercent = parsedSale > 0 ? (profit / parsedSale) * 100 : 0

  const handleCopyImei = () => {
    if (item.imei_1) {
      navigator.clipboard.writeText(item.imei_1)
      setCopiedImei(true)
      setTimeout(() => setCopiedImei(false), 2000)
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setErrorMsg('')

    if (parsedSale < 0) {
      setErrorMsg('Sale price cannot be negative.')
      return
    }
    if (canViewCost && parsedCost < 0) {
      setErrorMsg('Cost price cannot be negative.')
      return
    }

    setSaving(true)

    try {
      const isOnline = navigator.onLine

      if (isPhone) {
        // === UPDATE MOBILE PHONE ===
        const phoneUpdates = {
          sale_price: parsedSale,
          selling_price: parsedSale,
          expected_sale_price: parsedSale,
          updated_at: new Date().toISOString()
        }
        if (canViewCost) {
          phoneUpdates.cost_price = parsedCost
          phoneUpdates.additional_costs = parsedAddCosts
        }

        let updatedPhoneRecord = { ...item, ...phoneUpdates }

        // 1. Supabase Cloud Update
        if (isOnline) {
          const { data, error } = await supabase
            .from('phones')
            .update(phoneUpdates)
            .eq('id', item.id)
            .select()

          if (error) {
            console.warn('Supabase phone price update error:', error)
            // If online update fails, we will still fallback to local + queue
            throw error
          }
          if (data && data[0]) {
            updatedPhoneRecord = { ...updatedPhoneRecord, ...data[0] }
          }

          // Optional: Record Price Update in phone_history for audit trail
          try {
            await supabase.from('phone_history').insert([{
              phone_id: item.id,
              shop_id: item.shop_id,
              action: 'PRICE_UPDATE',
              previous_status: item.status || 'in_stock',
              new_status: item.status || 'in_stock',
              details: {
                old_sale_price: item.sale_price ?? item.selling_price,
                new_sale_price: parsedSale,
                old_cost_price: item.cost_price,
                new_cost_price: parsedCost,
                additional_costs: parsedAddCosts,
                reason: notes.trim() || 'Price adjusted via Inventory / Products'
              }
            }])
          } catch (_) {
            // Non-critical audit log failure ignored
          }
        }

        // 2. Local Dexie Update
        if (db.phones) {
          await db.phones.update(item.id, phoneUpdates).catch(async () => {
            // If primary key type mismatch (e.g. number vs string), try Number(item.id)
            await db.phones.update(Number(item.id), phoneUpdates).catch(() => {})
          })
        }

        // 3. Offline Sync Queue
        if (!isOnline) {
          await addToSyncQueue('phones', 'UPDATE', { id: item.id, ...phoneUpdates })
        }

        if (onSuccess) onSuccess(updatedPhoneRecord)
        onClose()
      } else {
        // === UPDATE REGULAR PRODUCT / ACCESSORY ===
        const productUpdates = {
          sale_price: parsedSale,
          updated_at: new Date().toISOString()
        }
        if (canViewCost) {
          productUpdates.cost_price = parsedCost
        }

        let updatedProdRecord = { ...item, ...productUpdates }

        if (isOnline) {
          const { data, error } = await supabase
            .from('products')
            .update(productUpdates)
            .eq('id', item.id)
            .select()

          if (error) throw error
          if (data && data[0]) {
            updatedProdRecord = { ...updatedProdRecord, ...data[0] }
          }
        }

        if (db.products) {
          await db.products.update(item.id, productUpdates).catch(async () => {
            await db.products.update(Number(item.id), productUpdates).catch(() => {})
          })
        }

        if (!isOnline) {
          await addToSyncQueue('products', 'UPDATE', { id: item.id, ...productUpdates })
        }

        if (onSuccess) onSuccess(updatedProdRecord)
        onClose()
      }
    } catch (err) {
      console.error('Error updating price:', err)
      const errMsg = err?.message || String(err)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        // Resilient offline fallback
        const updates = {
          sale_price: parsedSale,
          updated_at: new Date().toISOString()
        }
        if (canViewCost) updates.cost_price = parsedCost
        if (isPhone && canViewCost) updates.additional_costs = parsedAddCosts

        const table = isPhone ? 'phones' : 'products'
        if (db[table]) {
          await db[table].update(item.id, updates).catch(() => {})
        }
        await addToSyncQueue(table, 'UPDATE', { id: item.id, ...updates })

        if (onSuccess) onSuccess({ ...item, ...updates })
        onClose()
        alert('Offline mode: Price updated locally and queued for cloud sync! 🔄')
      } else {
        setErrorMsg('Failed to update price: ' + errMsg)
      }
    } finally {
      setSaving(false)
    }
  }

  const phoneTitle = `${item.brand || ''} ${item.model || ''}`.trim() || item.name || 'Mobile Phone'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-800 flex flex-col max-h-[92dvh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/70 dark:bg-gray-800/50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black shrink-0 ${
              isPhone
                ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
            }`}>
              {isPhone ? <Smartphone size={20} /> : <DollarSign size={20} />}
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-black text-gray-900 dark:text-gray-100 truncate">
                {isPhone ? 'Edit Mobile Phone Price' : 'Edit Product Price'}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {isPhone ? phoneTitle : (item.name || 'Catalog Item')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition cursor-pointer"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-4 flex-1 min-h-0 text-sm">
          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl text-red-700 dark:text-red-300 text-xs flex items-center gap-2 font-medium">
              <AlertCircle size={15} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Device / Product Snapshot Badge Card */}
          <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-[10px]">
                {isPhone ? 'Phone Specification' : 'Item SKU / Reference'}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                item.status === 'in_stock' || item.status === 'active'
                  ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                  : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
              }`}>
                {item.status || 'Active'}
              </span>
            </div>

            <div className="text-sm font-black text-gray-900 dark:text-gray-100 flex items-center justify-between">
              <span>{isPhone ? `${phoneTitle} ${item.storage ? `(${item.storage})` : ''}` : item.name}</span>
              {item.color && (
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 capitalize">
                  {item.color}
                </span>
              )}
            </div>

            {isPhone && item.imei_1 && (
              <div className="flex items-center justify-between pt-1 border-t border-gray-200/60 dark:border-gray-700/60 text-xs">
                <span className="text-gray-500 font-medium">IMEI-1:</span>
                <button
                  type="button"
                  onClick={handleCopyImei}
                  className="font-mono font-bold text-gray-800 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1 cursor-pointer transition"
                  title="Click to copy IMEI"
                >
                  <span>{item.imei_1}</span>
                  {copiedImei ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} className="text-gray-400" />}
                </button>
              </div>
            )}

            {isPhone && (item.pta_status || item.condition) && (
              <div className="flex items-center gap-2 pt-1 text-[11px] font-bold">
                {item.pta_status && (
                  <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 rounded-md uppercase">
                    PTA: {item.pta_status}
                  </span>
                )}
                {item.condition && (
                  <span className="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md uppercase">
                    {item.condition}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Pricing Inputs */}
          <div className="space-y-3">
            {/* Sale / Selling Price */}
            <div>
              <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                <span>Sale / Selling Price *</span>
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold normal-case">
                  What customer pays
                </span>
              </label>
              <div className="relative rounded-xl shadow-xs">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-500 dark:text-gray-400 font-black text-sm">
                  Rs.
                </span>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                  placeholder="0"
                  required
                  className="w-full pl-12 pr-4 py-2.5 bg-white dark:bg-gray-800 border-2 border-emerald-500/40 focus:border-emerald-500 rounded-xl text-base font-black text-gray-900 dark:text-gray-100 outline-none transition"
                />
              </div>
            </div>

            {/* Cost / Purchase Price (If authorized) */}
            {canViewCost && (
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                  <span>Purchase / Cost Price *</span>
                  <span className="text-[11px] text-gray-400 font-semibold normal-case">
                    Initial purchase cost
                  </span>
                </label>
                <div className="relative rounded-xl shadow-xs">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-500 dark:text-gray-400 font-black text-sm">
                    Rs.
                  </span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    placeholder="0"
                    className="w-full pl-12 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 focus:border-blue-500 rounded-xl text-base font-bold text-gray-900 dark:text-gray-100 outline-none transition"
                  />
                </div>
              </div>
            )}

            {/* Additional Costs (For phones only, if authorized) */}
            {isPhone && canViewCost && (
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                  <span>Additional Costs (Optional)</span>
                  <span className="text-[11px] text-gray-400 font-semibold normal-case">
                    Repair / Tax / Parts
                  </span>
                </label>
                <div className="relative rounded-xl shadow-xs">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-500 dark:text-gray-400 font-black text-sm">
                    Rs.
                  </span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={additionalCosts}
                    onChange={(e) => setAdditionalCosts(e.target.value)}
                    placeholder="0"
                    className="w-full pl-12 pr-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 focus:border-blue-500 rounded-xl text-sm font-semibold text-gray-900 dark:text-gray-100 outline-none transition"
                  />
                </div>
              </div>
            )}

            {/* Live Profit Margin Widget */}
            {canViewCost && (
              <div className={`p-3 rounded-xl border flex items-center justify-between transition ${
                profit > 0
                  ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-300'
                  : profit < 0
                    ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/50 text-rose-800 dark:text-rose-300'
                    : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
              }`}>
                <div className="flex items-center gap-2">
                  <TrendingUp size={16} />
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider">
                      {profit > 0 ? 'Projected Profit' : profit < 0 ? 'Projected Loss' : 'Break-even'}
                    </p>
                    <p className="text-base font-black">
                      {profit >= 0 ? `+Rs. ${profit.toLocaleString()}` : `-Rs. ${Math.abs(profit).toLocaleString()}`}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Margin</p>
                  <p className="text-sm font-black">
                    {parsedSale > 0 ? `${marginPercent.toFixed(1)}%` : '0%'}
                  </p>
                </div>
              </div>
            )}

            {/* Note / Adjustment Reason */}
            <div>
              <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 mb-1">
                Reason / Note (Optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Market price adjustment, battery health, offer discount"
                className="w-full px-3.5 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-800 dark:text-gray-200 outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold text-xs transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-md hover:shadow-lg transition cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={15} />
                  <span>Update Price</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
