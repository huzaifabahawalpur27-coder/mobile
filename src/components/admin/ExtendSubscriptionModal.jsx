import { useState, useMemo } from 'react'
import { supabaseAdmin } from '../../services/supabaseAdmin'
import { logAction } from '../../services/auditService'
import { useAuth } from '../../context/AuthContext'
import { 
  Calendar, 
  Clock, 
  CheckCircle2, 
  X, 
  AlertCircle, 
  Sparkles, 
  MessageSquare,
  ShieldCheck,
  Zap,
  ArrowRight
} from 'lucide-react'

export default function ExtendSubscriptionModal({ shop, onClose, onSuccess }) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Calculate current expiration date or fallback to today
  const currentExpiry = useMemo(() => {
    if (!shop?.next_billing_date) return new Date()
    const d = new Date(shop.next_billing_date)
    return isNaN(d.getTime()) ? new Date() : d
  }, [shop])

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], [])

  // Calculate initial target date (currentExpiry > today ? currentExpiry + 30 days : today + 30 days)
  const [selectedDate, setSelectedDate] = useState(() => {
    const base = currentExpiry > new Date() ? new Date(currentExpiry) : new Date()
    base.setDate(base.getDate() + 30)
    return base.toISOString().split('T')[0]
  })

  const [reactivate, setReactivate] = useState(true)
  const [notes, setNotes] = useState('Subscription extended by Superadmin')

  // Calculate days added
  const daysAdded = useMemo(() => {
    if (!selectedDate) return 0
    const target = new Date(selectedDate)
    const base = currentExpiry > new Date() ? currentExpiry : new Date()
    const diffTime = target.getTime() - base.getTime()
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  }, [selectedDate, currentExpiry])

  // Quick preset handlers
  const applyPresetDays = (days) => {
    const base = currentExpiry > new Date() ? new Date(currentExpiry) : new Date()
    base.setDate(base.getDate() + days)
    setSelectedDate(base.toISOString().split('T')[0])
  }

  const applyPresetMonths = (months) => {
    const base = currentExpiry > new Date() ? new Date(currentExpiry) : new Date()
    base.setMonth(base.getMonth() + months)
    setSelectedDate(base.toISOString().split('T')[0])
  }

  const applyLifetime = () => {
    setSelectedDate('2099-12-31')
  }

  // Days remaining in current subscription
  const currentDaysLeft = useMemo(() => {
    if (!shop?.next_billing_date) return null
    const target = new Date(shop.next_billing_date)
    const diff = target.getTime() - new Date().getTime()
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  }, [shop])

  const handleSave = async (e) => {
    e.preventDefault()
    if (!selectedDate) return setError('Please choose a valid extension date.')
    if (!supabaseAdmin) return setError('Admin privileges required.')

    setLoading(true)
    setError('')

    try {
      const updates = {
        next_billing_date: selectedDate,
        notes: notes ? `${shop.notes ? shop.notes + ' | ' : ''}[Extended to ${selectedDate}]: ${notes}` : shop.notes
      }

      if (reactivate) {
        updates.status = 'active'
        updates.suspension_reason = null
      }

      const { error: updateErr } = await supabaseAdmin
        .from('shops')
        .update(updates)
        .eq('id', shop.id)

      if (updateErr) throw updateErr

      // Log in Superadmin Audit Logs
      await logAction({
        actor_id: user?.id,
        actor_email: user?.email || user?.username,
        action_type: 'EXTEND_SUBSCRIPTION_DATE',
        target_type: 'SHOP',
        target_id: shop.id,
        details: {
          previous_date: shop.next_billing_date,
          new_date: selectedDate,
          days_extended: daysAdded,
          reactivated: reactivate,
          notes
        }
      })

      if (onSuccess) onSuccess()
      onClose()
    } catch (err) {
      console.error('Failed to extend subscription:', err)
      setError(err.message || 'Failed to update subscription date.')
    } finally {
      setLoading(false)
    }
  }

  // Generate WhatsApp message URL
  const generateWhatsAppLink = () => {
    const phone = (shop.phone || '').replace(/[^0-9]/g, '')
    if (!phone) return null
    const intlPhone = phone.startsWith('0') ? '92' + phone.slice(1) : phone
    const msg = encodeURIComponent(
      `Assalam-o-Alaikum ${shop.name}!\n\nYour EdgeX Mobile POS subscription has been successfully extended.\n\n📅 New Expiry Date: ${new Date(selectedDate).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}\n🚀 Status: Active\n\nThank you for choosing EdgeX POS!\nSupport Hotline: 0301-2616367`
    )
    return `https://wa.me/${intlPhone}?text=${msg}`
  }

  const waLink = generateWhatsAppLink()

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-lg w-full overflow-hidden my-8">
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400 shadow-inner">
              <Calendar size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
                <span>Extend Subscription</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-400/30">
                  Shop #{shop.id}
                </span>
              </h2>
              <p className="text-xs text-slate-300 truncate max-w-[280px]">
                {shop.name} {shop.phone ? `• ${shop.phone}` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Current Status Bar */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-600">
            <span className="font-semibold text-slate-500">Current Expiry:</span>
            <span className="font-mono font-bold text-slate-800">
              {shop.next_billing_date ? new Date(shop.next_billing_date).toLocaleDateString() : 'None'}
            </span>
          </div>
          <div>
            {currentDaysLeft === null ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600">No Date</span>
            ) : currentDaysLeft > 5 ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                Active ({currentDaysLeft}d left)
              </span>
            ) : currentDaysLeft >= 0 ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                Expiring soon ({currentDaysLeft}d left)
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">
                Expired ({Math.abs(currentDaysLeft)}d ago)
              </span>
            )}
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 space-y-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 flex items-start gap-2">
              <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-500" />
              <span>{error}</span>
            </div>
          )}

          {/* Quick 1-Tap Presets */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
              <Sparkles size={13} className="text-amber-500" />
              <span>Quick Extension Presets</span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => applyPresetDays(7)}
                className="py-2 px-1 text-xs font-bold rounded-xl bg-slate-100 hover:bg-blue-50 hover:text-blue-600 border border-slate-200 hover:border-blue-300 transition text-center"
              >
                +7 Days
              </button>
              <button
                type="button"
                onClick={() => applyPresetDays(15)}
                className="py-2 px-1 text-xs font-bold rounded-xl bg-slate-100 hover:bg-blue-50 hover:text-blue-600 border border-slate-200 hover:border-blue-300 transition text-center"
              >
                +15 Days
              </button>
              <button
                type="button"
                onClick={() => applyPresetMonths(1)}
                className="py-2 px-1 text-xs font-bold rounded-xl bg-slate-100 hover:bg-blue-50 hover:text-blue-600 border border-slate-200 hover:border-blue-300 transition text-center"
              >
                +1 Month
              </button>
              <button
                type="button"
                onClick={() => applyPresetMonths(3)}
                className="py-2 px-1 text-xs font-bold rounded-xl bg-slate-100 hover:bg-blue-50 hover:text-blue-600 border border-slate-200 hover:border-blue-300 transition text-center"
              >
                +3 Months
              </button>
              <button
                type="button"
                onClick={() => applyPresetMonths(6)}
                className="py-2 px-1 text-xs font-bold rounded-xl bg-slate-100 hover:bg-blue-50 hover:text-blue-600 border border-slate-200 hover:border-blue-300 transition text-center"
              >
                +6 Months
              </button>
              <button
                type="button"
                onClick={() => applyPresetMonths(12)}
                className="py-2 px-1 text-xs font-bold rounded-xl bg-slate-100 hover:bg-blue-50 hover:text-blue-600 border border-slate-200 hover:border-blue-300 transition text-center"
              >
                +1 Year
              </button>
              <button
                type="button"
                onClick={applyLifetime}
                colSpan={2}
                className="col-span-2 py-2 px-1 text-xs font-bold rounded-xl bg-gradient-to-r from-amber-500/10 to-emerald-500/10 text-emerald-700 hover:bg-emerald-100 border border-emerald-300 transition text-center flex items-center justify-center gap-1"
              >
                <Zap size={13} className="text-amber-600" />
                <span>Lifetime / Permanent</span>
              </button>
            </div>
          </div>

          {/* Exact Date Picker */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Clock size={13} className="text-blue-600" />
                <span>Or Select Exact Expiry Date</span>
              </span>
              {daysAdded > 0 && (
                <span className="text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                  +{daysAdded} days extension
                </span>
              )}
            </label>
            <input
              type="date"
              required
              min={todayStr}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full p-3 bg-white border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 rounded-xl text-sm font-bold text-slate-800 shadow-sm"
            />
            <p className="text-[11px] text-slate-400 mt-1.5">
              New expiry will be set to:{' '}
              <span className="font-bold text-slate-700">
                {selectedDate ? new Date(selectedDate).toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) : '---'}
              </span>
            </p>
          </div>

          {/* Auto-reactivate switch */}
          <div className="flex items-center gap-3 p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
            <input
              type="checkbox"
              id="reactivateCheck"
              checked={reactivate}
              onChange={(e) => setReactivate(e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
            />
            <label htmlFor="reactivateCheck" className="text-xs text-slate-700 font-medium cursor-pointer select-none">
              <span className="font-bold text-slate-800">Immediately Reactivate Shop</span>
              <p className="text-[11px] text-slate-500">Clears any suspension lock and restores full POS counter access.</p>
            </label>
          </div>

          {/* Reason / Notes */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Reason / Admin Memo (Audit Trail)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Cash received in office, promo grace period, friend shop..."
              className="w-full p-2.5 bg-white border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-xl text-xs text-slate-800"
            />
          </div>

          {/* Actions */}
          <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="w-full sm:flex-1 py-3 px-5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-500/25 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  <span>Confirm & Extend Subscription</span>
                </>
              )}
            </button>
          </div>

          {/* WhatsApp Direct Confirmation Button */}
          {waLink && (
            <div className="pt-2 text-center border-t border-slate-100">
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:underline"
              >
                <MessageSquare size={13} />
                <span>Send WhatsApp Extension Slip to Owner ({shop.phone})</span>
              </a>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
