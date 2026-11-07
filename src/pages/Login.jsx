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
  ShieldCheck,
  Sparkles,
  Wifi,
  WifiOff
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
        const lastShopId = localStorage.getItem('last_shop_id')
        if (lastShopId && String(lastShopId) !== String(userData.shop_id)) {
          try {
            await Promise.all([
              localDB.products.clear(),
              localDB.categories.clear(),
              localDB.suppliers.clear(),
              localDB.customers.clear(),
              localDB.brands.clear(),
              localDB.sales.clear(),
              localDB.sale_items.clear(),
              localDB.purchases.clear(),
              localDB.purchase_items.clear(),
              localDB.expenses.clear(),
              localDB.customer_payments.clear(),
              localDB.supplier_payments.clear(),
              localDB.held_carts.clear(),
              localDB.phones?.clear ? localDB.phones.clear() : Promise.resolve()
            ])
          } catch (_) { /* no-op */ }
        }
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
    <div className="min-h-screen relative flex flex-col justify-between overflow-hidden font-sans selection:bg-[#0071e3] selection:text-white">

      {/* ── 1. SEMI-TRANSPARENT POS BACKGROUND IMAGE & LIGHT APPLE FROST ── */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        {/* Subtle pan/zoom background image */}
        <motion.div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: 'url("/mobile_shop_bg.jpg")' }}
          initial={{ scale: 1 }}
          animate={{ scale: [1, 1.04, 1] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Apple Light Translucent Frosted Glass Veil */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/80 via-slate-50/75 to-white/85 backdrop-blur-[4px]" />

        {/* Soft, delicate iOS atmospheric color bubbles */}
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-blue-400/15 blur-[90px]" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-indigo-300/20 blur-[100px]" />
      </div>

      {/* ── 2. FROSTED TRANSLUCENT APPLE GLASS HEADER ── */}
      <header className="relative z-20 px-6 sm:px-10 py-3.5 bg-white/70 backdrop-blur-xl border-b border-black/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-white shadow-sm border border-black/[0.06] p-1.5 flex items-center justify-center shrink-0">
            <img src={logoUrl} alt={platformName} className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base text-[#1d1d1f] tracking-tight">
                {platformName}
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-500/10 text-[#0071e3] border border-blue-500/20">
                POS
              </span>
            </div>
            <p className="text-[11px] text-[#86868b] hidden sm:block">
              Mobile Store Retail & Serialized Inventory
            </p>
          </div>
        </div>

        {/* Apple Status Capsule */}
        <div className="flex items-center gap-2.5">
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold backdrop-blur-md transition-colors ${
            isOnline
              ? 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/25'
              : 'bg-amber-500/10 text-amber-700 border border-amber-500/25'
          }`}>
            {isOnline ? (
              <>
                <Wifi size={13} className="text-emerald-600" />
                <span className="text-[11px] font-medium">Terminal Online</span>
              </>
            ) : (
              <>
                <WifiOff size={13} className="text-amber-600" />
                <span className="text-[11px] font-medium">Offline Ready</span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Broadcast Announcement Banner */}
      <div className="relative z-20">
        <BroadcastBanner isLogin />
      </div>

      {/* ── 3. MAIN CONTENT: LIGHT APPLE SPLIT EXPERIENCE ── */}
      <main className="relative z-10 flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-8 sm:py-12 flex items-center justify-center">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 w-full items-center">

          {/* Left Column: Apple Product Showcase Cards (Desktop) */}
          <div className="hidden lg:block lg:col-span-7 space-y-6 text-left">
            {/* Soft Capsule Tag */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/80 backdrop-blur-md border border-black/[0.06] shadow-sm text-xs font-semibold text-[#0071e3]">
              <Sparkles size={14} className="text-[#0071e3]" />
              <span>Tailored for Smartphone & Electronics Showrooms</span>
            </div>

            {/* Hero Heading */}
            <div className="space-y-3">
              <h1 className="text-4xl lg:text-[42px] font-black text-[#1d1d1f] tracking-tight leading-[1.15]">
                Complete Control Over Every{' '}
                <span className="bg-gradient-to-r from-[#0071e3] to-[#5856d6] bg-clip-text text-transparent">
                  IMEI & Sale.
                </span>
              </h1>
              <p className="text-[#86868b] text-[15px] leading-relaxed max-w-xl">
                Experience high-speed barcode checkout, automated bilingual WhatsApp receipts, instant customer credit ledgers, and multi-vault inventory protection.
              </p>
            </div>

            {/* Apple Squircle Feature Cards */}
            <div className="grid grid-cols-3 gap-3.5 pt-2">
              <div className="p-4 rounded-2xl bg-white/75 hover:bg-white/90 backdrop-blur-xl border border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_25px_rgba(0,0,0,0.06)] transition-all space-y-2.5">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-[#0071e3] border border-blue-500/20 flex items-center justify-center">
                  <Smartphone size={20} />
                </div>
                <h3 className="text-xs font-bold text-[#1d1d1f]">Dual IMEI & PTA</h3>
                <p className="text-[11px] text-[#86868b] leading-[15px]">
                  Tracks box-pack, used, PTA approved, and warranty statuses seamlessly.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-white/75 hover:bg-white/90 backdrop-blur-xl border border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_25px_rgba(0,0,0,0.06)] transition-all space-y-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 flex items-center justify-center">
                  <Receipt size={20} />
                </div>
                <h3 className="text-xs font-bold text-[#1d1d1f]">WhatsApp Slips</h3>
                <p className="text-[11px] text-[#86868b] leading-[15px]">
                  Dispatches branded customer invoices directly to phone with warranty notes.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-white/75 hover:bg-white/90 backdrop-blur-xl border border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_25px_rgba(0,0,0,0.06)] transition-all space-y-2.5">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-[#af52de] border border-purple-500/20 flex items-center justify-center">
                  <Users size={20} />
                </div>
                <h3 className="text-xs font-bold text-[#1d1d1f]">Khata & Ledgers</h3>
                <p className="text-[11px] text-[#86868b] leading-[15px]">
                  Dealer udhaar, supplier balance tracking, and daily cash drawer shifts.
                </p>
              </div>
            </div>

            {/* Apple Trust Pill */}
            <div className="flex items-center gap-2 text-xs font-medium text-[#86868b] pt-1">
              <ShieldCheck size={16} className="text-emerald-500" />
              <span>Offline-first PWA sync • Thermal ESC/POS ready • Bank transfer reconciliation</span>
            </div>
          </div>

          {/* Right Column: Apple Frosted Glass Login Card */}
          <div className="lg:col-span-5 w-full flex justify-center">
            <div className="w-full max-w-md bg-white/80 backdrop-blur-2xl border border-white/90 rounded-3xl p-7 sm:p-9 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.04)] space-y-6 text-left relative overflow-hidden">
              
              {/* Card Header */}
              <div className="text-center space-y-2">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-white p-2.5 shadow-md shadow-black/[0.04] border border-black/[0.06] flex items-center justify-center">
                  <img src={logoUrl} alt={platformName} className="max-w-full max-h-full object-contain" />
                </div>

                <div>
                  <h2 className="text-2xl font-bold text-[#1d1d1f] tracking-tight">
                    Sign in to EdgeX
                  </h2>
                  <p className="text-xs sm:text-sm text-[#86868b] mt-0.5">
                    Enter your staff credentials to continue
                  </p>
                </div>
              </div>

              {/* Login Form */}
              <form onSubmit={handleLogin} className="space-y-4">
                
                {/* Username Input */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#6e6e73] ml-0.5">
                    Username or Email
                  </label>
                  <div className="relative rounded-xl border border-slate-200/80 bg-white/90 hover:bg-white focus-within:bg-white focus-within:border-[#0071e3] focus-within:ring-4 focus-within:ring-[#0071e3]/15 transition-all shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#86868b]">
                      <User size={16} />
                    </div>
                    <input
                      type="text"
                      placeholder="admin or user@domain.com"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      autoComplete="username"
                      className="w-full bg-transparent pl-10 pr-3 py-3 text-sm text-[#1d1d1f] placeholder:text-[#86868b]/70 focus:outline-none font-medium"
                    />
                  </div>
                </div>

                {/* Password Input */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-0.5">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-[#6e6e73]">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={handleQuickDemoFill}
                      className="text-xs font-semibold text-[#0071e3] hover:text-[#0077ed] bg-blue-500/10 hover:bg-blue-500/15 px-2.5 py-0.5 rounded-full transition cursor-pointer"
                    >
                      ⚡ Fill Demo
                    </button>
                  </div>
                  <div className="relative rounded-xl border border-slate-200/80 bg-white/90 hover:bg-white focus-within:bg-white focus-within:border-[#0071e3] focus-within:ring-4 focus-within:ring-[#0071e3]/15 transition-all shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#86868b]">
                      <Lock size={16} />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      className="w-full bg-transparent pl-10 pr-11 py-3 text-sm text-[#1d1d1f] placeholder:text-[#86868b]/70 focus:outline-none font-medium"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[#86868b] hover:text-[#1d1d1f] transition-colors cursor-pointer"
                      tabIndex={-1}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* Error Banner with Smooth AnimatePresence */}
                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, height: 0, y: -4 }}
                      animate={{ opacity: 1, height: 'auto', y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="p-3 bg-rose-50 border border-rose-200/80 rounded-xl text-xs text-rose-700 leading-relaxed font-semibold flex items-start gap-2">
                        <span className="shrink-0 mt-0.5">⚠️</span>
                        <span>{error}</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Apple Blue Primary Action Button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 px-5 bg-[#0071e3] hover:bg-[#0077ed] active:scale-[0.985] text-white font-semibold text-sm rounded-xl transition-all duration-150 shadow-md shadow-blue-500/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed mt-2"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <span>Sign In</span>
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </form>

              {/* Card Footer Micro-note */}
              <div className="pt-3 border-t border-black/[0.06] text-center">
                <p className="text-[11px] text-[#86868b]">
                  Offline PWA Ready • Serialized Hardware Vault Encrypted
                </p>
              </div>

            </div>
          </div>

        </div>
      </main>

      {/* ── 4. LIGHT APPLE GLASS FOOTER ── */}
      <footer className="relative z-10 px-6 py-3.5 bg-white/70 backdrop-blur-md border-t border-black/[0.06] text-xs text-[#86868b]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
          <div>
            &copy; {new Date().getFullYear()} {platformName}. All rights reserved.
          </div>
          <div className="flex items-center gap-3">
            <span>Enterprise Mobile Retail POS</span>
            <span>•</span>
            <a
              href="https://wa.me/923012616367?text=Hi!%20I%20need%20support%20for%20EdgeX%20POS."
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#0071e3] hover:text-[#0077ed] hover:underline font-semibold transition"
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
