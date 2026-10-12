import { X, Tag, Package, Barcode, DollarSign, Layers, ShieldCheck, AlertTriangle, Calendar, Hash, ArrowUpRight, TrendingUp, Edit, Printer, CheckCircle, Truck } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function ProductDetailModal({
  isOpen,
  onClose,
  product,
  categoryName = '',
  unitName = '',
  supplierName = '',
  onEdit,
  onPrintBarcode,
  userRole = 'admin'
}) {
  if (!isOpen || !product) return null

  const cost = Number(product.cost_price || 0)
  const sale = Number(product.sale_price || 0)
  const cRate = Number(product.c_rate || 0)
  const stock = Number(product.stock_quantity || 0)
  const threshold = Number(product.low_stock_threshold || 10)
  const profitPerUnit = sale - cost
  const marginPercent = sale > 0 ? (profitPerUnit / sale) * 100 : 0
  const totalCostValuation = stock * cost
  const totalRetailValuation = stock * sale
  const totalPotentialProfit = stock * profitPerUnit
  const isLowStock = stock <= threshold
  const isOutOfStock = stock <= 0
  const canSeeMargins = userRole === 'admin' || userRole === 'manager'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-800 flex flex-col max-h-[92dvh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/70 dark:bg-gray-800/50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center font-black shrink-0">
              <Package size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-gray-900 dark:text-gray-100 truncate">
                  {product.name}
                </h2>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shrink-0 ${
                  product.status === 'active'
                    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                }`}>
                  {product.status || 'Active'}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                SKU: <span className="font-mono font-bold text-gray-700 dark:text-gray-300">{product.sku || 'N/A'}</span>
                {product.brand && <span> • Brand: <strong className="text-gray-700 dark:text-gray-300">{product.brand}</strong></span>}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1 min-h-0 text-sm">
          {/* Key Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Stock Card */}
            <div className={`p-3.5 rounded-xl border flex flex-col justify-between ${
              isOutOfStock
                ? 'bg-red-50/60 dark:bg-red-950/30 border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-400'
                : isLowStock
                  ? 'bg-amber-50/60 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/40 text-amber-700 dark:text-amber-400'
                  : 'bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-400'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-gray-500 dark:text-gray-400">Current Stock</span>
                {isOutOfStock ? <AlertTriangle size={14} /> : isLowStock ? <AlertTriangle size={14} /> : <CheckCircle size={14} />}
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black">{stock}</span>
                <span className="text-xs ml-1 font-bold">{unitName || 'Units'}</span>
              </div>
              <p className="text-[10px] mt-1 font-semibold opacity-90">
                {isOutOfStock ? '⚠️ Out of Stock' : isLowStock ? `Low (Alert: ≤${threshold})` : 'Healthy Inventory'}
              </p>
            </div>

            {/* Sale Price Card */}
            <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/40 flex flex-col justify-between">
              <span className="text-[11px] font-black uppercase tracking-wider text-gray-500 dark:text-gray-400">Retail Price</span>
              <div className="mt-2">
                <span className="text-xl font-black text-gray-900 dark:text-gray-100">Rs. {sale.toLocaleString()}</span>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Per {unitName || 'Item'}</p>
            </div>

            {/* Cost Price Card */}
            {canSeeMargins && (
              <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/40 flex flex-col justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-gray-500 dark:text-gray-400">Cost Price</span>
                <div className="mt-2">
                  <span className="text-xl font-black text-gray-900 dark:text-gray-100">Rs. {cost.toLocaleString()}</span>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">Purchase Cost</p>
              </div>
            )}

            {/* Margin Card */}
            {canSeeMargins && (
              <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/30 flex flex-col justify-between text-blue-700 dark:text-blue-400">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-wider text-gray-500 dark:text-gray-400">Profit Margin</span>
                  <TrendingUp size={14} />
                </div>
                <div className="mt-2">
                  <span className="text-xl font-black">{marginPercent.toFixed(1)}%</span>
                </div>
                <p className="text-[10px] mt-1 font-bold">
                  +Rs. {profitPerUnit.toLocaleString()} / unit
                </p>
              </div>
            )}
          </div>

          {/* Inventory Valuation Section */}
          {canSeeMargins && (
            <div className="p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/30">
              <h3 className="text-xs font-black uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3 flex items-center gap-1.5">
                <DollarSign size={14} className="text-emerald-600" />
                <span>Inventory Valuation Summary</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
                  <p className="text-[10px] font-bold uppercase text-gray-400">Total Cost Invested</p>
                  <p className="text-base font-black text-gray-800 dark:text-gray-200 mt-0.5">
                    Rs. {totalCostValuation.toLocaleString()}
                  </p>
                </div>
                <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
                  <p className="text-[10px] font-bold uppercase text-gray-400">Total Retail Value</p>
                  <p className="text-base font-black text-gray-800 dark:text-gray-200 mt-0.5">
                    Rs. {totalRetailValuation.toLocaleString()}
                  </p>
                </div>
                <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
                  <p className="text-[10px] font-bold uppercase text-gray-400">Expected Profit</p>
                  <p className="text-base font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                    Rs. {totalPotentialProfit.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Mobile Phone Hardware & IMEI Section (if phone) */}
          {(product.imei_1 || product.item_type === 'phone') && (
            <div className="p-4 rounded-xl border border-purple-200 dark:border-purple-900/50 bg-purple-50/50 dark:bg-purple-950/20">
              <h3 className="text-xs font-black uppercase tracking-wider text-purple-700 dark:text-purple-300 mb-2.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Hash size={14} className="text-purple-600" />
                  <span>Mobile Phone IMEI & Hardware Specs</span>
                </span>
                {product.pta_status && (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                    product.pta_status === 'pta_approved'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      : product.pta_status === 'non_pta'
                        ? 'bg-amber-100 text-amber-800 border border-amber-200'
                        : 'bg-purple-100 text-purple-800 border border-purple-200'
                  }`}>
                    {product.pta_status.replace(/_/g, ' ')}
                  </span>
                )}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="flex items-center justify-between p-2.5 bg-white dark:bg-gray-800 rounded-lg border border-purple-100 dark:border-purple-900/40">
                  <span className="font-bold text-gray-500">IMEI 1 (Primary):</span>
                  <span className="font-mono font-black text-purple-700 dark:text-purple-300 select-all">{product.imei_1 || 'N/A'}</span>
                </div>
                {product.imei_2 && (
                  <div className="flex items-center justify-between p-2.5 bg-white dark:bg-gray-800 rounded-lg border border-purple-100 dark:border-purple-900/40">
                    <span className="font-bold text-gray-500">IMEI 2:</span>
                    <span className="font-mono font-black text-purple-700 dark:text-purple-300 select-all">{product.imei_2}</span>
                  </div>
                )}
                <div className="flex items-center justify-between p-2.5 bg-white dark:bg-gray-800 rounded-lg border border-purple-100 dark:border-purple-900/40">
                  <span className="font-bold text-gray-500">Storage / RAM:</span>
                  <span className="font-black text-gray-800 dark:text-gray-200">{product.storage || 'Standard'}{product.ram ? ` • ${product.ram}` : ''}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 bg-white dark:bg-gray-800 rounded-lg border border-purple-100 dark:border-purple-900/40">
                  <span className="font-bold text-gray-500">Color / Condition:</span>
                  <span className="font-black text-gray-800 dark:text-gray-200">{product.color || 'Default'}{product.condition ? ` • ${product.condition}` : ''}</span>
                </div>
                {product.battery_health && (
                  <div className="flex items-center justify-between p-2.5 bg-white dark:bg-gray-800 rounded-lg border border-purple-100 dark:border-purple-900/40">
                    <span className="font-bold text-gray-500">Battery Health:</span>
                    <span className="font-black text-emerald-600">{product.battery_health}%</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Product Specifications & Meta Details */}
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2.5 flex items-center gap-1.5">
              <Layers size={14} className="text-blue-600" />
              <span>Product Specifications</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              <div className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-800/60 rounded-lg border border-gray-100 dark:border-gray-800">
                <span className="font-bold text-gray-500">Brand:</span>
                <span className="font-black text-gray-800 dark:text-gray-200">{product.brand || 'None'}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-800/60 rounded-lg border border-gray-100 dark:border-gray-800">
                <span className="font-bold text-gray-500">Category:</span>
                <span className="font-black text-blue-600 dark:text-blue-400">{categoryName || product.categories?.name || 'Unassigned'}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-800/60 rounded-lg border border-gray-100 dark:border-gray-800">
                <span className="font-bold text-gray-500">Unit of Measure:</span>
                <span className="font-black text-gray-800 dark:text-gray-200">{unitName || 'Standard Piece'}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-800/60 rounded-lg border border-gray-100 dark:border-gray-800">
                <span className="font-bold text-gray-500">SKU / Barcode:</span>
                <span className="font-mono font-bold text-gray-800 dark:text-gray-200">{product.sku || 'N/A'}</span>
              </div>
              {cRate > 0 && (
                <div className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-800/60 rounded-lg border border-gray-100 dark:border-gray-800">
                  <span className="font-bold text-gray-500">Cash / C-Rate:</span>
                  <span className="font-black text-purple-600 dark:text-purple-400">Rs. {cRate.toLocaleString()}</span>
                </div>
              )}
              <div className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-800/60 rounded-lg border border-gray-100 dark:border-gray-800">
                <span className="font-bold text-gray-500">Alert Threshold:</span>
                <span className="font-bold text-gray-800 dark:text-gray-200">{threshold} Units</span>
              </div>
              {supplierName && (
                <div className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-800/60 rounded-lg border border-gray-100 dark:border-gray-800 col-span-1 sm:col-span-2">
                  <span className="font-bold text-gray-500 flex items-center gap-1">
                    <Truck size={13} /> Supplier:
                  </span>
                  <span className="font-black text-gray-800 dark:text-gray-200">{supplierName}</span>
                </div>
              )}
              {product.created_at && (
                <div className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-800/60 rounded-lg border border-gray-100 dark:border-gray-800 col-span-1 sm:col-span-2">
                  <span className="font-bold text-gray-500 flex items-center gap-1">
                    <Calendar size={13} /> Date Added:
                  </span>
                  <span className="font-medium text-gray-600 dark:text-gray-300">
                    {new Date(product.created_at).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            {onPrintBarcode && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onPrintBarcode(product)
                }}
                className="px-3.5 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 font-bold text-xs flex items-center gap-1.5 transition border border-indigo-200 dark:border-indigo-800"
              >
                <Printer size={15} />
                <span>Print Barcode</span>
              </button>
            )}

            <Link
              to={`/edit-product/${product.id}`}
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60 font-bold text-xs flex items-center gap-1.5 transition border border-blue-200 dark:border-blue-800"
            >
              <Edit size={15} />
              <span>Full Edit</span>
            </Link>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 font-bold text-xs transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
