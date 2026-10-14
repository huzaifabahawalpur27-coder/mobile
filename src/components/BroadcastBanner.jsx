import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { Info, AlertTriangle, AlertCircle, Sparkles, X } from 'lucide-react'

export default function BroadcastBanner({ isLogin = false }) {
  const [banner, setBanner] = useState(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    fetchBanner()
  }, [])

  const fetchBanner = async () => {
    try {
      const { data, error } = await supabase
        .from('system_configs')
        .select('value, updated_at')
        .eq('key', 'broadcast_banner')
        .maybeSingle()

      if (error || !data?.value) return

      let parsed = null
      try {
        parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
      } catch (e) {
        console.error('Failed to parse broadcast banner:', e)
        return
      }

      if (parsed && parsed.active && parsed.message) {
        const dismissKey = `edgex_dismiss_banner_${parsed.updatedAt || data.updated_at}`
        if (sessionStorage.getItem(dismissKey) === 'true') {
          setDismissed(true)
        }
        setBanner({ ...parsed, dbUpdatedAt: data.updated_at })
      }
    } catch (e) {
      // Non-critical, ignore silent failures
    }
  }

  const handleDismiss = () => {
    if (!banner) return
    const dismissKey = `edgex_dismiss_banner_${banner.updatedAt || banner.dbUpdatedAt}`
    sessionStorage.setItem(dismissKey, 'true')
    setDismissed(true)
  }

  if (!banner || !banner.active || dismissed) return null

  // Styles based on banner type
  const typeConfig = {
    warning: {
      bg: 'bg-amber-500/10 border-amber-500/30 text-amber-900',
      badgeBg: 'bg-amber-500 text-white',
      icon: <AlertTriangle size={16} className="text-amber-600 shrink-0" />
    },
    alert: {
      bg: 'bg-rose-500/10 border-rose-500/30 text-rose-900',
      badgeBg: 'bg-rose-600 text-white',
      icon: <AlertCircle size={16} className="text-rose-600 shrink-0" />
    },
    success: {
      bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-900',
      badgeBg: 'bg-emerald-600 text-white',
      icon: <Sparkles size={16} className="text-emerald-600 shrink-0" />
    },
    info: {
      bg: 'bg-blue-500/10 border-blue-500/30 text-blue-900',
      badgeBg: 'bg-blue-600 text-white',
      icon: <Info size={16} className="text-blue-600 shrink-0" />
    }
  }

  const currentStyle = typeConfig[banner.type] || typeConfig.info

  return (
    <div
      className={`w-full border-b backdrop-blur-md px-4 py-2.5 transition-all animate-fadeIn ${currentStyle.bg} ${
        isLogin ? 'rounded-2xl border mb-6 shadow-sm' : ''
      }`}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          {currentStyle.icon}
          {banner.title && (
            <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] tracking-wide uppercase shrink-0 ${currentStyle.badgeBg}`}>
              {banner.title}
            </span>
          )}
          <span className="font-medium truncate sm:whitespace-normal">
            {banner.message}
          </span>
        </div>

        {banner.allowDismiss !== false && (
          <button
            onClick={handleDismiss}
            className="p-1 rounded-md hover:bg-black/5 text-current/60 hover:text-current shrink-0 transition"
            title="Dismiss announcement"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
