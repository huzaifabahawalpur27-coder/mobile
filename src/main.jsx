import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import './services/syncService'
import { registerSW } from 'virtual:pwa-register'

// ── PWA Instant Auto-Update on all mobile & desktop devices ────────────────
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    console.log('[EdgeX PWA] New version ready. Updating client immediately...')
    updateSW(true)
  },
  onOfflineReady() {
    console.log('[EdgeX PWA] App ready offline.')
  },
  onRegisteredSW(swUrl, registration) {
    if (registration) {
      // Check for updates periodically every 30 minutes
      setInterval(() => {
        registration.update().catch(() => {})
      }, 30 * 60 * 1000)
    }
  }
})

// Hard deployment version stamp - auto-busts caches on every device
const APP_DEPLOY_STAMP = '2026.11.08.2045_v3'
const DEPLOY_STAMP_KEY = 'edgex_deploy_stamp'

if (typeof window !== 'undefined') {
  const currentStamp = localStorage.getItem(DEPLOY_STAMP_KEY)
  if (currentStamp !== APP_DEPLOY_STAMP) {
    localStorage.setItem(DEPLOY_STAMP_KEY, APP_DEPLOY_STAMP)
    if ('caches' in window) {
      caches.keys().then(keys => {
        Promise.all(keys.map(k => caches.delete(k))).catch(() => {})
      }).catch(() => {})
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(r => r.update().catch(() => {}))
      }).catch(() => {})
    }
  }

  // Also check for updates when user brings app to foreground on mobile
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg) reg.update().catch(() => {})
      }).catch(() => {})
    }
  })
}

// ── Vite dynamic chunk import error recovery ─────────────────────────────
// When a new deployment is pushed to production, old chunk hashes 404 (MIME text/html).
// This catches the error and cleanly reloads the page once to pull the fresh HTML & chunk manifest.
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    console.warn('[EdgeX] New deployment detected or chunk failed to load. Reloading...', event)
    const lastReload = parseInt(sessionStorage.getItem('edgex_chunk_reload') || '0', 10)
    const now = Date.now()
    if (now - lastReload > 6000) {
      sessionStorage.setItem('edgex_chunk_reload', String(now))
      window.location.reload()
    }
  })

  window.addEventListener('error', (event) => {
    const msg = String(event?.message || '')
    if (
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Expected a JavaScript-or-Wasm module script') ||
      msg.includes('error loading dynamically imported module')
    ) {
      console.warn('[EdgeX] Stale chunk script error detected. Reloading for newest deployment...', msg)
      const lastReload = parseInt(sessionStorage.getItem('edgex_chunk_reload') || '0', 10)
      const now = Date.now()
      if (now - lastReload > 6000) {
        sessionStorage.setItem('edgex_chunk_reload', String(now))
        window.location.reload()
      }
    }
  })

  window.addEventListener('unhandledrejection', async (event) => {
    const reasonStr = String(event?.reason?.message || event?.reason || '')
    if (reasonStr.includes('bad-precaching-response') || reasonStr.includes('precache')) {
      console.warn('[EdgeX] Corrupted or stale PWA precache detected. Purging cache storage and updating...', reasonStr)
      const lastPurge = parseInt(sessionStorage.getItem('edgex_sw_purge') || '0', 10)
      const now = Date.now()
      if (now - lastPurge > 10000) {
        sessionStorage.setItem('edgex_sw_purge', String(now))
        if ('caches' in window) {
          try {
            const keys = await caches.keys()
            await Promise.all(keys.map(k => caches.delete(k)))
          } catch (_) {}
        }
        if ('serviceWorker' in navigator) {
          try {
            const regs = await navigator.serviceWorker.getRegistrations()
            await Promise.all(regs.map(r => r.unregister()))
          } catch (_) {}
        }
        window.location.reload()
      }
    }
  })
}


// ── RLS error interceptor ─────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  const originalAlert = window.alert;
  window.alert = (message) => {
    const msgStr = String(message || '');
    if (msgStr.toLowerCase().includes('row-level security policy') || msgStr.toLowerCase().includes('row violates row-level security')) {
      originalAlert(
        "⚠️ Login Session Required / Expired\n\n" +
        "Your login session is expired or unregistered in the database.\n\n" +
        "To resolve this, please:\n" +
        "1. Log out of the application.\n" +
        "2. Log back in to establish a fresh security session."
      );
    } else {
      originalAlert(message);
    }
  };
}

// ── Force-update polling (checks Supabase every 5 minutes) ───────────────
// When superadmin clicks "Push Update", force_refresh_version is incremented.
// This app detects the mismatch, activates the waiting SW, and reloads.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const VERSION_KEY = 'edgex_app_version'

let systemConfigsAvailable = true

async function checkForForceUpdate() {
  if (!systemConfigsAvailable || !SUPABASE_URL || !SUPABASE_ANON_KEY || !navigator.onLine) return
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/system_configs?key=eq.force_refresh_version&select=value`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (res.status === 404) {
      systemConfigsAvailable = false
      return
    }
    if (!res.ok) return
    const rows = await res.json()
    const remoteVersion = rows?.[0]?.value
    if (!remoteVersion) return

    const localVersion = localStorage.getItem(VERSION_KEY) || '0'

    if (remoteVersion !== localVersion) {
      console.log(`[EdgeX] New version detected (${localVersion} → ${remoteVersion}). Flushing cache and reloading…`)
      localStorage.setItem(VERSION_KEY, remoteVersion)

      // Flush CacheStorage to ensure brand new JS/CSS bundles are downloaded
      if ('caches' in window) {
        try {
          const cacheKeys = await caches.keys()
          await Promise.all(cacheKeys.map(k => caches.delete(k)))
        } catch (_) {}
      }

      // Flush local products and phones cache to remove any stale duplicate records
      try {
        const { db } = await import('./services/db')
        if (db?.products) await db.products.clear().catch(() => {})
        if (db?.phones) await db.phones.clear().catch(() => {})
      } catch (_) {}

      // Ask the waiting SW to take control immediately, then reload
      if ('serviceWorker' in navigator) {
        try {
          const reg = await navigator.serviceWorker.getRegistration()
          if (reg?.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' })
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              window.location.reload()
            }, { once: true })
            return
          } else if (reg?.update) {
            await reg.update()
          }
        } catch (_) {}
      }
      window.location.reload()
    }
  } catch (_) {
    // Silently ignore — network error or table not yet created
  }
}

// Run on load (after a short delay so app initialises first)
setTimeout(checkForForceUpdate, 3000)
// Then every 5 minutes
setInterval(checkForForceUpdate, 5 * 60 * 1000)

// ── Auto-Purge Stale Duplicates Cache (One-Time Execution per Shop) ─────────
const CACHE_CLEANUP_KEY = 'edgex_catalog_clean_v1'
if (typeof window !== 'undefined' && !localStorage.getItem(CACHE_CLEANUP_KEY)) {
  try {
    import('./services/db').then(async ({ db }) => {
      if (db?.products) await db.products.clear().catch(() => {})
      if (db?.phones) await db.phones.clear().catch(() => {})
      localStorage.setItem(CACHE_CLEANUP_KEY, 'true')
      console.log('[EdgeX] Purged stale local product/phone cache to prevent duplicate items.')
    }).catch(() => {})
  } catch (_) {}
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
