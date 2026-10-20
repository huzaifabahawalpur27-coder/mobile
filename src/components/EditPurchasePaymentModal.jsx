import React, { useState, useEffect } from 'react'
import { X, CreditCard, Landmark, Banknote, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { getBankAccounts } from '../services/bankService'
import { updatePurchasePaymentMethod } from '../services/purchaseService'

export default function EditPurchasePaymentModal({
  isOpen,
  onClose,
  purchase,
  onUpdated
}) {
  const { user } = useAuth()
  const [newMethod, setNewMethod] = useState('cash')
  const [bankAccounts, setBankAccounts] = useState([])
  const [selectedBankId, setSelectedBankId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const currentMethod = (purchase?.payment_type || purchase?.payment_method || 'cash').toLowerCase()
  const totalAmount = Number(purchase?.total_amount || purchase?.net_amount || 0)
  const supplierName = purchase?.suppliers?.name || 'Supplier'

  useEffect(() => {
    if (purchase) {
      setNewMethod(currentMethod)
      setNotes('')
      setErrorMsg('')
    }
  }, [purchase, currentMethod])

  useEffect(() => {
    if (user?.shop_id && isOpen) {
      getBankAccounts(user.shop_id).then(list => {
        setBankAccounts(list || [])
        const def = (list || []).find(b => b.is_default) || (list || [])[0]
        if (def) setSelectedBankId(String(def.id))
      }).catch(() => {})
    }
  }, [user?.shop_id, isOpen])

  if (!isOpen || !purchase) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (newMethod === currentMethod) {
      onClose()
      return
    }
    if (newMethod === 'bank' && !selectedBankId) {
      setErrorMsg('Please select a bank account for Bank Payment.')
      return
    }

    setSaving(true)
    setErrorMsg('')
    try {
      await updatePurchasePaymentMethod({
        purchaseId: purchase.id,
        newPaymentMethod: newMethod,
        bankAccountId: newMethod === 'bank' ? selectedBankId : null,
        notes: notes.trim(),
        user
      })
      alert(`Payment method for PR-${String(purchase.id).slice(-6)} successfully changed to ${newMethod.toUpperCase()}!`)
      if (onUpdated) onUpdated()
      onClose()
    } catch (err) {
      setErrorMsg(err.message || 'Failed to update payment method')
    } finally {
      setSaving(false)
    }
  }

  // Financial preview calculation
  let financialSummary = ''
  if (currentMethod === 'credit' && (newMethod === 'cash' || newMethod === 'bank')) {
    financialSummary = `Supplier debt will decrease by Rs. ${totalAmount.toLocaleString()} (marked as paid via ${newMethod.toUpperCase()}).`
  } else if ((currentMethod === 'cash' || currentMethod === 'bank') && newMethod === 'credit') {
    financialSummary = `Supplier debt will increase by Rs. ${totalAmount.toLocaleString()} (converted to credit payable).`
  } else if (currentMethod !== newMethod) {
    financialSummary = `Payment source will be switched from ${currentMethod.toUpperCase()} to ${newMethod.toUpperCase()}.`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-100 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-slate-900 to-blue-900 text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
              <CreditCard className="w-4 h-4 text-blue-200" />
            </div>
            <div>
              <h2 className="text-sm font-black tracking-tight">Edit Payment Method</h2>
              <p className="text-[11px] text-blue-200">Purchase PR-{String(purchase.id).slice(-8)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Bill Info */}
          <div className="bg-gray-50 p-3 rounded-xl border border-gray-200/80 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-gray-500 font-bold uppercase">Supplier</p>
              <p className="text-xs font-bold text-gray-800">{supplierName}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-gray-500 font-bold uppercase">Total Bill</p>
              <p className="text-sm font-black text-blue-700">Rs. {totalAmount.toLocaleString()}</p>
            </div>
          </div>

          {/* Current vs New Method */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">
              Select New Payment Method
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setNewMethod('cash')}
                className={`p-2.5 rounded-xl border text-center transition cursor-pointer flex flex-col items-center gap-1 ${
                  newMethod === 'cash'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-600 font-bold'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                }`}
              >
                <Banknote className="w-4 h-4 text-emerald-600" />
                <span>Cash Paid</span>
              </button>

              <button
                type="button"
                onClick={() => setNewMethod('bank')}
                className={`p-2.5 rounded-xl border text-center transition cursor-pointer flex flex-col items-center gap-1 ${
                  newMethod === 'bank'
                    ? 'border-blue-600 bg-blue-50 text-blue-900 ring-1 ring-blue-600 font-bold'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                }`}
              >
                <Landmark className="w-4 h-4 text-blue-600" />
                <span>Bank Transfer</span>
              </button>

              <button
                type="button"
                onClick={() => setNewMethod('credit')}
                className={`p-2.5 rounded-xl border text-center transition cursor-pointer flex flex-col items-center gap-1 ${
                  newMethod === 'credit'
                    ? 'border-amber-600 bg-amber-50 text-amber-900 ring-1 ring-amber-600 font-bold'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                }`}
              >
                <CreditCard className="w-4 h-4 text-amber-600" />
                <span>Credit (Udhaar)</span>
              </button>
            </div>
          </div>

          {/* Bank Account Selection if Bank */}
          {newMethod === 'bank' && (
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Select Shop Bank Account *
              </label>
              <select
                value={selectedBankId}
                onChange={e => setSelectedBankId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl bg-white font-semibold text-xs outline-none focus:ring-2 focus:ring-blue-500"
              >
                {bankAccounts.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.bank_name ? `${b.bank_name} - ` : ''}{b.account_name} (Balance: Rs. {Number(b.current_balance || 0).toLocaleString()})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Financial Impact Alert */}
          {financialSummary && (
            <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl text-blue-900 flex items-start gap-2 text-[11px]">
              <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Automated Financial Adjustment:</p>
                <p className="mt-0.5">{financialSummary}</p>
              </div>
            </div>
          )}

          {/* Reason / Notes */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              Adjustment Reason / Note (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Paid cash at shop counter"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Action Buttons */}
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
              disabled={saving || newMethod === currentMethod}
              className="flex-1 py-2.5 rounded-xl font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:opacity-50 transition cursor-pointer"
            >
              {saving ? 'Updating...' : 'Save & Adjust Balance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
