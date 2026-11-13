import { useEffect, useId, useState } from 'react'

/**
 * Correct the amount or note of a manual ledger entry (payment or debit) without
 * deleting and re-entering it. The caller applies the difference to the party's
 * balance and the cash / bank account.
 */
export default function EditLedgerEntryModal({ entry, title, preview, saving, onSave, onClose }) {
  const amountId = useId()
  const noteId = useId()
  const reasonId = useId()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (entry) {
      setAmount(String(Math.abs(Number(entry.amount) || 0)))
      setNote(entry.note || '')
      setReason('')
    }
  }, [entry])

  if (!entry) return null
  const newAmount = Number(amount)
  const valid = newAmount > 0 && reason.trim().length > 0
  const oldAmount = Math.abs(Number(entry.amount) || 0)

  const submit = (e) => {
    e.preventDefault()
    if (!valid || saving) return
    onSave({ amount: newAmount, note: note.trim(), reason: reason.trim() })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-base font-extrabold text-gray-900">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-xl font-bold text-gray-500 hover:text-gray-600">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-4 p-5 text-sm">
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            Saved amount: <strong>Rs. {oldAmount.toLocaleString()}</strong>
          </p>
          <div>
            <label htmlFor={amountId} className="mb-1 block text-xs font-bold text-gray-700">Correct amount (Rs.)</label>
            <input id={amountId} type="number" min="0.01" step="0.01" inputMode="decimal" autoFocus required
              value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base font-bold outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label htmlFor={noteId} className="mb-1 block text-xs font-bold text-gray-700">Note</label>
            <input id={noteId} type="text" value={note} onChange={e => setNote(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label htmlFor={reasonId} className="mb-1 block text-xs font-bold text-gray-700">Why is it being corrected?</label>
            <input id={reasonId} type="text" required value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. extra zero typed"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {newAmount > 0 && newAmount !== oldAmount && preview && (
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">{preview(newAmount - oldAmount)}</p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-300 py-2.5 font-bold text-gray-700 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={!valid || saving} className="flex-1 rounded-lg bg-blue-600 py-2.5 font-bold text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save correction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
