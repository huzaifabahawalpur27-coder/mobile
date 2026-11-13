import React, { useState, useEffect, useMemo } from 'react'
import {
  Boxes,
  X,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Building2,
  Layers,
  ArrowDownRight,
  Sparkles,
  ShieldCheck
} from 'lucide-react'
import { fetchProductBatches, reconcileProductBatches } from '../services/batchService'
import BatchStockAdjustmentModal from './BatchStockAdjustmentModal'
import BatchCostAdjustmentModal from './BatchCostAdjustmentModal'

export default function BatchManagementModal({
  isOpen,
  onClose,
  product,
  userShopId
}) {
  const [loading, setLoading] = useState(true)
  const [batches, setBatches] = useState([])
  const [reconcile, setReconcile] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [statusFilter, setStatusFilter] = useState('active') // 'active' | 'all' | 'depleted'
  const [selectedAdjustBatch, setSelectedAdjustBatch] = useState(null)
  const [selectedCostBatch, setSelectedCostBatch] = useState(null)

  useEffect(() => {
    if (!isOpen || !product?.id) return
    loadData()
  }, [isOpen, product?.id])

  const loadData = async () => {
    setLoading(true)
    setErrorMsg('')
    try {
      const [batchRes, recRes] = await Promise.all([
        fetchProductBatches({ productId: product.id, shopId: userShopId }),
        reconcileProductBatches({ productId: product.id })
      ])

      if (batchRes.success) {
        setBatches(batchRes.batches || [])
      } else {
        setErrorMsg(batchRes.error || 'Failed to fetch batches')
      }

      if (recRes?.success) {
        setReconcile(recRes)
      }
    } catch (err) {
      setErrorMsg(err.message || 'Error loading batch information')
    } finally {
      setLoading(false)
    }
  }

  const filteredBatches = useMemo(() => {
    if (statusFilter === 'active') return batches.filter(b => b.status === 'active' && Number(b.qty_remaining) > 0)
    if (statusFilter === 'depleted') return batches.filter(b => b.status === 'depleted' || Number(b.qty_remaining) === 0)
    return batches
  }, [batches, statusFilter])

  // Total valuation of active lots
  const totalValuation = useMemo(() => {
    return batches
      .filter(b => b.status === 'active')
      .reduce((sum, b) => sum + (Number(b.qty_remaining || 0) * Number(b.current_unit_cost || 0)), 0)
  }, [batches])

  const totalRemainingUnits = useMemo(() => {
    return batches
      .filter(b => b.status === 'active')
      .reduce((sum, b) => sum + Number(b.qty_remaining || 0), 0)
  }, [batches])

  if (!isOpen || !product) return null

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92dvh] animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-gray-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
              <Boxes size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-gray-900 dark:text-white">
                  FIFO Batch Inventory (Lots)
                </h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-black uppercase bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300">
                  FIFO Tracked
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                {product.name} {product.sku ? `• SKU: ${product.sku}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={loadData}
              title="Refresh Batches"
              className="p-1.5 text-gray-500 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg transition"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-500 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded-xl border border-red-200 dark:border-red-900 flex items-start gap-2.5">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <div className="leading-relaxed">{errorMsg}</div>
            </div>
          )}

          {/* Metric Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="p-3 bg-gray-50 dark:bg-slate-800/60 rounded-xl border border-gray-200 dark:border-slate-700">
              <span className="text-gray-500 text-xs uppercase font-bold block mb-0.5">Active Remaining Stock</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-black text-gray-900 dark:text-white font-mono">
                  {totalRemainingUnits}
                </span>
                <span className="text-xs text-gray-500">units in lots</span>
              </div>
            </div>

            <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-xl border border-emerald-100 dark:border-emerald-900/40">
              <span className="text-emerald-700 dark:text-emerald-400 text-xs uppercase font-bold block mb-0.5">Total Lot Valuation</span>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-black text-emerald-700 dark:text-emerald-300 font-mono">
                  Rs. {Math.round(totalValuation).toLocaleString('en-PK')}
                </span>
              </div>
            </div>

            <div className="p-3 bg-purple-50/50 dark:bg-purple-950/20 rounded-xl border border-purple-100 dark:border-purple-900/40">
              <span className="text-purple-700 dark:text-purple-400 text-xs uppercase font-bold block mb-0.5">Reconciliation Invariant</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                {reconcile?.is_balanced ? (
                  <>
                    <ShieldCheck size={16} className="text-emerald-600" />
                    <span className="text-emerald-700 dark:text-emerald-300 font-bold text-xs">Balanced & Verified</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle size={16} className="text-amber-500" />
                    <span className="text-amber-700 dark:text-amber-300 font-bold text-xs">Diff: {reconcile?.difference ?? 0}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setStatusFilter('active')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  statusFilter === 'active'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                }`}
              >
                Active Batches ({batches.filter(b => b.status === 'active' && Number(b.qty_remaining) > 0).length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('depleted')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  statusFilter === 'depleted'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                }`}
              >
                Depleted ({batches.filter(b => b.status === 'depleted' || Number(b.qty_remaining) === 0).length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  statusFilter === 'all'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                }`}
              >
                All Lots ({batches.length})
              </button>
            </div>

            <span className="text-xs text-gray-500">
              FIFO Allocation Order (Oldest First)
            </span>
          </div>

          {/* Batches List */}
          {loading ? (
            <div className="py-12 text-center text-gray-500 space-y-2">
              <div className="inline-block animate-spin rounded-full h-7 w-7 border-2 border-emerald-500 border-t-transparent"></div>
              <p className="text-xs font-semibold">Loading batch lots...</p>
            </div>
          ) : filteredBatches.length === 0 ? (
            <div className="py-10 text-center border-2 border-dashed border-gray-200 dark:border-slate-800 rounded-2xl p-4 text-gray-500 space-y-1">
              <Boxes size={28} className="mx-auto opacity-40 mb-1" />
              <p className="font-bold text-gray-600 dark:text-gray-300">No batches match this filter</p>
              <p className="text-xs">New purchases will automatically create new FIFO batches here.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredBatches.map((batch, idx) => {
                const received = Number(batch.qty_received || 0)
                const remaining = Number(batch.qty_remaining || 0)
                const sold = Math.max(0, received - remaining)
                const progressPct = received > 0 ? ((remaining / received) * 100) : 0
                const isDepleted = remaining === 0 || batch.status === 'depleted'

                return (
                  <div
                    key={batch.id || idx}
                    className={`p-3.5 rounded-xl border transition space-y-2.5 ${
                      isDepleted
                        ? 'bg-gray-50/60 dark:bg-slate-800/30 border-gray-200 dark:border-slate-800 opacity-70'
                        : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 shadow-xs'
                    }`}
                  >
                    {/* Top Row: Batch No, Date, Status */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-gray-900 dark:text-white text-xs">
                          {batch.batch_no}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-black uppercase tracking-wider ${
                          batch.source === 'opening_balance'
                            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                            : batch.source === 'return_restock'
                            ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                            : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                        }`}>
                          {batch.source === 'opening_balance' ? 'Opening Lot' : (batch.source === 'return_restock' ? 'Restocked' : 'Purchase')}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                          isDepleted
                            ? 'bg-gray-100 dark:bg-slate-800 text-gray-500'
                            : 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200'
                        }`}>
                          {isDepleted ? 'Depleted' : 'Active'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 text-xs text-gray-500 font-mono">
                          <Calendar size={12} className="text-gray-500" />
                          <span>{new Date(batch.purchase_date || batch.created_at).toLocaleDateString()}</span>
                        </div>
                        {!isDepleted && (
                          <button
                            type="button"
                            onClick={() => setSelectedAdjustBatch(batch)}
                            className="px-2 py-0.5 rounded text-xs font-bold text-purple-700 dark:text-purple-300 bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 transition cursor-pointer"
                            title="Adjust batch stock for damage or loss"
                          >
                            Adjust Stock
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedCostBatch(batch)}
                          className="px-2 py-0.5 rounded text-xs font-bold text-blue-700 dark:text-blue-300 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 transition cursor-pointer"
                          title="Adjust batch cost price"
                        >
                          Adjust Cost
                        </button>
                      </div>
                    </div>

                    {/* Middle Row: Quantity Bar & Financials */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-gray-100 dark:border-slate-800/80">
                      <div>
                        <div className="text-xs text-gray-500 uppercase font-bold mb-0.5">Lot Balance</div>
                        <div className="flex items-baseline gap-1 font-mono">
                          <strong className="text-gray-900 dark:text-white text-sm">{remaining}</strong>
                          <span className="text-xs text-gray-500">/ {received} rem</span>
                          {sold > 0 && <span className="text-xs text-purple-600 font-semibold">({sold} sold)</span>}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs text-gray-500 uppercase font-bold mb-0.5">Unit Cost</div>
                        <div className="font-mono text-xs font-bold text-gray-800 dark:text-gray-200">
                          Rs. {Number(batch.current_unit_cost || batch.original_unit_cost || 0).toLocaleString('en-PK')}
                          {Number(batch.current_unit_cost) !== Number(batch.original_unit_cost) && (
                            <span className="text-xs text-gray-500 ml-1 line-through">
                              Rs. {Number(batch.original_unit_cost).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs text-gray-500 uppercase font-bold mb-0.5">Remaining Value</div>
                        <div className="font-mono text-xs font-black text-emerald-600 dark:text-emerald-400">
                          Rs. {Math.round(remaining * Number(batch.current_unit_cost || 0)).toLocaleString('en-PK')}
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-gray-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${isDepleted ? 'bg-gray-300' : 'bg-emerald-500'}`}
                        style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 px-5 border-t border-gray-100 dark:border-slate-800 flex justify-between items-center shrink-0 bg-gray-50/50 dark:bg-slate-900/50">
          <span className="text-xs text-gray-500">
            Total Batches: <strong>{batches.length}</strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-bold transition cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>

      {/* Batch Stock Adjustment Modal */}
      {selectedAdjustBatch && (
        <BatchStockAdjustmentModal
          isOpen={!!selectedAdjustBatch}
          onClose={() => setSelectedAdjustBatch(null)}
          batch={selectedAdjustBatch}
          product={product}
          onSuccess={() => {
            loadData()
          }}
        />
      )}

      {/* Batch Cost Adjustment Modal */}
      {selectedCostBatch && (
        <BatchCostAdjustmentModal
          batch={selectedCostBatch}
          productName={product?.name}
          onClose={() => setSelectedCostBatch(null)}
          onAdjusted={() => {
            loadData()
          }}
        />
      )}
    </div>
  )
}
