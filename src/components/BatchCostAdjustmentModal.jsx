import React, { useState } from 'react'
import { adjustBatchCost } from '../services/batchService'

export default function BatchCostAdjustmentModal({ batch, productName, onClose, onAdjusted }) {
  const [newCost, setNewCost] = useState(batch?.current_unit_cost ?? '')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  if (!batch) return null

  const currentCost = Number(batch.current_unit_cost || 0)
  const originalCost = Number(batch.original_unit_cost || 0)
  const parsedNewCost = parseFloat(newCost)
  const isValidCost = !isNaN(parsedNewCost) && parsedNewCost >= 0
  const costDiff = isValidCost ? parsedNewCost - currentCost : 0

  const qtyReceived = Number(batch.qty_received || 0)
  const qtyRemaining = Number(batch.qty_remaining || 0)
  const qtySold = Math.max(0, qtyReceived - qtyRemaining)
  const cogsImpact = Math.round(costDiff * qtySold * 100) / 100

  const handleApply = async (e) => {
    e.preventDefault()
    if (!isValidCost) {
      setError('Please enter a valid non-negative cost.')
      return
    }
    if (costDiff === 0) {
      setError('New cost is identical to current cost. Enter a different amount.')
      return
    }
    if (!reason || reason.trim().length < 3) {
      setError('Adjustment reason is mandatory (minimum 3 characters).')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const res = await adjustBatchCost({
        batchId: batch.id,
        newCost: parsedNewCost,
        reason: reason.trim()
      })

      if (!res?.success) {
        throw new Error(res?.error || 'Failed to adjust batch cost')
      }

      onAdjusted?.()
      onClose()
    } catch (err) {
      setError(err.message || 'An unexpected error occurred')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white dark:bg-[#1c1c1e] w-full max-w-lg rounded-2xl shadow-2xl border border-black/[0.08] dark:border-white/[0.08] overflow-hidden flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-black/[0.06] dark:border-white/[0.06] flex items-center justify-between">
          <div>
            <h3 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-base flex items-center gap-2">
              <span>💰</span> Adjust FIFO Batch Cost
            </h3>
            <p className="text-xs text-[#6e6e73] mt-0.5">
              Batch <span className="font-mono font-bold text-[#0071e3]">{batch.batch_no}</span> • {productName || 'Product'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-black/[0.04] dark:bg-white/[0.06] text-[#6e6e73] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] flex items-center justify-center font-bold text-lg"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleApply} className="p-5 overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Current State Summary */}
          <div className="grid grid-cols-3 gap-2.5 p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.05] dark:border-white/[0.05] text-xs">
            <div>
              <span className="text-[#6e6e73] block text-xs uppercase font-bold">Original Cost</span>
              <span className="font-bold font-mono text-[#1d1d1f] dark:text-[#f5f5f7]">
                Rs. {originalCost.toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-[#6e6e73] block text-xs uppercase font-bold">Current Cost</span>
              <span className="font-bold font-mono text-[#0071e3]">
                Rs. {currentCost.toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-[#6e6e73] block text-xs uppercase font-bold">Units (Rem / Sold)</span>
              <span className="font-bold font-mono text-[#1d1d1f] dark:text-[#f5f5f7]">
                {qtyRemaining} / {qtySold}
              </span>
            </div>
          </div>

          {/* New Unit Cost Input */}
          <div>
            <label className="block text-xs font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
              New Unit Cost (Rs.) *
            </label>
            <input aria-label=" New Unit Cost (Rs.) "
              type="number"
              step="any"
              min="0"
              required
              autoFocus
              value={newCost}
              onChange={(e) => setNewCost(e.target.value)}
              placeholder="e.g. 450"
              className="w-full px-3.5 py-2.5 rounded-xl border border-black/[0.1] dark:border-white/[0.15] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] font-mono text-base font-bold outline-none focus:ring-2 focus:ring-[#0071e3]"
            />
          </div>

          {/* Reason Input */}
          <div>
            <label className="block text-xs font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
              Adjustment Reason (Mandatory) *
            </label>
            <textarea aria-label=" Adjustment Reason (Mandatory) "
              required
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Supplier invoice revision / Price correction agreed with vendor"
              className="w-full px-3.5 py-2 rounded-xl border border-black/[0.1] dark:border-white/[0.15] bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] text-xs outline-none focus:ring-2 focus:ring-[#0071e3]"
            />
          </div>

          {/* Accounting Impact Preview */}
          {isValidCost && costDiff !== 0 && (
            <div className="p-3.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 space-y-2 text-xs">
              <div className="font-bold text-blue-900 dark:text-blue-300 flex items-center justify-between">
                <span>Accounting & Profit Impact Preview</span>
                <span className={costDiff > 0 ? 'text-amber-600' : 'text-green-600'}>
                  {costDiff > 0 ? `+Rs. ${costDiff}/unit` : `-Rs. ${Math.abs(costDiff)}/unit`}
                </span>
              </div>
              <ul className="space-y-1 text-blue-800 dark:text-blue-200 text-xs list-disc list-inside">
                <li>
                  <strong>Remaining Stock ({qtyRemaining} units):</strong> Revalued at Rs. {parsedNewCost.toLocaleString()} from now on.
                </li>
                {qtySold > 0 ? (
                  <li>
                    <strong>Already Sold ({qtySold} units):</strong> Past sale invoices keep their recorded sale costs. A separate <strong>COGS Adjustment of Rs. {cogsImpact.toLocaleString()}</strong> will be recorded for this accounting period.
                  </li>
                ) : (
                  <li>
                    <strong>Already Sold (0 units):</strong> No COGS impact because no units have been sold from this lot yet.
                  </li>
                )}
                <li>
                  Original purchase cost (Rs. {originalCost.toLocaleString()}) remains permanently on record.
                </li>
              </ul>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-black/[0.05] dark:border-white/[0.05]">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-xl bg-black/[0.05] dark:bg-white/[0.08] text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-black/[0.1] transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !isValidCost || costDiff === 0}
              className="px-4 py-2 rounded-xl bg-[#0071e3] hover:bg-[#0077ed] text-white text-xs font-bold transition disabled:opacity-50 shadow-xs"
            >
              {submitting ? 'Applying...' : 'Apply Cost Adjustment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
