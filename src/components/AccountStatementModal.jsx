import { useEffect, useId, useMemo, useState } from 'react'
import { getBankStatement, checkBankBalances } from '../services/bankService'
import { buildDayBook } from '../utils/moneyMath'

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const daysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const rs = (n) => `Rs. ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
const kindLabel = (k) => String(k || 'manual').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

/**
 * Accounts > Statement & Day Book.
 *   Statement    entries for a date range / account / direction, with totals and Excel export
 *   Day book     per account: opening, money in and out by kind, closing
 *   Check        each account's balance against what its statement adds up to
 */
export default function AccountStatementModal({ isOpen, onClose, shopId, accounts = [], initialAccountId = '' }) {
  const fromId = useId()
  const toId = useId()
  const accountSelId = useId()
  const dirId = useId()
  const [tab, setTab] = useState('statement')
  const [from, setFrom] = useState(todayStr())
  const [to, setTo] = useState(todayStr())
  const [accountId, setAccountId] = useState('')
  const [direction, setDirection] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [check, setCheck] = useState(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setAccountId(initialAccountId ? String(initialAccountId) : '')
      setCheck(null)
    }
  }, [isOpen, initialAccountId])

  useEffect(() => {
    if (!isOpen || !shopId) return
    let cancelled = false
    setLoading(true)
    // The day book always covers every account and both directions for the period
    const filters = tab === 'daybook' ? { accountId: null, direction: null } : { accountId: accountId || null, direction: direction || null }
    getBankStatement({ shopId, from, to, ...filters })
      .then(list => { if (!cancelled) setRows(list) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [isOpen, shopId, from, to, accountId, direction, tab])

  const accountName = (id) => {
    const a = accounts.find(x => String(x.id) === String(id))
    return a ? (a.bank_name && a.bank_name !== a.account_name ? `${a.account_name} (${a.bank_name})` : a.account_name) : `Account #${id}`
  }

  const totals = useMemo(() => rows.reduce((t, tx) => {
    if (tx.transaction_type === 'CREDIT') t.in += tx.amount
    else t.out += tx.amount
    return t
  }, { in: 0, out: 0 }), [rows])

  const dayBook = useMemo(() => (tab === 'daybook' ? buildDayBook(rows, accounts) : []), [tab, rows, accounts])

  const setRange = (f, t) => { setFrom(f); setTo(t) }

  const exportExcel = async () => {
    const XLSX = await import('xlsx')
    const data = rows.map(tx => ({
      Date: new Date(tx.created_at).toLocaleString(),
      Account: accountName(tx.account_id),
      Type: kindLabel(tx.reference_type),
      Description: tx.description || '',
      'Money In': tx.transaction_type === 'CREDIT' ? tx.amount : '',
      'Money Out': tx.transaction_type === 'CREDIT' ? '' : tx.amount,
      'Balance After': tx.balance_after
    }))
    data.push({ Date: 'TOTAL', 'Money In': totals.in, 'Money Out': totals.out })
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Statement')
    XLSX.writeFile(wb, `account-statement-${from}-to-${to}.xlsx`)
  }

  const runCheck = async () => {
    setChecking(true)
    setCheck(await checkBankBalances())
    setChecking(false)
  }

  if (!isOpen) return null

  const tabBtn = (key, label) => (
    <button type="button" onClick={() => setTab(key)} aria-pressed={tab === key}
      className={`px-3 py-2 rounded-lg text-xs font-bold transition ${tab === key ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true" aria-label="Statement and day book">
      <div className="flex w-full max-w-4xl max-h-[92dvh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-base font-extrabold text-gray-900">Statement &amp; Day Book</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-xl font-bold text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="space-y-3 border-b border-gray-100 px-5 py-3">
          <div className="flex flex-wrap gap-2">
            {tabBtn('statement', 'Statement')}
            {tabBtn('daybook', 'Day Book')}
            {tabBtn('check', 'Check Balances')}
          </div>

          {tab !== 'check' && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div>
                <label htmlFor={fromId} className="mb-1 block text-[10px] font-bold uppercase text-gray-500">From</label>
                <input id={fromId} type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-2 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label htmlFor={toId} className="mb-1 block text-[10px] font-bold uppercase text-gray-500">To</label>
                <input id={toId} type="date" value={to} min={from} onChange={e => setTo(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-2 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {tab === 'statement' && (
                <>
                  <div>
                    <label htmlFor={accountSelId} className="mb-1 block text-[10px] font-bold uppercase text-gray-500">Account</label>
                    <select id={accountSelId} value={accountId} onChange={e => setAccountId(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-2 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">All accounts</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{accountName(a.id)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={dirId} className="mb-1 block text-[10px] font-bold uppercase text-gray-500">Show</label>
                    <select id={dirId} value={direction} onChange={e => setDirection(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-2 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">Money in and out</option>
                      <option value="in">Money in only</option>
                      <option value="out">Money out only</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          )}

          {tab !== 'check' && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button type="button" onClick={() => setRange(todayStr(), todayStr())} className="rounded-full bg-gray-100 px-3 py-1.5 font-bold text-gray-700 hover:bg-gray-200">Today</button>
              <button type="button" onClick={() => setRange(daysAgo(1), daysAgo(1))} className="rounded-full bg-gray-100 px-3 py-1.5 font-bold text-gray-700 hover:bg-gray-200">Yesterday</button>
              <button type="button" onClick={() => setRange(daysAgo(6), todayStr())} className="rounded-full bg-gray-100 px-3 py-1.5 font-bold text-gray-700 hover:bg-gray-200">Last 7 days</button>
              <button type="button" onClick={() => setRange(`${todayStr().slice(0, 8)}01`, todayStr())} className="rounded-full bg-gray-100 px-3 py-1.5 font-bold text-gray-700 hover:bg-gray-200">This month</button>
              {tab === 'statement' && rows.length > 0 && (
                <button type="button" onClick={exportExcel} className="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-700">Export Excel</button>
              )}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-xs">
          {tab === 'statement' && (
            loading ? <p className="py-8 text-center text-gray-500">Loading…</p>
              : rows.length === 0 ? <p className="py-8 text-center text-gray-500">No entries for this period.</p>
                : (
                  <>
                    <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-emerald-50 p-2"><p className="text-[10px] font-bold uppercase text-emerald-700">Money in</p><p className="font-black text-emerald-800">{rs(totals.in)}</p></div>
                      <div className="rounded-lg bg-rose-50 p-2"><p className="text-[10px] font-bold uppercase text-rose-700">Money out</p><p className="font-black text-rose-800">{rs(totals.out)}</p></div>
                      <div className="rounded-lg bg-gray-100 p-2"><p className="text-[10px] font-bold uppercase text-gray-600">Net</p><p className="font-black text-gray-900">{rs(totals.in - totals.out)}</p></div>
                    </div>
                    <ul className="divide-y divide-gray-100">
                      {rows.slice().reverse().map(tx => {
                        const isIn = tx.transaction_type === 'CREDIT'
                        return (
                          <li key={tx.id} className="flex items-start justify-between gap-3 py-2.5">
                            <div className="min-w-0">
                              <p className="font-bold text-gray-900 break-words">{tx.description || kindLabel(tx.reference_type)}</p>
                              <p className="text-[11px] text-gray-500">{accountName(tx.account_id)} • {kindLabel(tx.reference_type)} • {new Date(tx.created_at).toLocaleString()}</p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className={`font-black ${isIn ? 'text-emerald-700' : 'text-rose-700'}`}>{isIn ? '+' : '-'}{rs(tx.amount)}</p>
                              <p className="text-[11px] text-gray-500">Balance {rs(tx.balance_after)}</p>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )
          )}

          {tab === 'daybook' && (
            loading ? <p className="py-8 text-center text-gray-500">Loading…</p>
              : dayBook.length === 0 ? <p className="py-8 text-center text-gray-500">No accounts yet.</p>
                : (
                  <div className="space-y-3">
                    {dayBook.map(acc => {
                      const drift = Math.abs(acc.expectedClosing - acc.closing) >= 0.01
                      return (
                        <div key={acc.account_id} className={`rounded-xl border p-3 ${acc.idle ? 'border-gray-100 bg-gray-50' : 'border-gray-200'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-extrabold text-gray-900">{acc.name}{acc.bank && acc.bank !== acc.name ? <span className="font-medium text-gray-500"> · {acc.bank}</span> : null}</p>
                            <p className="text-[11px] text-gray-500">{acc.entries} {acc.entries === 1 ? 'entry' : 'entries'}</p>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                            <div><p className="text-[10px] font-bold uppercase text-gray-500">Opening</p><p className="font-bold text-gray-900">{rs(acc.opening)}</p></div>
                            <div><p className="text-[10px] font-bold uppercase text-emerald-700">Money in</p><p className="font-bold text-emerald-800">{rs(acc.moneyIn)}</p></div>
                            <div><p className="text-[10px] font-bold uppercase text-rose-700">Money out</p><p className="font-bold text-rose-800">{rs(acc.moneyOut)}</p></div>
                            <div><p className="text-[10px] font-bold uppercase text-gray-500">Closing</p><p className="font-black text-gray-900">{rs(acc.closing)}</p></div>
                          </div>
                          {Object.keys(acc.kinds).length > 0 && (
                            <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2">
                              {Object.entries(acc.kinds).map(([kind, v]) => (
                                <li key={kind} className="flex justify-between gap-2 text-gray-700">
                                  <span>{kindLabel(kind)}</span>
                                  <span className="font-semibold">
                                    {v.in > 0 && <span className="text-emerald-700">+{rs(v.in)}</span>}
                                    {v.in > 0 && v.out > 0 && ' / '}
                                    {v.out > 0 && <span className="text-rose-700">-{rs(v.out)}</span>}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {drift && (
                            <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 font-semibold text-amber-800">
                              Opening + in − out = {rs(acc.expectedClosing)}, but the last entry shows {rs(acc.closing)}. Use “Check Balances”.
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
          )}

          {tab === 'check' && (
            <div className="space-y-3">
              <p className="text-gray-600">Compares each account’s balance with what its own entries add up to (opening balance + money in − money out).</p>
              <button type="button" onClick={runCheck} disabled={checking} className="rounded-lg bg-blue-600 px-4 py-2.5 font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                {checking ? 'Checking…' : 'Check now'}
              </button>
              {check && !check.ok && <p className="rounded-lg bg-amber-50 px-3 py-2 font-semibold text-amber-800">{check.error}</p>}
              {check?.ok && (
                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                  {check.rows.length === 0 && <li className="p-3 text-gray-500">No accounts yet.</li>}
                  {check.rows.map(r => {
                    const good = Math.abs(r.difference) < 0.01
                    return (
                      <li key={r.account_id} className="flex items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="font-bold text-gray-900">{r.account_name}</p>
                          <p className="text-[11px] text-gray-500">Balance {rs(r.stored_balance)} • Entries add up to {rs(r.statement_balance)}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 font-bold ${good ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                          {good ? 'Matches' : `Off by ${rs(r.difference)}`}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
              {check?.ok && check.rows.some(r => Math.abs(r.difference) >= 0.01) && (
                <p className="text-gray-600">An account that is “off” had a balance change without an entry (or an entry without a balance change) at some point. Correct it with a Deposit or Withdrawal of the difference, noting the reason.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
