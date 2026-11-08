import React, { useState, useEffect } from 'react'
import {
  Boxes,
  X,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  RotateCcw,
  Plus,
  Trash2,
  Calendar,
  Layers,
  HelpCircle
} from 'lucide-react'
import {
  previewBatchConversion,
  convertProductToBatchTracking,
  revertBatchConversion
} from '../services/batchService'

export default function ProductConversionModal({
  isOpen,
  onClose,
  product,
  onSuccess,
  userShopId
}) {
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState(null)
  const [customCost, setCustomCost] = useState('')
  const [isSplitMode, setIsSplitMode] = useState(false)
  const [splitBatches, setSplitBatches] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [reverting, setReverting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => {
    if (!isOpen || !product?.id) return
    loadPreview()
  }, [isOpen, product?.id])

  const loadPreview = async () => {
    setLoading(true)
    setErrorMsg('')
    setSuccessMsg('')
    try {
      const res = await previewBatchConversion({ productId: product.id })
      if (res?.success && res.products?.length > 0) {
        const item = res.products[0]
        setPreview(item)
        const initCost = item.resolved_cost > 0 ? String(item.resolved_cost) : (product.cost_price ? String(product.cost_price) : '')
        setCustomCost(initCost)
        setSplitBatches([
          {
            qty: String(item.stock_quantity || product.stock_quantity || 1),
            cost: initCost,
            purchase_date: new Date().toISOString().slice(0, 10)
          }
        ])
      } else {
        setErrorMsg(res?.error || 'Unable to generate preview for product')
      }
    } catch (err) {
      setErrorMsg(err.message || 'Error running dry-run conversion preview')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen || !product) return null

  const isAlreadyBatchTracked = product.inventory_mode === 'batch_tracked'
  const isSerialized = product.inventory_mode === 'serialized'

  const currentStock = Number(preview?.stock_quantity ?? product.stock_quantity ?? 0)

  // Split calculation helper
  const totalSplitQty = splitBatches.reduce((sum, b) => sum + (parseFloat(b.qty) || 0), 0)
  const splitRemainingQty = currentStock - totalSplitQty

  const handleAddSplitLine = () => {
    const rem = Math.max(0, splitRemainingQty)
    setSplitBatches(prev => [
      ...prev,
      {
        qty: rem > 0 ? String(rem) : '',
        cost: customCost || '',
        purchase_date: new Date().toISOString().slice(0, 10)
      }
    ])
  }

  const handleRemoveSplitLine = (idx) => {
    if (splitBatches.length <= 1) return
    setSplitBatches(prev => prev.filter((_, i) => i !== idx))
  }

  const handleUpdateSplitLine = (idx, field, value) => {
    setSplitBatches(prev => {
      const copy = [...prev]
      copy[idx] = { ...copy[idx], [field]: value }
      return copy
    })
  }

  const handleApplyConversion = async () => {
    setSubmitting(true)
    setErrorMsg('')
    setSuccessMsg('')

    try {
      let payloadBatches = null

      if (isSplitMode && currentStock > 0) {
        if (splitRemainingQty !== 0) {
          throw new Error(`Total split batch quantity (${totalSplitQty}) must equal current stock (${currentStock}). Remaining: ${splitRemainingQty}`)
        }
        payloadBatches = splitBatches.map(b => ({
          qty: parseFloat(b.qty) || 0,
          cost: parseFloat(b.cost) || 0,
          purchase_date: b.purchase_date ? new Date(b.purchase_date).toISOString() : new Date().toISOString()
        }))
      }

      const res = await convertProductToBatchTracking({
        productId: product.id,
        customCost: !isSplitMode && customCost ? parseFloat(customCost) : null,
        customBatches: payloadBatches
      })

      if (!res.success) {
        throw new Error(res.error || 'Conversion failed')
      }

      setSuccessMsg(`Successfully converted "${product.name}" to FIFO batch tracking!`)
      if (onSuccess) onSuccess(res)
      setTimeout(() => {
        onClose()
      }, 1400)
    } catch (err) {
      setErrorMsg(err.message || 'Failed to convert product to FIFO tracking')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRevert = async () => {
    if (!window.confirm(`Are you sure you want to revert "${product.name}" back to standard non-batch mode? Opening balance batches will be safely removed.`)) {
      return
    }

    setReverting(true)
    setErrorMsg('')
    try {
      const res = await revertBatchConversion({ productId: product.id })
      if (!res.success) {
        throw new Error(res.error || 'Revert failed')
      }
      setSuccessMsg(`Product reverted to standard mode.`)
      if (onSuccess) onSuccess(res)
      setTimeout(() => {
        onClose()
      }, 1200)
    } catch (err) {
      setErrorMsg(err.message || 'Could not revert product mode')
    } finally {
      setReverting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[92dvh] animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-gray-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
              <Boxes size={20} />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-gray-900 dark:text-white">
                {isAlreadyBatchTracked ? 'FIFO Batch Tracking Active' : 'Convert to FIFO Batch Tracking'}
              </h2>
              <p className="text-[11px] text-gray-500 dark:text-slate-400">
                {product.name} {product.sku ? `• SKU: ${product.sku}` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded-xl border border-red-200 dark:border-red-900 flex items-start gap-2.5">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <div className="leading-relaxed">{errorMsg}</div>
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 rounded-xl border border-emerald-200 dark:border-emerald-800 flex items-center gap-2.5">
              <CheckCircle2 size={16} className="shrink-0" />
              <div className="font-bold">{successMsg}</div>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-gray-400 space-y-2">
              <div className="inline-block animate-spin rounded-full h-7 w-7 border-2 border-emerald-500 border-t-transparent"></div>
              <p className="text-xs font-semibold">Running dry-run preview & verifying lots...</p>
            </div>
          ) : isSerialized ? (
            <div className="p-4 bg-purple-50 dark:bg-purple-950/30 rounded-xl border border-purple-200 dark:border-purple-900 space-y-2 text-center">
              <p className="font-bold text-purple-900 dark:text-purple-200 text-sm">📱 Serialized Phone</p>
              <p className="text-purple-700 dark:text-purple-300 text-xs">
                This item is categorized as a mobile phone. Mobile phones already use individual serial/IMEI tracking with exact purchase-to-sale costing.
              </p>
            </div>
          ) : isAlreadyBatchTracked ? (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-900 dark:text-emerald-200 text-sm">
                    Status: Actively Batch Tracked (FIFO)
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-300">
                    Active
                  </span>
                </div>
                <p className="text-emerald-700 dark:text-emerald-300 text-xs leading-relaxed">
                  Every purchase line creates a unique lot with its exact supplier cost. Sales consume the oldest lots first.
                </p>
              </div>

              <div className="p-3 bg-gray-50 dark:bg-slate-800/60 rounded-xl border border-gray-200 dark:border-slate-700 space-y-1.5">
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>Current Physical Stock:</span>
                  <strong className="text-gray-900 dark:text-white font-mono">{currentStock} Units</strong>
                </div>
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>Reference Cost:</span>
                  <strong className="text-gray-900 dark:text-white font-mono">Rs. {Number(product.cost_price || 0).toLocaleString('en-PK')}</strong>
                </div>
              </div>

              <div className="pt-2 border-t border-gray-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={handleRevert}
                  disabled={reverting}
                  className="w-full py-2.5 px-3 bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/60 text-red-700 dark:text-red-300 rounded-xl font-bold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw size={14} />
                  <span>{reverting ? 'Reverting Mode...' : 'Revert to Standard (Non-Batch) Mode'}</span>
                </button>
                <p className="text-[10px] text-gray-400 text-center mt-1.5">
                  Safe rollback is only permitted if no sales have consumed from this product's batches.
                </p>
              </div>
            </div>
          ) : (
            /* ── PREVIEW & CONVERSION SETUP ── */
            <div className="space-y-4">
              {/* Product Stock & Cost Overview */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3 bg-gray-50 dark:bg-slate-800/60 rounded-xl border border-gray-200 dark:border-slate-700">
                  <span className="text-gray-400 text-[10px] uppercase font-bold block mb-0.5">Current Stock</span>
                  <span className="text-base font-black text-gray-900 dark:text-white font-mono">
                    {currentStock} <span className="text-xs font-normal text-gray-500">units</span>
                  </span>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-slate-800/60 rounded-xl border border-gray-200 dark:border-slate-700">
                  <span className="text-gray-400 text-[10px] uppercase font-bold block mb-0.5">
                    {preview?.cost_source === 'last_purchase_cost' ? 'Last Purchase Cost' : 'Catalog Cost'}
                  </span>
                  <span className="text-base font-black text-emerald-600 dark:text-emerald-400 font-mono">
                    Rs. {Number(preview?.resolved_cost || 0).toLocaleString('en-PK')}
                  </span>
                </div>
              </div>

              {/* Ineligibility Warning */}
              {preview && !preview.eligible && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertTriangle size={14} /> Attention Required Before Conversion
                  </div>
                  <ul className="list-disc pl-4 text-[11px] space-y-0.5">
                    {preview.exceptions?.map((exc, idx) => (
                      <li key={idx}>{exc}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Conversion Cost Input */}
              {currentStock > 0 && (
                <div className="space-y-3 p-3.5 bg-emerald-50/40 dark:bg-emerald-950/20 rounded-xl border border-emerald-100 dark:border-emerald-900/50">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-gray-800 dark:text-gray-200 block">
                      Opening Lot Unit Cost (Rs.) <span className="text-red-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsSplitMode(!isSplitMode)}
                      className="text-emerald-700 dark:text-emerald-400 hover:underline text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Layers size={12} />
                      <span>{isSplitMode ? 'Switch to Single Cost' : 'Split into Multiple Lots'}</span>
                    </button>
                  </div>

                  {!isSplitMode ? (
                    <div>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        value={customCost}
                        onChange={e => setCustomCost(e.target.value)}
                        placeholder="e.g. 350"
                        className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white font-mono font-bold text-sm"
                      />
                      <p className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">
                        One initial opening batch will be created with <strong>{currentStock} units</strong> at <strong>Rs. {customCost || 0}</strong>.
                      </p>
                    </div>
                  ) : (
                    /* Multiple Lot Breakdown */
                    <div className="space-y-2.5 pt-1">
                      <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-snug">
                        Specify exact historical lot quantities and purchase costs. Total allocated must equal <strong>{currentStock} units</strong>.
                      </p>

                      {splitBatches.map((batch, idx) => (
                        <div key={idx} className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 space-y-2">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold text-gray-700 dark:text-gray-300">Lot #{idx + 1}</span>
                            {splitBatches.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveSplitLine(idx)}
                                className="text-red-500 hover:text-red-700 font-bold"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="text-[9px] text-gray-400 uppercase font-bold block mb-0.5">Quantity</label>
                              <input
                                type="number"
                                min="1"
                                placeholder="Qty"
                                value={batch.qty}
                                onChange={e => handleUpdateSplitLine(idx, 'qty', e.target.value)}
                                className="w-full p-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white text-xs font-mono font-bold"
                              />
                            </div>
                            <div>
                              <label className="text-[9px] text-gray-400 uppercase font-bold block mb-0.5">Unit Cost (Rs.)</label>
                              <input
                                type="number"
                                min="0"
                                placeholder="Cost"
                                value={batch.cost}
                                onChange={e => handleUpdateSplitLine(idx, 'cost', e.target.value)}
                                className="w-full p-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white text-xs font-mono font-bold"
                              />
                            </div>
                            <div>
                              <label className="text-[9px] text-gray-400 uppercase font-bold block mb-0.5">Date</label>
                              <input
                                type="date"
                                value={batch.purchase_date}
                                onChange={e => handleUpdateSplitLine(idx, 'purchase_date', e.target.value)}
                                className="w-full p-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white text-[11px]"
                              />
                            </div>
                          </div>
                        </div>
                      ))}

                      <div className="flex items-center justify-between pt-1">
                        <button
                          type="button"
                          onClick={handleAddSplitLine}
                          className="px-2.5 py-1 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 rounded-lg text-xs font-bold hover:bg-emerald-50 dark:hover:bg-emerald-950/30 flex items-center gap-1 cursor-pointer"
                        >
                          <Plus size={13} /> Add Another Lot
                        </button>
                        <div className="text-[11px]">
                          Allocated: <strong className="font-mono">{totalSplitQty}</strong> / {currentStock} units
                          <span className={`ml-1 font-bold ${splitRemainingQty === 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            ({splitRemainingQty === 0 ? 'Balanced' : `${splitRemainingQty} remaining`})
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Conversion Explanation Card */}
              <div className="p-3 bg-gray-50 dark:bg-slate-800/40 rounded-xl border border-gray-200 dark:border-slate-800 space-y-1">
                <span className="font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                  <HelpCircle size={13} className="text-gray-400" />
                  How FIFO will apply to this product
                </span>
                <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-relaxed">
                  Existing sales stay 100% untouched. All new sales will deduct from this opening lot (and future purchases) strictly by invoice date.
                </p>
              </div>

              {/* Confirm Conversion Button */}
              <button
                type="button"
                onClick={handleApplyConversion}
                disabled={submitting || (currentStock > 0 && !customCost && !isSplitMode) || (isSplitMode && splitRemainingQty !== 0)}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm rounded-xl transition shadow-md flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                <span>{submitting ? 'Converting...' : 'Confirm & Convert to FIFO Lot Tracking'}</span>
                <ArrowRight size={15} />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 px-5 border-t border-gray-100 dark:border-slate-800 flex justify-end shrink-0 bg-gray-50/50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-bold transition cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  )
}
