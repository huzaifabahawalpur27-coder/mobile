import { useState, useEffect, useId } from 'react'
import { supabase } from '../services/supabase'
import { db } from '../services/db'

export default function CashSessionModal({ isOpen, onClose, user, onSessionChange }) {
  const openingFloatId = useId()
  const openingNotesId = useId()
  const actualCashId = useId()
  const closingNotesId = useId()

  const [activeTab, setActiveTab] = useState('current') // 'current' | 'history'
  const [loading, setLoading] = useState(false)
  const [currentSession, setCurrentSession] = useState(null)
  const [sessionStats, setSessionStats] = useState({
    cashSales: 0,
    cashPayments: 0,
    cashExpenses: 0,
    salesCount: 0
  })

  // Open shift inputs
  const [openingCash, setOpeningCash] = useState('0')
  const [openingNotes, setOpeningNotes] = useState('')

  // Close shift inputs
  const [actualCash, setActualCash] = useState('')
  const [closingNotes, setClosingNotes] = useState('')
  const [sessionHistory, setSessionHistory] = useState([])

  const shopId = user?.shop_id

  useEffect(() => {
    if (!isOpen || !shopId) return
    loadActiveSession()
    loadSessionHistory()
  }, [isOpen, shopId])

  const loadActiveSession = async () => {
    setLoading(true)
    try {
      // 1. Try Supabase
      const { data, error } = await supabase
        .from('cash_sessions')
        .select('*')
        .eq('shop_id', shopId)
        .eq('user_id', user?.id)
        .eq('status', 'open')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!error && data) {
        setCurrentSession(data)
        await loadLiveStats(data)
        if (onSessionChange) onSessionChange(data)
      } else {
        // Fallback to Dexie
        const local = await db.cash_sessions
          ?.where('shop_id')
          .equals(shopId)
          .filter(s => s.status === 'open' && (s.user_id === user?.id || !user?.id))
          .last()

        if (local) {
          setCurrentSession(local)
          await loadLiveStats(local)
          if (onSessionChange) onSessionChange(local)
        } else {
          setCurrentSession(null)
          if (onSessionChange) onSessionChange(null)
        }
      }
    } catch (err) {
      console.warn('Error loading cash session:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadLiveStats = async (session) => {
    if (!session?.opened_at) return
    try {
      // Cash Sales during shift
      const { data: salesData } = await supabase
        .from('sales')
        .select('id, paid_amount, amount_paid, payment_method, payment_type')
        .eq('shop_id', shopId)
        .gte('created_at', session.opened_at)

      const cashSales = (salesData || [])
        .filter(s => (s.payment_method || s.payment_type || 'cash').toLowerCase() === 'cash')
        .reduce((sum, s) => sum + (Number(s.paid_amount || s.amount_paid) || 0), 0)

      // Cash payments from customers
      const { data: paymentsData } = await supabase
        .from('customer_payments')
        .select('amount')
        .eq('shop_id', shopId)
        .gte('created_at', session.opened_at)

      const cashPayments = (paymentsData || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0)

      // Cash expenses
      const { data: expensesData } = await supabase
        .from('expenses')
        .select('amount')
        .eq('shop_id', shopId)
        .gte('date', session.opened_at.split('T')[0])

      const cashExpenses = (expensesData || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0)

      setSessionStats({
        cashSales,
        cashPayments,
        cashExpenses,
        salesCount: (salesData || []).length
      })
    } catch (e) {
      console.warn('Could not load live stats:', e)
    }
  }

  const loadSessionHistory = async () => {
    try {
      const { data } = await supabase
        .from('cash_sessions')
        .select('*')
        .eq('shop_id', shopId)
        .order('id', { ascending: false })
        .limit(10)

      if (data) {
        setSessionHistory(data)
      } else {
        const local = await db.cash_sessions?.where('shop_id').equals(shopId).reverse().limit(10).toArray()
        if (local) setSessionHistory(local)
      }
    } catch (e) {
      console.warn('Failed to load session history:', e)
    }
  }

  const handleOpenShift = async (e) => {
    e.preventDefault()
    setLoading(true)
    const openingVal = parseFloat(openingCash) || 0

    try {
      // Call atomic RPC
      const { data: rpcRes, error } = await supabase.rpc('open_cash_session', {
        p_opening_cash: openingVal,
        p_notes: openingNotes || null
      })

      if (error) {
        // Fallback direct insert
        const newSession = {
          shop_id: shopId,
          branch_id: user?.branch_id || null,
          user_id: user?.id,
          opening_cash: openingVal,
          status: 'open',
          notes: openingNotes || null,
          opened_at: new Date().toISOString()
        }

        const { data: insertData, error: insErr } = await supabase
          .from('cash_sessions')
          .insert(newSession)
          .select()
          .single()

        if (insErr) {
          // Local Dexie fallback
          const localId = await db.cash_sessions?.add(newSession)
          const fallbackSession = { ...newSession, id: localId }
          setCurrentSession(fallbackSession)
          if (onSessionChange) onSessionChange(fallbackSession)
        } else {
          setCurrentSession(insertData)
          await db.cash_sessions?.put(insertData)
          if (onSessionChange) onSessionChange(insertData)
        }
      } else if (rpcRes?.success) {
        await loadActiveSession()
      } else {
        alert(rpcRes?.error || 'Failed to open session')
      }

      setOpeningCash('0')
      setOpeningNotes('')
    } catch (err) {
      alert('Error opening shift: ' + (err.message || 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  const handleCloseShift = async (e) => {
    e.preventDefault()
    if (!currentSession) return
    const actualVal = parseFloat(actualCash)
    if (isNaN(actualVal) || actualVal < 0) {
      alert('Please enter valid counted cash')
      return
    }

    const expectedCash = (Number(currentSession.opening_cash) || 0) + sessionStats.cashSales + sessionStats.cashPayments - sessionStats.cashExpenses
    const variance = actualVal - expectedCash

    const confirmMsg = `Confirm Close Shift?\nExpected: Rs. ${expectedCash.toLocaleString()}\nCounted: Rs. ${actualVal.toLocaleString()}\nVariance: Rs. ${variance > 0 ? '+' : ''}${variance.toLocaleString()}`
    if (!window.confirm(confirmMsg)) return

    setLoading(true)
    try {
      const { data: rpcRes, error } = await supabase.rpc('close_cash_session', {
        p_session_id: currentSession.id,
        p_closing_cash_actual: actualVal,
        p_notes: closingNotes || null
      })

      if (error) {
        // Fallback update
        const updatePayload = {
          status: 'closed',
          closing_cash_expected: expectedCash,
          closing_cash_actual: actualVal,
          variance,
          notes: closingNotes ? `${currentSession.notes || ''} [Closed: ${closingNotes}]` : currentSession.notes,
          closed_at: new Date().toISOString()
        }

        await supabase.from('cash_sessions').update(updatePayload).eq('id', currentSession.id)
        await db.cash_sessions?.update(currentSession.id, updatePayload)
      }

      alert(`Shift closed successfully!\nFinal Variance: Rs. ${variance.toLocaleString()}`)
      setCurrentSession(null)
      setActualCash('')
      setClosingNotes('')
      if (onSessionChange) onSessionChange(null)
      await loadSessionHistory()
    } catch (err) {
      alert('Error closing shift: ' + (err.message || 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  const expectedTotal = currentSession
    ? (Number(currentSession.opening_cash) || 0) + sessionStats.cashSales + sessionStats.cashPayments - sessionStats.cashExpenses
    : 0

  const calculatedVariance = actualCash !== '' ? (parseFloat(actualCash) || 0) - expectedTotal : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden border border-gray-100 animate-in fade-in zoom-in-95 duration-150">
        
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-2xl">💵</span>
            <div>
              <h2 className="font-bold text-base leading-tight">Cash Register & Drawer Sessions</h2>
              <p className="text-xs text-slate-400">Shift tracking, cash movements & reconciliation</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${
              currentSession ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-slate-700 text-slate-300'
            }`}>
              {currentSession ? '● Drawer Open' : '○ Drawer Closed'}
            </span>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg transition"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-gray-100 bg-gray-50/70 px-5 pt-2 gap-2 shrink-0">
          <button
            onClick={() => setActiveTab('current')}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition ${
              activeTab === 'current'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            {currentSession ? 'Live Shift Dashboard' : 'Open New Shift'}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition ${
              activeTab === 'history'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            Past Sessions History
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 min-h-0 space-y-4">
          {activeTab === 'current' && (
            <>
              {currentSession ? (
                /* ACTIVE SHIFT VIEW */
                <div className="space-y-4">
                  {/* Session Overview Card */}
                  <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Active Shift #{currentSession.id}</span>
                        <span className="text-[11px] text-emerald-700">
                          Opened: {new Date(currentSession.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs text-emerald-600 mt-0.5">
                        Cashier: <strong className="text-emerald-900">{user?.username || user?.email || 'Current User'}</strong>
                        {currentSession.notes && ` · Note: "${currentSession.notes}"`}
                      </p>
                    </div>
                    <button
                      onClick={loadActiveSession}
                      disabled={loading}
                      className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg transition"
                    >
                      {loading ? 'Refreshing...' : '🔄 Refresh Metrics'}
                    </button>
                  </div>

                  {/* Cash Breakdown Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                      <div className="text-[11px] font-bold text-gray-500 uppercase">Opening Float</div>
                      <div className="text-base font-black text-gray-900 mt-0.5">
                        Rs. {Number(currentSession.opening_cash).toLocaleString()}
                      </div>
                    </div>
                    <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100">
                      <div className="text-[11px] font-bold text-blue-600 uppercase">Cash Sales</div>
                      <div className="text-base font-black text-blue-800 mt-0.5">
                        + Rs. {sessionStats.cashSales.toLocaleString()}
                      </div>
                    </div>
                    <div className="p-3 bg-purple-50/60 rounded-xl border border-purple-100">
                      <div className="text-[11px] font-bold text-purple-600 uppercase">Customer In</div>
                      <div className="text-base font-black text-purple-800 mt-0.5">
                        + Rs. {sessionStats.cashPayments.toLocaleString()}
                      </div>
                    </div>
                    <div className="p-3 bg-rose-50/60 rounded-xl border border-rose-100">
                      <div className="text-[11px] font-bold text-rose-600 uppercase">Expenses Out</div>
                      <div className="text-base font-black text-rose-800 mt-0.5">
                        - Rs. {sessionStats.cashExpenses.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {/* Expected Cash in Drawer */}
                  <div className="p-4 bg-slate-900 text-white rounded-xl flex items-center justify-between">
                    <div>
                      <div className="text-xs text-slate-400 font-bold uppercase tracking-wider">Calculated Expected Cash in Drawer</div>
                      <div className="text-2xl font-black text-emerald-400 mt-0.5">
                        Rs. {expectedTotal.toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right text-xs text-slate-400">
                      <div>Total Sales: {sessionStats.salesCount}</div>
                      <div>Currency: PKR</div>
                    </div>
                  </div>

                  {/* Close Shift / Drawer Form */}
                  <form onSubmit={handleCloseShift} className="border border-gray-200 rounded-xl p-4 bg-gray-50/40 space-y-3">
                    <h3 className="font-bold text-sm text-gray-900 flex items-center gap-1.5">
                      <span>🔒</span> Reconcile & End Shift
                    </h3>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor={actualCashId} className="block text-xs font-bold text-gray-700 mb-1">
                          Counted Actual Cash in Drawer (Rs.) *
                        </label>
                        <input
                          id={actualCashId}
                          type="number"
                          step="any"
                          required
                          value={actualCash}
                          onChange={e => setActualCash(e.target.value)}
                          placeholder={`Expected: ${expectedTotal}`}
                          className="w-full px-3 py-2 border rounded-lg text-sm bg-white font-mono font-bold focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label htmlFor={closingNotesId} className="block text-xs font-bold text-gray-700 mb-1">Closing Notes / Reason for Variance</label>
                        <input
                          id={closingNotesId}
                          type="text"
                          value={closingNotes}
                          onChange={e => setClosingNotes(e.target.value)}
                          placeholder="e.g. All matched, or Rs. 20 short due to change"
                          className="w-full px-3 py-2 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    {/* Variance Preview Indicator */}
                    {actualCash !== '' && (
                      <div className={`p-3 rounded-lg border flex items-center justify-between ${
                        calculatedVariance === 0
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : calculatedVariance < 0
                          ? 'bg-rose-50 border-rose-200 text-rose-800'
                          : 'bg-blue-50 border-blue-200 text-blue-800'
                      }`}>
                        <div className="text-xs font-bold">
                          {calculatedVariance === 0 ? '✓ Exact Match — No Variance' : calculatedVariance < 0 ? '⚠ Cash Shortage Detected' : 'ℹ Cash Surplus Detected'}
                        </div>
                        <div className="text-sm font-black font-mono">
                          {calculatedVariance > 0 ? '+' : ''}{calculatedVariance.toLocaleString()} Rs.
                        </div>
                      </div>
                    )}

                    <div className="pt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-100 transition"
                      >
                        Keep Shift Open
                      </button>
                      <button
                        type="submit"
                        disabled={loading || actualCash === ''}
                        className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition shadow-sm disabled:opacity-50"
                      >
                        {loading ? 'Closing...' : 'Close Drawer & Reconcile'}
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                /* OPEN SHIFT VIEW */
                <form onSubmit={handleOpenShift} className="space-y-4">
                  <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-4">
                    <h3 className="font-bold text-sm text-blue-900">Start Your Cash Drawer Shift</h3>
                    <p className="text-xs text-blue-700 mt-1">
                      Enter the starting cash amount (float / peticash) currently present in the register drawer.
                    </p>
                  </div>

                  <div>
                    <label htmlFor={openingFloatId} className="block text-xs font-bold text-gray-700 mb-1">
                      Opening Float / Cash in Drawer (Rs.)
                    </label>
                    <input
                      id={openingFloatId}
                      type="number"
                      step="any"
                      required
                      value={openingCash}
                      onChange={e => setOpeningCash(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2.5 border rounded-xl text-base font-bold font-mono focus:ring-2 focus:ring-blue-500"
                    />
                    {/* Quick Float Shortcuts */}
                    <div className="flex gap-1.5 mt-2">
                      {['0', '1000', '2000', '5000', '10000'].map(val => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setOpeningCash(val)}
                          className="px-2.5 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-bold transition"
                        >
                          Rs. {val}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label htmlFor={openingNotesId} className="block text-xs font-bold text-gray-700 mb-1">Shift Notes / Register ID</label>
                    <input
                      id={openingNotesId}
                      type="text"
                      value={openingNotes}
                      onChange={e => setOpeningNotes(e.target.value)}
                      placeholder="e.g. Counter 1 - Morning Shift"
                      className="w-full px-3 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="pt-3 flex justify-end gap-2 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 py-2 border border-gray-300 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-100 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-sm disabled:opacity-50"
                    >
                      {loading ? 'Opening...' : '✓ Open Cash Drawer'}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {activeTab === 'history' && (
            <div className="space-y-3">
              <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">Recent Closed Sessions</div>
              {sessionHistory.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-xs">No previous cash sessions recorded.</div>
              ) : (
                <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 text-xs">
                  {sessionHistory.map(s => {
                    const varVal = Number(s.variance) || 0
                    return (
                      <div key={s.id} className="p-3 bg-white hover:bg-gray-50 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-bold text-gray-900 flex items-center gap-1.5">
                            <span>Shift #{s.id}</span>
                            <span className={`px-1.5 py-0.2 rounded text-[10px] font-black uppercase ${
                              s.status === 'open' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
                            }`}>
                              {s.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            {new Date(s.opened_at).toLocaleDateString()} · Opened {new Date(s.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {s.closed_at && ` → Closed ${new Date(s.closed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                          </div>
                          {s.notes && <div className="text-[10px] text-gray-400 italic mt-0.5">{s.notes}</div>}
                        </div>
                        <div className="text-right">
                          <div className="font-mono font-bold text-gray-800">
                            Float: Rs. {Number(s.opening_cash).toLocaleString()}
                          </div>
                          {s.status === 'closed' && (
                            <div className={`font-mono text-[11px] font-bold ${
                              varVal === 0 ? 'text-emerald-600' : varVal < 0 ? 'text-rose-600' : 'text-blue-600'
                            }`}>
                              Var: {varVal > 0 ? '+' : ''}{varVal.toLocaleString()}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
