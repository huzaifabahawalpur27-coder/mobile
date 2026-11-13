import React, { useState } from 'react'
import {
  Boxes,
  X,
  AlertTriangle,
  CheckCircle2,
  MinusCircle,
  PlusCircle,
  FileText
} from 'lucide-react'
import { adjustBatchStock } from '../services/batchService'

export default function BatchStockAdjustmentModal({
  isOpen,
  onClose,
  batch,
  product,
  onSuccess
}) {
  const [adjustmentType, setAdjustmentType] = useState('decrease') // 'decrease' | 'increase'
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  if (!isOpen || !batch) return null

  const currentRemaining = Number(batch.qty_remaining || 0)
  const parsedQty = parseFloat(qty) || 0
  const effectiveChange = adjustmentType === 'decrease' ? -parsedQty : parsedQty
  const newBatchRemaining = currentRemaining + effectiveChange

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!reason.trim()) {
      setErrorMsg('Adjustment reason is compulsory!')
      return
    }
    if (parsedQty <= 0) {
      setErrorMsg('Quantity must be greater than zero!')
      return
    }
    if (newBatchRemaining < 0) {
      setErrorMsg(`Cannot adjust below zero. Current batch stock is ${currentRemaining}.`)
      return
    }

    setSubmitting(true)
    setErrorMsg('')
    try {
      const res = await adjustBatchStock({
        batchId: batch.id,
        qtyChange: effectiveChange,
        reason: reason.trim()
      })

      if (!res.success) {
        throw new Error(res.error || 'Adjustment failed')
      }

      if (onSuccess) onSuccess(res)
      onClose()
    } catch (err) {
      setErrorMsg(err.message || 'Error saving batch adjustment')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[92dvh] animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-gray-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 flex items-center justify-center shrink-0">
              <Boxes size={20} />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-gray-900 dark:text-white">
                Adjust Batch Quantity
              </h2>
              <p className="text-xs text-gray-500 dark:text-slate-400 font-mono">
                Lot: {batch.batch_no} • {product?.name || ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-500 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded-xl border border-red-200 dark:border-red-900 flex items-start gap-2.5">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <div className="leading-relaxed">{errorMsg}</div>
            </div>
          )}

          {/* Current Batch Stats */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-3 bg-gray-50 dark:bg-slate-800/60 rounded-xl border border-gray-200 dark:border-slate-700">
              <span className="text-gray-500 text-xs uppercase font-bold block mb-0.5">Current Lot Stock</span>
              <span className="text-base font-black text-gray-900 dark:text-white font-mono">
                {currentRemaining} <span className="text-xs font-normal text-gray-500">units</span>
              </span>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-slate-800/60 rounded-xl border border-gray-200 dark:border-slate-700">
              <span className="text-gray-500 text-xs uppercase font-bold block mb-0.5">Unit Cost</span>
              <span className="text-base font-black text-emerald-600 dark:text-emerald-400 font-mono">
                Rs. {Number(batch.current_unit_cost || 0).toLocaleString('en-PK')}
              </span>
            </div>
          </div>

          {/* Adjustment Direction Toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAdjustmentType('decrease')}
              className={`p-2.5 rounded-xl border font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer ${
                adjustmentType === 'decrease'
                  ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-800 shadow-xs'
                  : 'bg-gray-50 dark:bg-slate-800/40 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-slate-700 hover:bg-gray-100'
              }`}
            >
              <MinusCircle size={15} />
              <span>Damage / Loss (-)</span>
            </button>

            <button
              type="button"
              onClick={() => setAdjustmentType('increase')}
              className={`p-2.5 rounded-xl border font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer ${
                adjustmentType === 'increase'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 shadow-xs'
                  : 'bg-gray-50 dark:bg-slate-800/40 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-slate-700 hover:bg-gray-100'
              }`}
            >
              <PlusCircle size={15} />
              <span>Audit Surplus (+)</span>
            </button>
          </div>

          {/* Quantity Input */}
          <div>
            <label className="font-bold text-gray-700 dark:text-gray-300 block mb-1">
              Quantity to {adjustmentType === 'decrease' ? 'Deduct' : 'Add'} <span className="text-red-500">*</span>
            </label>
            <input aria-label=" Quantity to "
              type="number"
              min="0.01"
              step="any"
              required
              value={qty}
              onChange={e => setQty(e.target.value)}
              placeholder="e.g. 2"
              className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white font-mono font-bold text-sm"
            />
          </div>

          {/* New Projected Balance */}
          {parsedQty > 0 && (
            <div className="p-3 bg-purple-50/50 dark:bg-purple-950/20 rounded-xl border border-purple-100 dark:border-purple-900/40 flex justify-between items-center text-xs">
              <span className="text-gray-600 dark:text-gray-300">Projected Lot Balance:</span>
              <strong className={`font-mono text-sm ${newBatchRemaining >= 0 ? 'text-purple-700 dark:text-purple-300' : 'text-red-600'}`}>
                {newBatchRemaining} units
              </strong>
            </div>
          )}

          {/* Reason Input */}
          <div>
            <label className="font-bold text-gray-700 dark:text-gray-300 block mb-1">
              Reason for Adjustment <span className="text-red-500">*</span>
            </label>
            <input aria-label=" Reason for Adjustment "
              type="text"
              required
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Broken in transit / Expired / Physical inventory count audit"
              className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white text-xs"
            />
          </div>

          <div className="p-2.5 bg-gray-50 dark:bg-slate-800/40 rounded-xl border border-gray-200 dark:border-slate-800 text-xs text-gray-500 space-y-0.5">
            <p>• Updates this specific batch and the master product stock balance in sync.</p>
            <p>• Creates an immutable audit entry in <code>stock_adjustments</code>.</p>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300 rounded-xl font-bold cursor-pointer transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || parsedQty <= 0 || !reason.trim() || newBatchRemaining < 0}
              className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold transition cursor-pointer disabled:opacity-40"
            >
              {submitting ? 'Applying...' : 'Confirm Adjustment'}
            </button>
          </div>
        </form>

      </div>
    </div>
  )
}
