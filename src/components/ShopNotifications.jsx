import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Megaphone, X, ArrowRight } from 'lucide-react'
import { NOTIFICATION_CATEGORIES } from '../services/notificationService'

const when = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Each paragraph gets its own direction, so an Urdu line reads right-to-left next to English
function MessageText({ text, className }) {
  const paras = String(text || '').split(/\n{2,}/).map(t => t.trim()).filter(Boolean)
  return (
    <div className={className}>
      {paras.map((t, i) => <p key={i} dir="auto" className="whitespace-pre-line">{t}</p>)}
    </div>
  )
}

function CategoryBadge({ category }) {
  const c = NOTIFICATION_CATEGORIES[category] || NOTIFICATION_CATEGORIES.feature
  return <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${c.className}`}>{c.label}</span>
}

/** "Updates" section of the bell dropdown: history of pushed notifications. */
export function ShopUpdatesSection({ items, newIds, canDelete, onNavigate, onDelete }) {
  const [deleting, setDeleting] = useState(null)

  const handleDelete = async (n) => {
    if (!window.confirm(`Delete "${n.title}" permanently?\n\nIt will be removed from your notification history.`)) return
    setDeleting(n.id)
    try {
      await onDelete(n.id)
    } catch (err) {
      alert(err?.message || 'Could not delete the notification')
    } finally {
      setDeleting(null)
    }
  }

  if (!items.length) return null
  return (
    <div className="divide-y divide-gray-50">
      <p className="px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-blue-50/60 flex items-center gap-1.5">
        <Megaphone size={12} className="text-blue-500" /> Updates
      </p>
      {items.map(n => {
        const isNew = newIds.has(String(n.id))
        return (
          <div key={n.id} className={`p-3 pl-4 flex gap-2 items-start ${isNew ? 'bg-blue-50/50' : ''}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <CategoryBadge category={n.category} />
                {isNew && <span className="text-[9px] font-black text-blue-600 uppercase">• New</span>}
                <span className="text-[10px] text-gray-400 font-medium">{when(n.created_at)}</span>
              </div>
              <p className="mt-1 text-sm font-bold text-gray-800 leading-snug">{n.title}</p>
              {n.body && <MessageText text={n.body} className="mt-0.5 text-xs text-gray-600 leading-relaxed space-y-1" />}
              {n.link_path && (
                <Link to={n.link_path} onClick={onNavigate}
                  className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-black text-blue-600 hover:text-blue-800 uppercase tracking-wide">
                  Open {n.module_label || 'page'} <ArrowRight size={12} />
                </Link>
              )}
            </div>
            {canDelete && (
              <button
                type="button"
                onClick={() => handleDelete(n)}
                disabled={deleting === n.id}
                aria-label={`Delete notification: ${n.title}`}
                title="Delete permanently"
                className="p-2 -mr-1 rounded-lg text-gray-300 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 shrink-0"
              >
                <X size={16} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** One-time popup for the newest update the shop has not seen yet. */
export function ShopUpdatePopup({ item, more, onClose, onShowAll }) {
  // Escape closes it, like the close button
  useEffect(() => {
    if (!item) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, onClose])

  if (!item) return null
  return (
    // Centred over a dimmed page; tapping outside the card closes it
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shop-update-title"
      onClick={(e) => e.stopPropagation()}
      className="w-full max-w-md max-h-[90dvh] flex flex-col bg-white rounded-2xl shadow-2xl border border-blue-100 overflow-hidden"
    >
      <div className="px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-widest flex items-center gap-2"><Megaphone size={14} /> New update</p>
        <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 -mr-1 rounded-lg hover:bg-white/20"><X size={16} /></button>
      </div>
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-2"><CategoryBadge category={item.category} /><span className="text-[10px] text-gray-400">{when(item.created_at)}</span></div>
        <p id="shop-update-title" className="text-base font-extrabold text-gray-900 leading-snug">{item.title}</p>
        {item.body && <MessageText text={item.body} className="text-sm text-gray-600 leading-relaxed max-h-[40dvh] overflow-y-auto space-y-2" />}
      </div>
      <div className="px-4 pb-4 flex flex-col-reverse sm:flex-row gap-2">
        {more > 0 ? (
          <button type="button" onClick={onShowAll} className="flex-1 px-3 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold">
            See all {more + 1} updates
          </button>
        ) : (
          <button type="button" onClick={onClose} className="flex-1 px-3 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold">Got it</button>
        )}
        {item.link_path && (
          <Link to={item.link_path} onClick={onClose}
            className="flex-1 px-3 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold text-center inline-flex items-center justify-center gap-1">
            Open {item.module_label || 'page'} <ArrowRight size={14} />
          </Link>
        )}
      </div>
    </div>
    </div>
  )
}
