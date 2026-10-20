import React, { useState, useEffect } from 'react'
import { X, RotateCcw, AlertCircle, Landmark, Banknote, FileSpreadsheet, ShieldAlert } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { getBankAccounts } from '../services/bankService'
import { returnPhoneToSupplier } from '../services/purchaseService'

export default function PhoneReturnModal({
  isOpen,
  onClose,
  phone,
  onReturned
}) {
  const { user } = useAuth()
  const [reason, setReason] = useState('Defective / Hardware Fault')
  const [customReason, setCustomReason] = useState('')
  const [settlementType, setSettlementType] = useState('credit_adjustment')
  const [bankAccounts, setBankAccounts] = useState([])
  const [selectedBankId, setSelectedBankId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const costPrice = parseFloat(phone?.cost_price) || 0
  const supplierName = phone?.supplier_name || 'Supplier'

  useEffect(() => {
    if (user?.shop_id && isOpen) {
      getBankAccounts(user.shop_id).then(list => {
        setBankAccounts(list || [])
        const def = (list || []).find(b => b.is_default) || (list || [])[0]
        if (def) setSelectedBankId(String(def.id))
      }).catch(() => {})
      setReason('Defective / Hardware Fault')
      setCustomReason('')
      setSettlementType('credit_adjustment')
      setNotes('')
      setErrorMsg('')
    }
  }, [user?.shop_id, isOpen])

  if (!isOpen || !phone) return null

  const handleReturnSubmit = async (e) => {
    e.preventDefault()
    const finalReason = reason === 'Other' ? (customReason.trim() || 'Other Reason') : reason
    if (settlementType === 'bank_refund' && !selectedBankId) {
      setErrorMsg('Please select a bank account to receive the refund.')
      return
    }

    if (!confirm(`Are you sure you want to return ${phone.brand} ${phone.model} (IMEI: ${phone.imei_1}) to ${supplierName} for Rs. ${costPrice.toLocaleString()}?`)) {
      return
    }

    setSaving(true)
    setErrorMsg('')
    try {
      await returnPhoneToSupplier({
        phone,
        reason: finalReason,
        settlementType,
        bankAccountId: settlementType === 'bank_refund' ? selectedBankId : null,
        notes: notes.trim(),
        user
      })
      alert(`Phone ${phone.brand} ${phone.model} marked as RETURNED to supplier! Financial records adjusted. ✅`)
      if (onReturned) onReturned()
      onClose()
    } catch (err) {
      setErrorMsg(err.message || 'Failed to process phone return')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-gray-100 flex flex-col max-h-[92dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-red-900 to-rose-900 text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
              <RotateCcw className="w-4 h-4 text-rose-200" />
            </div>
            <div>
              <h2 className="text-sm font-black tracking-tight">Return Phone to Supplier (RMA)</h2>
              <p className="text-[11px] text-rose-200">Stock & Financial Balance Reversal</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleReturnSubmit} className="p-5 space-y-4 overflow-y-auto text-xs">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Device Summary Card */}
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-bold text-gray-900 text-sm">{phone.brand} {phone.model}</p>
                <p className="text-gray-500 text-[11px]">
                  {phone.storage} {phone.color ? `• ${phone.color}` : ''} • {phone.condition}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-gray-400 uppercase font-bold">Cost / Refund Value</p>
                <p className="text-base font-black text-rose-700">Rs. {costPrice.toLocaleString()}</p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-200/80 font-mono text-[11px]">
              <div>
                <span className="text-gray-400 font-sans mr-1">IMEI 1:</span>
                <span className="font-bold text-gray-800">{phone.imei_1}</span>
              </div>
              {phone.imei_2 && (
                <div>
                  <span className="text-gray-400 font-sans mr-1">IMEI 2:</span>
                  <span className="font-bold text-gray-800">{phone.imei_2}</span>
                </div>
              )}
            </div>

            {supplierName && (
              <div className="text-[11px] text-gray-600 pt-1">
                <span className="font-medium text-gray-500">Supplier:</span> <strong className="text-gray-900">{supplierName}</strong>
              </div>
            )}
          </div>

          {/* Reason Selection */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              Return Reason *
            </label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-xl bg-white font-semibold text-xs outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer"
            >
              <option value="Defective / Hardware Fault">⚠️ Defective / Hardware Fault (Display, Camera, Board)</option>
              <option value="Non-PTA / Patch Issue">📶 Non-PTA / Network / Patch Issue</option>
              <option value="Unsold Stock Return">📦 Unsold Stock Return (Dealer Agreement)</option>
              <option value="Wrong Model Delivered">🔄 Wrong Model / Storage Delivered</option>
              <option value="Customer Return / Warranty Claim">🛡️ Customer Return / Warranty Claim</option>
              <option value="Other">📝 Other Reason</option>
            </select>

            {reason === 'Other' && (
              <input
                type="text"
                placeholder="Specify return reason..."
                value={customReason}
                onChange={e => setCustomReason(e.target.value)}
                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-rose-500"
              />
            )}
          </div>

          {/* Settlement / Financial Refund Mode */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">
              Financial Settlement / Refund Method *
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setSettlementType('credit_adjustment')}
                className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                  settlementType === 'credit_adjustment'
                    ? 'border-rose-600 bg-rose-50 text-rose-900 ring-1 ring-rose-600 font-bold'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <FileSpreadsheet className="w-4 h-4 text-rose-600" />
                  <span className="text-xs">Credit Note</span>
                </div>
                <p className="text-[10px] text-gray-500 font-normal">Deduct from Supplier Udhaar</p>
              </button>

              <button
                type="button"
                onClick={() => setSettlementType('cash_refund')}
                className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                  settlementType === 'cash_refund'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-600 font-bold'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Banknote className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs">Cash Refund</span>
                </div>
                <p className="text-[10px] text-gray-500 font-normal">Supplier paid cash back</p>
              </button>

              <button
                type="button"
                onClick={() => setSettlementType('bank_refund')}
                className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                  settlementType === 'bank_refund'
                    ? 'border-blue-600 bg-blue-50 text-blue-900 ring-1 ring-blue-600 font-bold'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Landmark className="w-4 h-4 text-blue-600" />
                  <span className="text-xs">Bank Refund</span>
                </div>
                <p className="text-[10px] text-gray-500 font-normal">Supplier wired to Bank</p>
              </button>
            </div>
          </div>

          {/* Bank Account Selection if Bank Refund */}
          {settlementType === 'bank_refund' && (
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Deposit Into Bank Account *
              </label>
              <select
                value={selectedBankId}
                onChange={e => setSelectedBankId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl bg-white font-semibold text-xs outline-none focus:ring-2 focus:ring-blue-500"
              >
                {bankAccounts.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.bank_name ? `${b.bank_name} - ` : ''}{b.account_name} (Current: Rs. {Number(b.current_balance || 0).toLocaleString()})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Settlement Explanation */}
          <div className="p-3 bg-rose-50/70 border border-rose-200 rounded-xl text-rose-900 text-[11px] flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Financial Accounting Notice:</p>
              {settlementType === 'credit_adjustment' ? (
                <p className="mt-0.5">
                  Rs. {costPrice.toLocaleString()} will be deducted from {supplierName}'s balance. A return entry will be logged in their Khata.
                </p>
              ) : settlementType === 'cash_refund' ? (
                <p className="mt-0.5">
                  Rs. {costPrice.toLocaleString()} cash refund will be logged in the supplier ledger as returned.
                </p>
              ) : (
                <p className="mt-0.5">
                  Rs. {costPrice.toLocaleString()} will be deposited directly into your selected shop bank account.
                </p>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              Return Remarks / Condition Notes (Optional)
            </label>
            <textarea
              rows="2"
              placeholder="e.g. Sent back with rider, replacement promised next week"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-rose-500"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-sm disabled:opacity-50 transition cursor-pointer"
            >
              {saving ? 'Processing Return...' : `Confirm Return (Rs. ${costPrice.toLocaleString()})`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
