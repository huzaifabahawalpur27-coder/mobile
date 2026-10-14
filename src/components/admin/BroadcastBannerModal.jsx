import { useState, useEffect } from 'react'
import { supabaseAdmin } from '../../services/supabaseAdmin'
import { logAction } from '../../services/auditService'
import { useAuth } from '../../context/AuthContext'
import {
  X, Megaphone, Check, AlertTriangle, AlertCircle, Info, Sparkles, RefreshCw, Eye
} from 'lucide-react'

export default function BroadcastBannerModal({ onClose, onSuccess }) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [active, setActive] = useState(false)
  const [type, setType] = useState('warning')
  const [title, setTitle] = useState('Notice')
  const [message, setMessage] = useState('')
  const [allowDismiss, setAllowDismiss] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchCurrentBanner()
  }, [])

  const fetchCurrentBanner = async () => {
    if (!supabaseAdmin) return
    setLoading(true)
    try {
      const { data, error: err } = await supabaseAdmin
        .from('system_configs')
        .select('value')
        .eq('key', 'broadcast_banner')
        .maybeSingle()

      if (err) throw err

      if (data?.value) {
        const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
        setActive(Boolean(parsed.active))
        setType(parsed.type || 'warning')
        setTitle(parsed.title || 'Notice')
        setMessage(parsed.message || '')
        setAllowDismiss(parsed.allowDismiss !== false)
      }
    } catch (e) {
      console.error('Fetch banner error:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (active && !message.trim()) {
      setError('Please provide an announcement message before activating.')
      return
    }

    setSaving(true)
    setError('')

    const payload = {
      active,
      type,
      title: title.trim(),
      message: message.trim(),
      allowDismiss,
      updatedAt: Date.now()
    }

    try {
      const { error: upsertErr } = await supabaseAdmin
        .from('system_configs')
        .upsert({
          key: 'broadcast_banner',
          value: JSON.stringify(payload),
          updated_at: new Date().toISOString()
        })

      if (upsertErr) throw upsertErr

      await logAction({
        actor_id: user?.id,
        actor_email: user?.email || user?.username,
        action_type: active ? 'ACTIVATE_GLOBAL_BANNER' : 'DEACTIVATE_GLOBAL_BANNER',
        target_type: 'SYSTEM',
        details: payload
      })

      if (onSuccess) onSuccess()
      onClose()
    } catch (err) {
      setError('Failed to update banner: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const setTemplate = (t, tit, msg) => {
    setType(t)
    setTitle(tit)
    setMessage(msg)
    setActive(true)
  }

  // Preview styling
  const typeStyles = {
    warning: {
      bg: 'bg-amber-500/10 border-amber-500/30 text-amber-900',
      badge: 'bg-amber-500 text-white',
      icon: <AlertTriangle size={15} className="text-amber-600" />
    },
    alert: {
      bg: 'bg-rose-500/10 border-rose-500/30 text-rose-900',
      badge: 'bg-rose-600 text-white',
      icon: <AlertCircle size={15} className="text-rose-600" />
    },
    success: {
      bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-900',
      badge: 'bg-emerald-600 text-white',
      icon: <Sparkles size={15} className="text-emerald-600" />
    },
    info: {
      bg: 'bg-blue-500/10 border-blue-500/30 text-blue-900',
      badge: 'bg-blue-600 text-white',
      icon: <Info size={15} className="text-blue-600" />
    }
  }

  const currentPreview = typeStyles[type] || typeStyles.info

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shadow-inner">
              <Megaphone size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-base">Global Shop Announcement</h3>
              <p className="text-xs text-slate-500">Broadcast notices instantly across all store login pages & POS headers</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
            <RefreshCw className="animate-spin text-blue-500" size={24} />
            <span>Loading current announcement...</span>
          </div>
        ) : (
          <form onSubmit={handleSave} className="p-6 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 font-medium">
                {error}
              </div>
            )}

            {/* Active Toggle Switch */}
            <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <div>
                <h4 className="text-xs font-bold text-slate-800">Broadcast Banner Status</h4>
                <p className="text-[11px] text-slate-500">
                  {active ? '🟢 Banner is visible to all shops right now.' : '⚪ Banner is currently turned OFF.'}
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>

            {/* Quick Presets */}
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                Quick Announcement Templates
              </label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setTemplate('warning', 'Maintenance', 'EdgeX POS server maintenance is scheduled for tonight 2:00 AM - 4:00 AM PKT. Offline sales will operate normally.')}
                  className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-[11px] font-semibold transition"
                >
                  🛠️ Maintenance Notice
                </button>
                <button
                  type="button"
                  onClick={() => setTemplate('success', 'Update', 'New feature released: Direct WhatsApp bills and fast barcode scanner improvements now live!')}
                  className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-[11px] font-semibold transition"
                >
                  🚀 New Feature Alert
                </button>
                <button
                  type="button"
                  onClick={() => setTemplate('alert', 'Urgent', 'Baraye meherbani apne overdue subscription bills foran clear karein taakay store suspend na ho.')}
                  className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 rounded-lg text-[11px] font-semibold transition"
                >
                  ⚠️ Overdue Reminder
                </button>
              </div>
            </div>

            {/* Banner Type */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { id: 'warning', label: 'Warning', color: 'amber' },
                { id: 'info', label: 'Info', color: 'blue' },
                { id: 'alert', label: 'Alert', color: 'rose' },
                { id: 'success', label: 'Special', color: 'emerald' }
              ].map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setType(t.id)}
                  className={`py-2 px-2 text-center rounded-xl text-xs font-bold border transition ${
                    type === t.id
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Title & Message */}
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                Badge / Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Maintenance, Notice, Update"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                Announcement Message
              </label>
              <textarea
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type the message that will be shown across all POS clients..."
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            {/* Dismiss option */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allowDismiss}
                onChange={(e) => setAllowDismiss(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs text-slate-600 font-medium">
                Allow shop staff to dismiss this banner for their active session
              </span>
            </label>

            {/* Live Preview */}
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                <Eye size={12} />
                <span>Live Preview</span>
              </div>
              <div className={`p-3 rounded-xl border ${currentPreview.bg} flex items-center justify-between gap-2 text-xs`}>
                <div className="flex items-center gap-2 min-w-0">
                  {currentPreview.icon}
                  {title && (
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${currentPreview.badge}`}>
                      {title}
                    </span>
                  )}
                  <span className="truncate">{message || 'Your announcement message will appear here...'}</span>
                </div>
                {allowDismiss && <X size={14} className="opacity-50 shrink-0" />}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/25 transition flex items-center justify-center gap-1.5 disabled:opacity-60"
              >
                {saving ? <RefreshCw className="animate-spin" size={14} /> : <Check size={14} />}
                <span>{saving ? 'Publishing...' : 'Publish Announcement'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
