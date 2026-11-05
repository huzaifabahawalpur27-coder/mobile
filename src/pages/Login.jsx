import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
// eslint-disable-next-line no-unused-vars
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { supabase, rlsSession } from '../services/supabase'
import { supabaseAdmin } from '../services/supabaseAdmin'
import { db as localDB } from '../services/db'
import { hashPassword } from '../utils/authUtils'
import {
  Lock,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  Smartphone,
  Receipt,
  Users,
  Terminal
} from 'lucide-react'
import BroadcastBanner from '../components/BroadcastBanner'

function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  const [logoUrl, setLogoUrl] = useState(() => {
    const lastShopId = localStorage.getItem('last_shop_id')
    return lastShopId ? localStorage.getItem(`shop_logo_${lastShopId}`) || '/edgex_pos_logo_platform.png' : '/edgex_pos_logo_platform.png'
  })
  const [platformName, setPlatformName] = useState(() => {
    const lastShopId = localStorage.getItem('last_shop_id')
    return lastShopId ? localStorage.getItem(`shop_name_${lastShopId}`) || 'EdgeX POS' : 'EdgeX POS'
  })

  useEffect(() => {
    document.title = platformName ? `${platformName} - Sign In` : 'EdgeX Mobile POS'

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [platformName])

  const handleQuickDemoFill = () => {
    setUsername('admin')
    setPassword('1234')
  }

  const { login, impersonate } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // Handle impersonation from superadmin
  useEffect(() => {
    const impId = searchParams.get('impersonateId')
    if (!impId) return

    const shopName = searchParams.get('shopName') || 'Impersonated Shop'
    const logoUrl = searchParams.get('logoUrl') || ''
    const sessionToken = searchParams.get('sessionToken') || ''

    const impersonatedUser = {
      id: `impersonated-${impId}`,
      username: `Superadmin (${shopName})`,
      role: 'admin',
      shop_id: String(impId),
      isImpersonating: true
    }

    localStorage.removeItem('user')
    localStorage.removeItem('originalUser')
    if (sessionToken) localStorage.setItem('session_token', sessionToken)

    localStorage.setItem('user', JSON.stringify(impersonatedUser))
    localStorage.setItem(`shop_name_${impId}`, shopName)
    if (logoUrl) {
      localStorage.setItem(`shop_logo_${impId}`, logoUrl)
    } else {
      localStorage.removeItem(`shop_logo_${impId}`)
    }

    try { impersonate(impId, { name: shopName, logo_url: logoUrl }) } catch (_e) { /* no-op */ }
    window.location.href = '/dashboard'
  }, [searchParams, impersonate])

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Helper for offline fallback login via IndexedDB
    const attemptOfflineLogin = async () => {
      try {
        const hashedPassword = await hashPassword(password)
        const allUsers = await localDB.users.toArray()
        const localUser = allUsers.find(u =>
          u.username?.toLowerCase() === username.trim().toLowerCase()
        )

        if (!localUser) {
          setError('Server se rabta nahi ho saka aur is device par offline login save nahi hai. Pehle online login karein.')
          setLoading(false)
          return false
        }

        if (localUser.password !== hashedPassword) {
          setError('Offline: Password ghalat hai.')
          setLoading(false)
          return false
        }

        if (localUser.is_active === false) {
          setError('Offline: Yeh account inactive hai.')
          setLoading(false)
          return false
        }

        if (localUser.shop_id) {
          localStorage.setItem('last_shop_id', localUser.shop_id)
          try {
            const localShop = await localDB.shops.get(localUser.shop_id)
            if (localShop?.name) localStorage.setItem(`shop_name_${localUser.shop_id}`, localShop.name)
            if (localShop?.logo_url) localStorage.setItem(`shop_logo_${localUser.shop_id}`, localShop.logo_url)
          } catch (_e) { /* no-op */ }
        }

        login({
          id: localUser.id,
          username: localUser.username,
          email: localUser.email || '',
          role: localUser.role,
          shop_id: localUser.shop_id,
          permissions: localUser.permissions || []
        })

        setError('Logged in offline. Some features require internet.')
        setTimeout(() => navigate('/dashboard'), 800)
        return true
      } catch (_err) {
        setError('Offline login failed. Please try again.')
        setLoading(false)
        return false
      }
    }

    try {
      const hashedPassword = await hashPassword(password)
      const cleanUsername = username.trim()
      let loginData = null

      const { data: loginResult, error: rpcError } = await supabase.rpc('secure_login', {
        p_username: cleanUsername,
        p_password_hash: hashedPassword
      })

      if (!rpcError && loginResult) {
        loginData = loginResult
      } else {
        if (supabaseAdmin) {
          try {
            const { data: adminUser, error: adminErr } = await supabaseAdmin
              .from('users')
              .select('*')
              .or(`username.ilike.${cleanUsername},email.ilike.${cleanUsername}`)
              .eq('is_active', true)
              .maybeSingle()

            if (!adminErr && adminUser && adminUser.password === hashedPassword) {
              loginData = {
                success: true,
                user: {
                  id: adminUser.id,
                  username: adminUser.username,
                  email: adminUser.email || '',
                  role: adminUser.role,
                  shop_id: adminUser.shop_id,
                  permissions: adminUser.permissions || []
                },
                shop_config: {
                  plan_name: 'Pro',
                  product_limit: 10000,
                  user_limit: 10,
                  status: 'active'
                }
              }
            }
          } catch (adminFallbackErr) {
            console.error('supabaseAdmin fallback exception:', adminFallbackErr)
          }
        }
      }

      if (!loginData || !loginData.success) {
        if (rpcError) {
          const errMsg = (rpcError.message || '').toLowerCase()
          const isNetworkError = errMsg.includes('fetch') ||
            errMsg.includes('network') ||
            errMsg.includes('failed to fetch') ||
            errMsg.includes('load failed') ||
            rpcError.code === 'NETWORK_ERROR' ||
            !navigator.onLine

          if (isNetworkError) {
            return attemptOfflineLogin()
          }

          setError(rpcError.message || 'Login service unavailable. Please contact support.')
          setLoading(false)
          return
        }

        let msg = loginData?.error || loginData?.message || 'Invalid username or password'
        if (msg.includes('multiple accounts') || msg.includes('Multiple accounts')) {
          msg = 'Multiple accounts share this username. Please sign in using your full email address.'
        }
        setError(msg)
        setLoading(false)
        return
      }

      const userData = loginData.user
      const shopConfig = loginData.shop_config || {}

      const sessionToken = loginData.session_token || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '00000000-0000-0000-0000-000000000001')
      localStorage.setItem('session_token', sessionToken)
      if (userData?.id && userData?.shop_id) {
        supabase.from('sessions').upsert({
          token: sessionToken,
          user_id: userData.id,
          shop_id: userData.shop_id,
          branch_id: userData.branch_id || null,
          expires_at: new Date(Date.now() + 30 * 86400000).toISOString()
        }, { onConflict: 'token' }).then(() => {}).catch(() => {})
      }

      // Superadmin Redirect Fast-Path
      const isSuperadmin = userData.role === 'superadmin' ||
                           userData.username?.toLowerCase() === 'superadmin' ||
                           cleanUsername.toLowerCase() === 'babarjoya@gmail.com' ||
                           userData.email?.toLowerCase() === 'babarjoya@gmail.com'

      if (isSuperadmin) {
        const sessionUser = {
          id: userData.id,
          username: userData.username || 'Superadmin',
          email: userData.email || cleanUsername,
          role: 'superadmin',
          shop_id: userData.shop_id || null,
          permissions: userData.permissions || []
        }
        login(sessionUser)
        localStorage.setItem('user_pw_hash', hashedPassword)
        localStorage.setItem('superadmin_session', JSON.stringify(sessionUser))
        window.location.href = '/admin'
        return
      }

      if (userData.shop_id) {
        localStorage.setItem('last_shop_id', userData.shop_id)
      }

      if (shopConfig?.shop_name) {
        localStorage.setItem(`shop_name_${userData.shop_id}`, shopConfig.shop_name)
        setPlatformName(shopConfig.shop_name)
      }
      if (shopConfig?.logo_url) {
        localStorage.setItem(`shop_logo_${userData.shop_id}`, shopConfig.logo_url)
        setLogoUrl(shopConfig.logo_url)
      }

      if (shopConfig?.currency) {
        const currentSettings = JSON.parse(localStorage.getItem(`shop_settings_${userData.shop_id}`) || '{}')
        localStorage.setItem(`shop_settings_${userData.shop_id}`, JSON.stringify({
          ...currentSettings,
          currency: shopConfig.currency
        }))
      }

      if (!userData.id || !userData.shop_id || !userData.role) {
        setError('Invalid login response. Please contact support.')
        setLoading(false)
        return
      }

      localStorage.setItem(`plan_limits_${userData.shop_id}`, JSON.stringify({
        product_limit: shopConfig?.product_limit || 100,
        user_limit: shopConfig?.user_limit || 3,
        plan_name: shopConfig?.plan_name || 'Trial',
        status: shopConfig?.status || 'active',
        next_billing_date: shopConfig?.next_billing_date || null,
        subscription_fee: shopConfig?.subscription_fee || 0
      }))
      localStorage.setItem(`plan_features_${userData.shop_id}`, JSON.stringify(shopConfig?.features || {}))

      try {
        await localDB.users.put({
          id: userData.id,
          username: userData.username,
          email: userData.email || '',
          password: hashedPassword,
          role: userData.role,
          shop_id: userData.shop_id,
          is_active: true,
          permissions: userData.permissions || [],
          last_sync: new Date().toISOString()
        })
      } catch (dbError) {
        console.warn('Could not save to IndexedDB:', dbError)
      }

      localStorage.setItem('user_pw_hash', hashedPassword)

      await rlsSession.setSession({
        id: userData.id,
        shop_id: userData.shop_id,
        role: userData.role
      })

      login({
        id: userData.id,
        username: userData.username,
        email: userData.email || '',
        role: userData.role,
        shop_id: userData.shop_id,
        branch_id: userData.branch_id || null,
        branch_name: userData.branch_name || 'Main Branch',
        permissions: userData.permissions || []
      }, loginData?.authorized_shops || [], loginData?.branches || [])

      navigate('/dashboard')

    } catch (networkError) {
      console.error('Network or auth error during login:', networkError)
      return attemptOfflineLogin()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#faf8ff] text-[#131b2e] flex flex-col justify-between selection:bg-[#4338ca] selection:text-white relative">

      {/* Top Architecture Bar */}
      <header className="relative z-20 px-6 sm:px-10 py-3.5 bg-white border-b border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-[#f2f3ff] border border-[#c7c4d7]/70 p-1 flex items-center justify-center shrink-0">
            <img src={logoUrl} alt={platformName} className="w-full h-full object-contain" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-[#131b2e] tracking-tight">
              {platformName}
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold font-mono uppercase tracking-[0.04em] bg-[#f2f3ff] text-[#464554] border border-[#c7c4d7]/60">
              SYS // POS
            </span>
          </div>
        </div>

        {/* System & Telemetry Status Indicators */}
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono text-[#64748b] bg-[#f8fafc] border border-[#E2E8F0]">
            <Terminal size={12} className="text-[#4338ca]" />
            <span>NODE: LOCAL-HOST</span>
          </div>
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border ${
            isOnline
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            <span className="text-[11px] font-mono font-medium">{isOnline ? 'ONLINE' : 'OFFLINE MODE'}</span>
          </div>
        </div>
      </header>

      {/* Broadcast Announcement Banner */}
      <div className="relative z-20">
        <BroadcastBanner isLogin />
      </div>

      {/* Main Content: Disciplined Precision Architecture */}
      <main className="relative z-10 flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-8 sm:py-12 flex items-center justify-center">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 w-full items-center">

          {/* Left Column: Utilitarian Spec / Operational Telemetry (Desktop) */}
          <div className="hidden lg:block lg:col-span-7 space-y-6 text-left">
            {/* System Tag */}
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded text-[11px] font-semibold uppercase tracking-[0.04em] bg-[#eaedff] text-[#2a14b4] border border-[#c1beff]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4338ca]" />
              <span>Disciplined Retail Architecture</span>
            </div>

            {/* Headline */}
            <div className="space-y-3">
              <h1 className="text-3xl lg:text-[34px] font-semibold text-[#131b2e] tracking-[-0.025em] leading-[1.2]">
                High-density precision for mobile retail & serialized inventory.
              </h1>
              <p className="text-[14px] text-[#464554] leading-[22px] max-w-xl">
                Engineered for rapid checkout, dual-IMEI tracking, counterparty ledgers, and zero-latency offline synchronization across local hardware terminals.
              </p>
            </div>

            {/* Structured Specifications Cards */}
            <div className="grid grid-cols-3 gap-3 pt-2">
              <div className="p-3.5 rounded-md bg-white border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-2">
                <div className="w-7 h-7 rounded bg-[#f2f3ff] border border-[#c7c4d7]/70 text-[#4338ca] flex items-center justify-center">
                  <Smartphone size={15} />
                </div>
                <h3 className="text-xs font-semibold text-[#131b2e] tracking-tight">IMEI & PTA Engine</h3>
                <p className="text-[11px] text-[#64748b] leading-[15px]">
                  Dual-IMEI validation, box-pack grading, and official warranty lifecycle tracking.
                </p>
              </div>

              <div className="p-3.5 rounded-md bg-white border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-2">
                <div className="w-7 h-7 rounded bg-[#f2f3ff] border border-[#c7c4d7]/70 text-[#0058be] flex items-center justify-center">
                  <Receipt size={15} />
                </div>
                <h3 className="text-xs font-semibold text-[#131b2e] tracking-tight">Direct Slips</h3>
                <p className="text-[11px] text-[#64748b] leading-[15px]">
                  Bilingual Urdu/English WhatsApp receipts and thermal ESC/POS dispatch.
                </p>
              </div>

              <div className="p-3.5 rounded-md bg-white border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-2">
                <div className="w-7 h-7 rounded bg-[#f2f3ff] border border-[#c7c4d7]/70 text-[#4338ca] flex items-center justify-center">
                  <Users size={15} />
                </div>
                <h3 className="text-xs font-semibold text-[#131b2e] tracking-tight">Ledgers & Khata</h3>
                <p className="text-[11px] text-[#64748b] leading-[15px]">
                  Dealer balances, customer credit registers, and daily cash drawer reconciliation.
                </p>
              </div>
            </div>

            {/* Mechanical Architecture Chips */}
            <div className="pt-2 flex flex-wrap items-center gap-2 text-[11px] font-mono text-[#64748b]">
              <span className="px-2 py-0.5 rounded bg-[#f2f3ff] border border-[#c7c4d7]/60">IDB-VAULT</span>
              <span className="px-2 py-0.5 rounded bg-[#f2f3ff] border border-[#c7c4d7]/60">RLS-ISOLATED</span>
              <span className="px-2 py-0.5 rounded bg-[#f2f3ff] border border-[#c7c4d7]/60">PWA-OFFLINE-READY</span>
              <span className="px-2 py-0.5 rounded bg-[#f2f3ff] border border-[#c7c4d7]/60">256-BIT-AUTH</span>
            </div>
          </div>

          {/* Right Column: Disciplined Precision Terminal Card */}
          <div className="lg:col-span-5 w-full flex justify-center">
            <div className="w-full max-w-[400px] bg-white border border-[#E2E8F0] rounded-lg p-6 sm:p-7 shadow-[0_4px_6px_-1px_rgba(15,23,42,0.05),0_2px_4px_-2px_rgba(15,23,42,0.03)] space-y-5 text-left">
              
              {/* Card Header & Workstation Metadata */}
              <div className="border-b border-[#E2E8F0] pb-4 space-y-1">
                <div className="flex items-center justify-between mb-2">
                  <div className="w-9 h-9 rounded-md bg-[#f2f3ff] border border-[#c7c4d7]/70 p-1.5 flex items-center justify-center">
                    <img src={logoUrl} alt={platformName} className="max-w-full max-h-full object-contain" />
                  </div>
                  <span className="text-[10px] font-mono uppercase font-semibold tracking-wider text-[#64748b] bg-[#f8fafc] px-2 py-0.5 rounded border border-[#E2E8F0]">
                    TERMINAL AUTH
                  </span>
                </div>
                <h2 className="text-xl font-semibold text-[#131b2e] tracking-[-0.015em]">
                  Sign In to EdgeX
                </h2>
                <p className="text-xs text-[#64748b]">
                  Authenticate operator credentials to mount workspace session.
                </p>
              </div>

              {/* Login Form */}
              <form onSubmit={handleLogin} className="space-y-4">
                
                {/* Username Input */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.04em] text-[#464554]">
                    Operator ID / Username
                  </label>
                  <div className="relative rounded-md border border-[#c7c4d7] bg-white focus-within:border-[#4338ca] focus-within:ring-4 focus-within:ring-[#4338ca]/12 transition-all">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#777586]">
                      <User size={15} />
                    </div>
                    <input
                      type="text"
                      placeholder="admin or username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      autoComplete="username"
                      className="w-full bg-transparent pl-9 pr-3 py-2 text-sm text-[#131b2e] placeholder:text-[#777586]/70 focus:outline-none font-sans"
                    />
                  </div>
                </div>

                {/* Password Input */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="block text-[11px] font-semibold uppercase tracking-[0.04em] text-[#464554]">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={handleQuickDemoFill}
                      className="text-[11px] font-medium text-[#0058be] hover:text-[#2a14b4] bg-[#f2f3ff] hover:bg-[#eaedff] px-2 py-0.5 rounded border border-[#c7c4d7]/60 shadow-[inset_0_-1px_0_#CBD5E1] transition-all cursor-pointer"
                    >
                      ⚡ Demo Fill
                    </button>
                  </div>
                  <div className="relative rounded-md border border-[#c7c4d7] bg-white focus-within:border-[#4338ca] focus-within:ring-4 focus-within:ring-[#4338ca]/12 transition-all">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#777586]">
                      <Lock size={15} />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      className="w-full bg-transparent pl-9 pr-9 py-2 text-sm text-[#131b2e] placeholder:text-[#777586]/70 focus:outline-none font-sans"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#777586] hover:text-[#131b2e] transition-colors cursor-pointer"
                      tabIndex={-1}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                {/* Error Banner */}
                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="p-2.5 bg-[#ffdad6]/50 border border-[#ba1a1a]/40 rounded-md text-xs text-[#93000a] leading-relaxed font-medium flex items-start gap-2">
                        <span className="shrink-0 mt-0.5">⚠️</span>
                        <span>{error}</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Submit Action Button with Tactile Inner Chamfer */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-[#4338ca] hover:bg-[#3730a3] active:bg-[#2a14b4] text-white font-medium text-sm rounded-md shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_2px_rgba(15,23,42,0.08)] flex items-center justify-center gap-2 cursor-pointer transition duration-150 disabled:opacity-60 disabled:cursor-not-allowed mt-2"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <span>Authenticate Session</span>
                      <ArrowRight size={15} />
                    </>
                  )}
                </button>
              </form>

              {/* Card Micro-Security Specifications */}
              <div className="pt-3 border-t border-[#E2E8F0] text-center">
                <p className="text-[11px] font-mono text-[#64748b]">
                  SECURE LOCAL WORKSTATION • IDB V2.4
                </p>
              </div>

            </div>
          </div>

        </div>
      </main>

      {/* Structured Footer */}
      <footer className="relative z-10 px-6 py-3.5 bg-white border-t border-[#E2E8F0] text-xs text-[#64748b]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
          <div>
            &copy; {new Date().getFullYear()} {platformName}. Disciplined Precision POS OS.
          </div>
          <div className="flex items-center gap-3">
            <span>Terminal Core</span>
            <span>•</span>
            <a
              href="https://wa.me/923012616367?text=Hi!%20I%20need%20support%20for%20EdgeX%20POS."
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#0058be] hover:text-[#2a14b4] hover:underline font-medium transition"
            >
              Direct Support: 0301-2616367
            </a>
          </div>
        </div>
      </footer>

    </div>
  )
}

export default Login
