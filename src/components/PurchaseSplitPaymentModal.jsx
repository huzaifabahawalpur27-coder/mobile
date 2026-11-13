import React, { useState, useEffect, useMemo } from 'react'
import { X, Plus, Trash2, Landmark, Wallet, DollarSign, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react'
import { PAKISTANI_PAYMENT_PROVIDERS } from '../utils/paymentMethods'
import { isCashName } from '../utils/moneyMath'

export default function PurchaseSplitPaymentModal({
  isOpen,
  onClose,
  total = 0,
  payments = [],
  onSave,
  bankAccounts = [],
  onAddNewBank
}) {
  const [localPayments, setLocalPayments] = useState([])
  const [validationError, setValidationError] = useState('')

  const cashAccounts = useMemo(() => {
    return bankAccounts.filter(a =>
      isCashName(a.bank_name) ||
      isCashName(a.account_name) ||
      a.account_number === 'CASH'
    )
  }, [bankAccounts])

  const bankOnlyAccounts = useMemo(() => {
    return bankAccounts.filter(a =>
      !isCashName(a.bank_name) &&
      !isCashName(a.account_name) &&
      a.account_number !== 'CASH'
    )
  }, [bankAccounts])

  // Initialize modal state on open
  useEffect(() => {
    if (!isOpen) return
    setValidationError('')

    if (Array.isArray(payments) && payments.length > 0) {
      setLocalPayments(
        payments.map(p => ({
          method: p.method || 'cash',
          provider: p.provider || null,
          amount: p.amount !== undefined && p.amount !== null ? String(p.amount) : '',
          ref: p.ref || '',
          account_id: p.account_id ? String(p.account_id) : ''
        }))
      )
    } else {
      // Default to 1 cash tender with full amount
      const defCash = cashAccounts.find(c => c.is_default) || cashAccounts[0]
      setLocalPayments([
        {
          method: 'cash',
          provider: null,
          amount: total > 0 ? String(total) : '',
          ref: '',
          account_id: defCash ? String(defCash.id) : ''
        }
      ])
    }
  }, [isOpen, payments, total, cashAccounts])

  if (!isOpen) return null

  const totalBill = Math.max(0, Number(total) || 0)
  const currentPaid = localPayments.reduce((sum, p) => sum + Math.max(0, parseFloat(p.amount) || 0), 0)
  const remaining = totalBill - currentPaid

  const handleMethodChange = (index, rawValue) => {
    setLocalPayments(prev => {
      const updated = [...prev]
      const current = { ...updated[index] }

      if (rawValue.startsWith('linked_bank_')) {
        const accId = rawValue.replace('linked_bank_', '')
        const acc = bankOnlyAccounts.find(a => String(a.id) === accId)
        current.method = 'bank'
        current.account_id = accId
        current.provider = acc?.bank_name?.toLowerCase() || 'bank'
      } else if (rawValue.startsWith('linked_cash_')) {
        const accId = rawValue.replace('linked_cash_', '')
        current.method = 'cash'
        current.account_id = accId
        current.provider = null
      } else if (rawValue === 'cash') {
        const defCash = cashAccounts[0]
        current.method = 'cash'
        current.account_id = defCash ? String(defCash.id) : ''
        current.provider = null
      } else {
        // Specific provider / wallet / bank like 'jazzcash', 'meezan', etc.
        current.method = rawValue
        current.provider = rawValue
        // Check if an existing bank account matches this provider
        const matched = bankAccounts.find(a =>
          (a.bank_name || '').toLowerCase().includes(rawValue) ||
          (a.account_name || '').toLowerCase().includes(rawValue)
        )
        current.account_id = matched ? String(matched.id) : ''
      }

      updated[index] = current
      return updated
    })
  }

  const handleAmountChange = (index, value) => {
    setLocalPayments(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], amount: value }
      return updated
    })
    setValidationError('')
  }

  const handleRefChange = (index, value) => {
    setLocalPayments(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], ref: value }
      return updated
    })
  }

  const handleAddPayment = () => {
    const unallocated = Math.max(0, remaining)
    const defBank = bankOnlyAccounts.find(b => b.is_default) || bankOnlyAccounts[0]

    // Default new line to bank or next available method
    const newLine = defBank
      ? {
          method: 'bank',
          provider: defBank.bank_name?.toLowerCase() || 'bank',
          amount: unallocated > 0 ? String(unallocated) : '',
          ref: '',
          account_id: String(defBank.id)
        }
      : {
          method: 'jazzcash',
          provider: 'jazzcash',
          amount: unallocated > 0 ? String(unallocated) : '',
          ref: '',
          account_id: ''
        }

    setLocalPayments(prev => [...prev, newLine])
    setValidationError('')
  }

  const handleRemovePayment = (index) => {
    if (localPayments.length <= 1) return
    setLocalPayments(prev => prev.filter((_, i) => i !== index))
  }

  // Quick split 50/50 helper
  const handleSplitFiftyFifty = () => {
    if (totalBill <= 0) return
    const half1 = Math.round(totalBill / 2)
    const half2 = totalBill - half1

    const defCash = cashAccounts[0]
    const defBank = bankOnlyAccounts.find(b => b.is_default) || bankOnlyAccounts[0]

    const newRows = [
      {
        method: 'cash',
        provider: null,
        amount: String(half1),
        ref: '',
        account_id: defCash ? String(defCash.id) : ''
      },
      {
        method: 'bank',
        provider: defBank?.bank_name?.toLowerCase() || 'bank',
        amount: String(half2),
        ref: '',
        account_id: defBank ? String(defBank.id) : ''
      }
    ]
    setLocalPayments(newRows)
    setValidationError('')
  }

  const handleFullCash = () => {
    const defCash = cashAccounts[0]
    setLocalPayments([
      {
        method: 'cash',
        provider: null,
        amount: totalBill > 0 ? String(totalBill) : '',
        ref: '',
        account_id: defCash ? String(defCash.id) : ''
      }
    ])
    setValidationError('')
  }

  const handleFullBank = () => {
    const defBank = bankOnlyAccounts.find(b => b.is_default) || bankOnlyAccounts[0]
    setLocalPayments([
      {
        method: 'bank',
        provider: defBank?.bank_name?.toLowerCase() || 'bank',
        amount: totalBill > 0 ? String(totalBill) : '',
        ref: '',
        account_id: defBank ? String(defBank.id) : ''
      }
    ])
    setValidationError('')
  }

  const handleSave = () => {
    // Validate rows
    const validRows = localPayments.filter(p => {
      const amt = parseFloat(p.amount)
      return !isNaN(amt) && amt > 0
    })

    if (validRows.length === 0) {
      setValidationError('Please enter an amount for at least one payment method.')
      return
    }

    if (remaining < -0.01) {
      setValidationError(`Total split payments (Rs. ${currentPaid.toLocaleString()}) exceed the total bill (Rs. ${totalBill.toLocaleString()}) by Rs. ${Math.abs(remaining).toLocaleString()}.`)
      return
    }

    const sanitized = validRows.map(p => {
      const acc = bankAccounts.find(a => String(a.id) === String(p.account_id))
      return {
        method: p.method,
        provider: p.provider || (p.method !== 'cash' ? p.method : null),
        amount: parseFloat(p.amount),
        ref: p.ref?.trim() || null,
        account_id: p.account_id ? Number(p.account_id) : (acc ? acc.id : null),
        account_name: acc?.account_name || (p.method === 'cash' ? 'Cash in Hand' : p.method),
        bank_name: acc?.bank_name || null
      }
    })

    onSave(sanitized)
    onClose()
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-2 sm:p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-lg flex flex-col max-h-[92vh] overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0 bg-gradient-to-r from-purple-50/80 via-white to-blue-50/80">
          <div>
            <h2 className="text-base sm:text-lg font-black text-gray-900 flex items-center gap-2">
              <span className="p-1 rounded-lg bg-purple-600 text-white text-xs">🔀</span>
              <span>Split Payment Breakdown</span>
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Distribute purchase across cash vaults, bank accounts, or supplier credit.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Helper Presets */}
        <div className="px-5 py-2.5 bg-gray-50/80 border-b border-gray-100 flex items-center justify-between gap-2 overflow-x-auto text-xs shrink-0">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider shrink-0">
            Quick Split:
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleSplitFiftyFifty}
              className="px-2 py-1 bg-white hover:bg-purple-50 text-purple-700 border border-purple-200 rounded-md text-xs font-bold transition flex items-center gap-1 cursor-pointer"
            >
              ⚡ 50/50 Cash & Bank
            </button>
            <button
              type="button"
              onClick={handleFullCash}
              className="px-2 py-1 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-xs font-bold transition flex items-center gap-1 cursor-pointer"
            >
              💵 100% Cash
            </button>
            <button
              type="button"
              onClick={handleFullBank}
              className="px-2 py-1 bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 rounded-md text-xs font-bold transition flex items-center gap-1 cursor-pointer"
            >
              🏦 100% Bank
            </button>
          </div>
        </div>

        {/* Modal Body / Payment Tenders */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-3 flex-1 custom-scrollbar">
          {validationError && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{validationError}</span>
            </div>
          )}

          <div className="space-y-3">
            {localPayments.map((p, idx) => {
              // Determine current select value
              let selectVal = p.method
              if (p.account_id) {
                const isCashAcc = cashAccounts.some(c => String(c.id) === String(p.account_id))
                selectVal = isCashAcc ? `linked_cash_${p.account_id}` : `linked_bank_${p.account_id}`
              }

              return (
                <div
                  key={idx}
                  className="p-3 rounded-xl border border-gray-200 bg-white hover:border-purple-300 transition shadow-2xs space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                      Tender #{idx + 1}
                    </span>
                    {localPayments.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemovePayment(idx)}
                        className="text-gray-500 hover:text-red-600 p-1 rounded-md hover:bg-red-50 transition cursor-pointer"
                        title="Remove tender"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    {/* Method Dropdown */}
                    <div className="sm:col-span-7">
                      <select
                        value={selectVal}
                        onChange={e => handleMethodChange(idx, e.target.value)}
                        className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-xs font-bold outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-200 bg-gray-50/50 cursor-pointer text-slate-800"
                      >
                        {/* Cash Drawers */}
                        <optgroup label="💵 Cash in Hand & Vaults">
                          {cashAccounts.length > 0 ? (
                            cashAccounts.map(c => (
                              <option key={c.id} value={`linked_cash_${c.id}`}>
                                💵 {c.account_name} (Rs. {Number(c.current_balance || 0).toLocaleString()})
                              </option>
                            ))
                          ) : (
                            <option value="cash">💵 Cash in Hand</option>
                          )}
                        </optgroup>

                        {/* Linked Business Bank Accounts */}
                        {bankOnlyAccounts.length > 0 && (
                          <optgroup label="🏦 Linked Bank Accounts">
                            {bankOnlyAccounts.map(b => (
                              <option key={b.id} value={`linked_bank_${b.id}`}>
                                🏦 {b.bank_name ? `${b.bank_name} - ` : ''}{b.account_name} (Rs. {Number(b.current_balance || 0).toLocaleString()}) {b.is_default ? '★' : ''}
                              </option>
                            ))}
                          </optgroup>
                        )}

                        {/* Mobile Wallets & FinTech */}
                        <optgroup label="📱 Mobile Wallets & FinTech">
                          <option value="jazzcash">📱 JazzCash Wallet</option>
                          <option value="easypaisa">🟢 Easypaisa Wallet</option>
                          <option value="sadapay">💳 SadaPay</option>
                          <option value="nayapay">🟣 NayaPay</option>
                        </optgroup>

                        {/* Commercial Pakistani Banks */}
                        <optgroup label="🏛️ Pakistani Banks & Transfers">
                          <option value="meezan">🏦 Meezan Bank</option>
                          <option value="hbl">🏦 HBL (Habib Bank)</option>
                          <option value="ubl">🏦 UBL (United Bank)</option>
                          <option value="mcb">🏦 MCB Bank</option>
                          <option value="abl">🏦 Allied Bank (ABL)</option>
                          <option value="alfalah">🏦 Bank Alfalah</option>
                          <option value="faysal">🏦 Faysal Bank</option>
                          <option value="bop">🏦 Bank of Punjab (BOP)</option>
                          <option value="askari">🏦 Askari Bank</option>
                          <option value="bank">🏛️ Bank Transfer / Raast</option>
                        </optgroup>
                      </select>
                    </div>

                    {/* Amount Input */}
                    <div className="sm:col-span-5 relative">
                      <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-500 text-xs font-bold">
                        Rs.
                      </div>
                      <input aria-label="0.00"
                        type="number"
                        step="any"
                        min="0"
                        placeholder="0.00"
                        value={p.amount}
                        onChange={e => handleAmountChange(idx, e.target.value)}
                        className="w-full pl-8 pr-2.5 py-2 border border-gray-300 rounded-lg text-xs font-black text-right outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-200 text-slate-900 bg-white"
                      />
                    </div>
                  </div>

                  {/* Reference / Transaction ID / Slip # */}
                  <div>
                    <input aria-label="Cheque / TID / Raast Ref / Slip No (optional)"
                      type="text"
                      placeholder="Cheque # / TID / Raast Ref / Slip No (optional)"
                      value={p.ref || ''}
                      onChange={e => handleRefChange(idx, e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs outline-none focus:border-purple-400 bg-gray-50/30 placeholder:text-gray-400"
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Add Payment Row Button */}
          <div className="pt-1 flex items-center justify-between">
            <button
              type="button"
              onClick={handleAddPayment}
              className="py-2 px-3 border border-dashed border-purple-300 hover:border-purple-500 bg-purple-50/50 hover:bg-purple-100/50 text-purple-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Add Another Payment Method</span>
            </button>

            {onAddNewBank && (
              <button
                type="button"
                onClick={onAddNewBank}
                className="text-xs text-blue-600 hover:text-blue-800 font-semibold hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Landmark className="w-3 h-3" />
                <span>+ Link New Bank Account</span>
              </button>
            )}
          </div>
        </div>

        {/* Modal Footer & Settlement Summary */}
        <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/90 shrink-0 space-y-3">
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between items-center text-gray-600">
              <span>Total Purchase Bill:</span>
              <span className="font-bold text-gray-900 tabular-nums">
                Rs. {totalBill.toLocaleString()}
              </span>
            </div>

            <div className="flex justify-between items-center text-gray-600">
              <span>Total Paid via Tenders:</span>
              <span className="font-black text-emerald-600 tabular-nums">
                Rs. {currentPaid.toLocaleString()}
              </span>
            </div>

            <div className="pt-1 border-t border-gray-200 flex justify-between items-center text-xs font-bold">
              <span>Remaining Balance:</span>
              {remaining > 0 ? (
                <div className="text-right">
                  <span className="text-orange-600 tabular-nums font-black">
                    Rs. {remaining.toLocaleString()}
                  </span>
                  <span className="block text-xs text-orange-500 font-medium">
                    (Will be added to supplier's Credit / Udhaar)
                  </span>
                </div>
              ) : remaining === 0 ? (
                <span className="text-emerald-700 flex items-center gap-1 font-black">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Fully Settled (100%)
                </span>
              ) : (
                <span className="text-red-600 font-black">
                  Overpaid by Rs. {Math.abs(remaining).toLocaleString()}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-4 rounded-xl border border-gray-300 text-gray-700 text-xs font-bold hover:bg-gray-100 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex-2 py-2 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition shadow-sm hover:shadow flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>Apply Split Payment</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
