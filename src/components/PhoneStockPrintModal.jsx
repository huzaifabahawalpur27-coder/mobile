import React, { useState } from 'react'
import { Printer, FileText, Share2, X, ShieldCheck, CheckCircle2 } from 'lucide-react'
import { printHTML, getShopBranding, generatePhoneStockPrintHTML } from '../utils/printUtils'
import { generatePhoneStockPDF, shareOrDownloadPDF } from '../utils/pdfShare'

export default function PhoneStockPrintModal({
  isOpen,
  onClose,
  phones = [],
  filteredPhones = [],
  activeFilterDesc = '',
  canViewCost = false,
  shopId = null
}) {
  const [scope, setScope] = useState(filteredPhones.length < phones.length ? 'filtered' : 'all_instock')
  const [showCost, setShowCost] = useState(canViewCost)
  const [showImei2, setShowImei2] = useState(true)
  const [showSummary, setShowSummary] = useState(true)
  const [customTitle, setCustomTitle] = useState('Mobile Phone Stock & Inventory Report')
  const [waPhone, setWaPhone] = useState('')
  const [showWaInput, setShowWaInput] = useState(false)
  const [loadingAction, setLoadingAction] = useState(null) // 'print' | 'pdf' | 'wa' | null

  if (!isOpen) return null

  // Determine active phone list based on scope
  const inStockPhones = phones.filter(p => p.status === 'in_stock')
  const targetPhones =
    scope === 'filtered'
      ? filteredPhones
      : scope === 'all_instock'
        ? inStockPhones
        : phones

  const branding = getShopBranding(shopId)

  // Compute metrics for preview
  const totalCount = targetPhones.length
  const ptaCount = targetPhones.filter(p => String(p.pta_status || '').toLowerCase().includes('approved')).length
  const nonPtaCount = targetPhones.filter(p => String(p.pta_status || '').toLowerCase().includes('non')).length
  const totalCost = targetPhones.reduce((sum, p) => sum + (parseFloat(p.cost_price) || 0) + (parseFloat(p.additional_costs) || 0), 0)
  const totalSale = targetPhones.reduce((sum, p) => sum + (parseFloat(p.sale_price) || parseFloat(p.selling_price) || 0), 0)

  const handlePrint = () => {
    setLoadingAction('print')
    try {
      const filterLabel = scope === 'filtered' ? activeFilterDesc : scope === 'all_instock' ? 'All In-Stock Units' : 'Complete Phone Inventory'
      const html = generatePhoneStockPrintHTML(targetPhones, branding, {
        showCost: canViewCost && showCost,
        showImei2,
        showSummary,
        title: customTitle.trim() || 'Mobile Phone Stock & Inventory Report',
        filterDesc: filterLabel
      })
      printHTML(html)
      onClose()
    } catch (err) {
      alert('Print error: ' + (err.message || String(err)))
    } finally {
      setLoadingAction(null)
    }
  }

  const handleDownloadPDF = async () => {
    setLoadingAction('pdf')
    try {
      const filterLabel = scope === 'filtered' ? activeFilterDesc : scope === 'all_instock' ? 'All In-Stock Units' : 'Complete Phone Inventory'
      const pdfBlob = await generatePhoneStockPDF(targetPhones, branding, {
        showCost: canViewCost && showCost,
        showImei2,
        showSummary,
        title: customTitle.trim() || 'Mobile Phone Stock & Inventory Report',
        subtitle: filterLabel
      })
      const filename = `Phone_Stock_Report_${new Date().toISOString().slice(0, 10)}.pdf`
      await shareOrDownloadPDF(pdfBlob, filename)
      onClose()
    } catch (err) {
      alert('PDF generation failed: ' + (err.message || String(err)))
    } finally {
      setLoadingAction(null)
    }
  }

  const handleShareWA = async (e) => {
    e.preventDefault()
    setLoadingAction('wa')
    try {
      const filterLabel = scope === 'filtered' ? activeFilterDesc : scope === 'all_instock' ? 'All In-Stock Units' : 'Complete Phone Inventory'
      const pdfBlob = await generatePhoneStockPDF(targetPhones, branding, {
        showCost: canViewCost && showCost,
        showImei2,
        showSummary,
        title: customTitle.trim() || 'Mobile Phone Stock & Inventory Report',
        subtitle: filterLabel
      })
      const filename = `Phone_Stock_Report_${new Date().toISOString().slice(0, 10)}.pdf`
      const msg = `Assalam-o-Alaikum! ${branding.name || 'Our Shop'} ki latest mobile phone stock inventory report (${totalCount} units). Meharbani farma kar check karein.`

      let phoneNum = (waPhone || '').replace(/[^0-9]/g, '')
      if (phoneNum.startsWith('03')) phoneNum = '92' + phoneNum.substring(1)

      await shareOrDownloadPDF(pdfBlob, filename, phoneNum || null, msg)
      onClose()
    } catch (err) {
      alert('WhatsApp share failed: ' + (err.message || String(err)))
    } finally {
      setLoadingAction(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-gray-100 flex flex-col max-h-[92dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-blue-900 to-indigo-900 text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
              <Printer className="w-5 h-5 text-blue-200" />
            </div>
            <div>
              <h2 className="text-base font-black tracking-tight">Print Stock Inventory / PDF</h2>
              <p className="text-xs text-blue-200">Mobile Phone Catalog & IMEI Stock Register</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto min-h-0 text-sm">
          {/* Scope Selector */}
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
              Select Device Scope
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setScope('filtered')}
                className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                  scope === 'filtered'
                    ? 'border-blue-600 bg-blue-50/80 text-blue-900 ring-1 ring-blue-600'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                }`}
              >
                <div className="font-bold text-xs flex items-center justify-between">
                  <span>Filtered List</span>
                  {scope === 'filtered' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">{filteredPhones.length} devices</div>
              </button>

              <button
                type="button"
                onClick={() => setScope('all_instock')}
                className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                  scope === 'all_instock'
                    ? 'border-blue-600 bg-blue-50/80 text-blue-900 ring-1 ring-blue-600'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                }`}
              >
                <div className="font-bold text-xs flex items-center justify-between">
                  <span>All In-Stock</span>
                  {scope === 'all_instock' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">{inStockPhones.length} devices</div>
              </button>

              <button
                type="button"
                onClick={() => setScope('all')}
                className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                  scope === 'all'
                    ? 'border-blue-600 bg-blue-50/80 text-blue-900 ring-1 ring-blue-600'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                }`}
              >
                <div className="font-bold text-xs flex items-center justify-between">
                  <span>All (History)</span>
                  {scope === 'all' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">{phones.length} devices</div>
              </button>
            </div>
            {scope === 'filtered' && activeFilterDesc && (
              <p className="text-[11px] text-blue-700 mt-1.5 font-medium">
                Active Filter: <span className="font-bold">{activeFilterDesc}</span>
              </p>
            )}
          </div>

          {/* Report Title */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              Document Header Title
            </label>
            <input
              type="text"
              value={customTitle}
              onChange={e => setCustomTitle(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-medium"
              placeholder="Mobile Phone Stock & Inventory Report"
            />
          </div>

          {/* Checkbox Options */}
          <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-200 space-y-2.5">
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">
              Columns & Pricing Privacy
            </span>

            {canViewCost ? (
              <label className="flex items-center gap-2.5 cursor-pointer text-xs select-none">
                <input
                  type="checkbox"
                  checked={showCost}
                  onChange={e => setShowCost(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300"
                />
                <span className="font-semibold text-gray-800">
                  Include Purchase Price (Cost)
                </span>
                <span className="text-[10px] text-gray-400 font-normal">
                  (Uncheck when printing for customers/staff)
                </span>
              </label>
            ) : (
              <p className="text-[11px] text-gray-400 italic">
                🔒 Purchase Cost is restricted to Admin/Manager roles.
              </p>
            )}

            <label className="flex items-center gap-2.5 cursor-pointer text-xs select-none">
              <input
                type="checkbox"
                checked={showImei2}
                onChange={e => setShowImei2(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded border-gray-300"
              />
              <span className="font-medium text-gray-800">
                Include IMEI 2 (Secondary SIM)
              </span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer text-xs select-none">
              <input
                type="checkbox"
                checked={showSummary}
                onChange={e => setShowSummary(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded border-gray-300"
              />
              <span className="font-medium text-gray-800">
                Include Inventory Valuation Summary Box
              </span>
            </label>
          </div>

          {/* Quick Metrics Preview */}
          <div className="grid grid-cols-3 gap-2 bg-blue-50/50 p-3 rounded-xl border border-blue-100 text-center">
            <div>
              <p className="text-[10px] font-bold uppercase text-gray-500">Units</p>
              <p className="text-base font-black text-gray-900">{totalCount}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-emerald-600">PTA Approved</p>
              <p className="text-base font-black text-emerald-700">{ptaCount}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-rose-600">Non-PTA</p>
              <p className="text-base font-black text-rose-700">{nonPtaCount}</p>
            </div>
          </div>

          {/* WhatsApp sharing optional drawer */}
          {showWaInput ? (
            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 space-y-2">
              <label className="block text-xs font-bold text-emerald-900">
                Supplier / Customer WhatsApp Number (Optional)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={waPhone}
                  onChange={e => setWaPhone(e.target.value)}
                  placeholder="03001234567"
                  className="flex-1 px-3 py-1.5 text-xs border border-emerald-300 rounded-lg outline-none bg-white font-medium"
                />
                <button
                  type="button"
                  onClick={handleShareWA}
                  disabled={loadingAction === 'wa'}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-60"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  {loadingAction === 'wa' ? 'Sharing...' : 'Send WA'}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-gray-50 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={() => setShowWaInput(!showWaInput)}
            className="px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 rounded-xl border border-emerald-200 transition flex items-center gap-1.5 cursor-pointer"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>WhatsApp</span>
          </button>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={handleDownloadPDF}
              disabled={loadingAction !== null || totalCount === 0}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
            >
              <FileText className="w-4 h-4" />
              <span>{loadingAction === 'pdf' ? 'Generating PDF...' : 'Download PDF'}</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              disabled={loadingAction !== null || totalCount === 0}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-blue-500/20 cursor-pointer disabled:opacity-50"
            >
              <Printer className="w-4 h-4" />
              <span>{loadingAction === 'print' ? 'Preparing...' : 'Print Report'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
