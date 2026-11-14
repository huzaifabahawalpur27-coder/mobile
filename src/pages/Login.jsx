import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
// eslint-disable-next-line no-unused-vars
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { supabase, rlsSession } from '../services/supabase'
import { supabaseAdmin } from '../services/supabaseAdmin'
import { db as localDB } from '../services/db'
import { hashPassword } from '../utils/authUtils'
import { RELOGIN_NOTICE_KEY } from '../services/sessionHealth'
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
  WifiOff,
  Sun,
  Moon
} from 'lucide-react'
import BroadcastBanner from '../components/BroadcastBanner'
import { useTheme } from '../context/ThemeContext'

function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  // Shows why the user was signed out (e.g. the server did not recognise the session)
  const [error, setError] = useState(() => {
    try { return sessionStorage.getItem(RELOGIN_NOTICE_KEY) || '' } catch (_) { return '' }
  })
  useEffect(() => {
    try { sessionStorage.removeItem(RELOGIN_NOTICE_KEY) } catch (_) { /* optional */ }
  }, [])
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
  const { isDark, toggleTheme } = useTheme()
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
          setError('Cannot reach the server, and this device has no saved login for offline use. Log in once while online.')
          setLoading(false)
          return false
        }

        if (localUser.password !== hashedPassword) {
          setError('Offline: the password is wrong.')
          setLoading(false)
          return false
        }

        if (localUser.is_active === false) {
          setError('Offline: this account is inactive.')
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

      // Use only the token secure_login created on the server. Never invent one: the
      // server would not recognise it and every screen would load empty.
      if (loginData.session_token) {
        localStorage.setItem('session_token', loginData.session_token)
      } else {
        localStorage.removeItem('session_token')
        console.warn('Login reply had no session_token; the server will not recognise this session.')
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
    <div className="min-h-[100dvh] relative flex flex-col overflow-hidden font-sans selection:bg-[#0071e3] selection:text-white text-[#1d1d1f] dark:text-[#f5f5f7]">

      {/* Background: soft showroom image + theme-aware frost */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: 'url("/mobile_shop_bg.jpg")' }}
          initial={{ scale: 1 }}
          animate={{ scale: [1, 1.04, 1] }}
          transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-white/88 via-slate-50/85 to-white/92 dark:from-[#0b0b0f]/88 dark:via-[#0b0b12]/90 dark:to-black/92 backdrop-blur-[6px]" />
        <div className="absolute -top-40 -left-40 w-[32rem] h-[32rem] rounded-full bg-blue-400/12 dark:bg-blue-500/15 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 w-[32rem] h-[32rem] rounded-full bg-indigo-300/16 dark:bg-indigo-600/15 blur-[120px]" />
      </div>

      {/* Header */}
      <header className="relative z-20 px-4 sm:px-8 lg:px-10 py-3.5 bg-white/70 dark:bg-slate-900/55 backdrop-blur-xl border-b border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-black/[0.06] dark:border-white/[0.08] p-1.5 flex items-center justify-center shrink-0">
            <img src={logoUrl} alt={platformName} className="w-full h-full object-contain" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-base text-[#1d1d1f] dark:text-white tracking-tight truncate">
                {platformName}
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-[#0071e3] dark:text-[#2997ff] border border-blue-500/20">
                POS
              </span>
            </div>
            <p className="text-xs text-[#6e6e73] dark:text-slate-400 hidden sm:block">
              Mobile Shop Billing &amp; Stock
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold backdrop-blur-md transition-colors ${
            isOnline
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25'
              : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/25'
          }`}>
            {isOnline ? (
              <>
                <Wifi size={13} className="text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs font-medium hidden sm:inline">Terminal Online</span>
              </>
            ) : (
              <>
                <WifiOff size={13} className="text-amber-600 dark:text-amber-400" />
                <span className="text-xs font-medium hidden sm:inline">Offline Ready</span>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="w-9 h-9 rounded-full bg-white/70 dark:bg-slate-800 border border-black/[0.06] dark:border-white/[0.08] text-[#1d1d1f] dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 active:scale-95 flex items-center justify-center transition cursor-pointer shrink-0"
          >
            {isDark ? <Sun size={16} className="text-[#ff9f0a]" /> : <Moon size={16} className="text-[#5856d6]" />}
          </button>
        </div>
      </header>

      {/* Broadcast banner */}
      <div className="relative z-20">
        <BroadcastBanner isLogin />
      </div>

      {/* Split experience */}
      <main className="relative z-10 flex-1 w-full max-w-6xl mx-auto px-4 sm:px-8 py-8 sm:py-12 flex items-center justify-center">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 w-full items-center">

          {/* Left: product story (desktop only) */}
          <div className="hidden lg:block lg:col-span-7 space-y-7 text-left">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/80 dark:bg-slate-800/70 backdrop-blur-md border border-black/[0.06] dark:border-white/[0.08] shadow-sm text-xs font-semibold text-[#0071e3] dark:text-[#2997ff]">
              <Sparkles size={14} />
              <span>Made for mobile &amp; electronics shops</span>
            </div>

            <div className="space-y-4">
              <h1 className="text-4xl lg:text-[44px] font-black text-[#1d1d1f] dark:text-white tracking-tight leading-[1.1]">
                Full control of every phone, IMEI{' '}
                <span className="bg-gradient-to-r from-[#0071e3] to-[#5856d6] dark:from-[#2997ff] dark:to-[#7d7aff] bg-clip-text text-transparent">
                  &amp; sale.
                </span>
              </h1>
              <p dir="rtl" lang="ur" className="text-[#1d1d1f] dark:text-slate-200 text-base font-semibold leading-relaxed max-w-xl">
                ہر فون، ہر آئی ایم ای آئی اور ہر بکری کا مکمل حساب — ایک ہی جگہ۔
              </p>
              <p className="text-[#6e6e73] dark:text-slate-400 text-[15px] leading-relaxed max-w-xl">
                Fast barcode billing, automatic WhatsApp receipts, customer khata (udhaar), and safe stock records &mdash; built for a busy shop counter.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-1">
              <div className="p-5 rounded-2xl bg-white/80 dark:bg-slate-900/60 backdrop-blur-xl border border-black/[0.05] dark:border-white/[0.08] shadow-[0_6px_24px_rgba(0,0,0,0.04)] dark:shadow-[0_6px_24px_rgba(0,0,0,0.35)] hover:shadow-[0_10px_30px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all space-y-3">
                <div className="w-11 h-11 rounded-xl bg-blue-500/10 text-[#0071e3] dark:text-[#2997ff] border border-blue-500/20 flex items-center justify-center">
                  <Smartphone size={20} />
                </div>
                <h3 className="text-sm font-bold text-[#1d1d1f] dark:text-white">IMEI &amp; PTA</h3>
                <p className="text-xs text-[#6e6e73] dark:text-slate-400 leading-relaxed">
                  Save each phone&apos;s IMEI, PTA status and warranty.
                </p>
                <p dir="rtl" lang="ur" className="text-[11px] text-[#6e6e73] dark:text-slate-400 leading-relaxed">
                  ہر فون کا آئی ایم ای آئی، پی ٹی اے اور وارنٹی محفوظ۔
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-white/80 dark:bg-slate-900/60 backdrop-blur-xl border border-black/[0.05] dark:border-white/[0.08] shadow-[0_6px_24px_rgba(0,0,0,0.04)] dark:shadow-[0_6px_24px_rgba(0,0,0,0.35)] hover:shadow-[0_10px_30px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all space-y-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
                  <Receipt size={20} />
                </div>
                <h3 className="text-sm font-bold text-[#1d1d1f] dark:text-white">WhatsApp Bill</h3>
                <p className="text-xs text-[#6e6e73] dark:text-slate-400 leading-relaxed">
                  Send the bill and warranty to the customer on WhatsApp.
                </p>
                <p dir="rtl" lang="ur" className="text-[11px] text-[#6e6e73] dark:text-slate-400 leading-relaxed">
                  گاہک کو بل اور وارنٹی واٹس ایپ پر بھیجیں۔
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-white/80 dark:bg-slate-900/60 backdrop-blur-xl border border-black/[0.05] dark:border-white/[0.08] shadow-[0_6px_24px_rgba(0,0,0,0.04)] dark:shadow-[0_6px_24px_rgba(0,0,0,0.35)] hover:shadow-[0_10px_30px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all space-y-3">
                <div className="w-11 h-11 rounded-xl bg-purple-500/10 text-[#af52de] dark:text-[#c77dff] border border-purple-500/20 flex items-center justify-center">
                  <Users size={20} />
                </div>
                <h3 className="text-sm font-bold text-[#1d1d1f] dark:text-white">Khata &amp; Udhaar</h3>
                <p className="text-xs text-[#6e6e73] dark:text-slate-400 leading-relaxed">
                  Customer and dealer udhaar, with a daily cash record.
                </p>
                <p dir="rtl" lang="ur" className="text-[11px] text-[#6e6e73] dark:text-slate-400 leading-relaxed">
                  گاہک اور ڈیلر کا ادھار اور روزانہ کیش کا حساب۔
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs font-medium text-[#6e6e73] dark:text-slate-400 pt-1">
              <ShieldCheck size={16} className="text-emerald-500 dark:text-emerald-400 shrink-0" />
              <span>Works without internet &bull; Thermal receipt printing &bull; Bank &amp; cash matching</span>
            </div>
          </div>

          {/* Right: login card */}
          <div className="lg:col-span-5 w-full flex justify-center">
            <div className="w-full max-w-md bg-white/85 dark:bg-slate-900/70 backdrop-blur-2xl border border-white/90 dark:border-white/10 rounded-3xl p-6 sm:p-9 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.04)] dark:shadow-[0_25px_60px_-15px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.05)] space-y-6 text-left">

              <div className="text-center space-y-2">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-white dark:bg-slate-800 p-2.5 shadow-md shadow-black/[0.04] border border-black/[0.06] dark:border-white/[0.08] flex items-center justify-center">
                  <img src={logoUrl} alt={platformName} className="max-w-full max-h-full object-contain" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-[#1d1d1f] dark:text-white tracking-tight">
                    Sign in to {platformName}
                  </h2>
                  <p className="text-xs sm:text-sm text-[#6e6e73] dark:text-slate-400 mt-0.5">
                    Enter your username and password
                  </p>
                  <p dir="rtl" lang="ur" className="text-xs text-[#6e6e73] dark:text-slate-400 mt-1">
                    اپنا یوزرنیم اور پاس ورڈ درج کریں
                  </p>
                </div>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#6e6e73] dark:text-slate-400 ml-0.5">
                    Username or Email <span dir="rtl" lang="ur" className="normal-case tracking-normal font-medium text-[#86868b] dark:text-slate-500">(یوزرنیم یا ای میل)</span>
                  </label>
                  <div className="relative rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white/90 dark:bg-slate-800/80 hover:bg-white dark:hover:bg-slate-800 focus-within:bg-white dark:focus-within:bg-slate-800 focus-within:border-[#0071e3] focus-within:ring-4 focus-within:ring-[#0071e3]/15 transition-all shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#86868b] dark:text-slate-500">
                      <User size={16} />
                    </div>
                    <input
                      type="text"
                      placeholder="admin or user@domain.com"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      autoComplete="username"
                      className="w-full bg-transparent pl-10 pr-3 py-3 text-sm text-[#1d1d1f] dark:text-white placeholder:text-[#86868b]/70 dark:placeholder:text-slate-500 focus:outline-none font-medium"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-0.5">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-[#6e6e73] dark:text-slate-400">
                      Password <span dir="rtl" lang="ur" className="normal-case tracking-normal font-medium text-[#86868b] dark:text-slate-500">(پاس ورڈ)</span>
                    </label>
                    <button
                      type="button"
                      onClick={handleQuickDemoFill}
                      className="text-xs font-semibold text-[#0071e3] dark:text-[#2997ff] hover:text-[#0077ed] bg-blue-500/10 hover:bg-blue-500/15 dark:bg-blue-500/15 dark:hover:bg-blue-500/25 px-2.5 py-0.5 rounded-full transition cursor-pointer"
                    >
                      &#9889; Fill Demo
                    </button>
                  </div>
                  <div className="relative rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white/90 dark:bg-slate-800/80 hover:bg-white dark:hover:bg-slate-800 focus-within:bg-white dark:focus-within:bg-slate-800 focus-within:border-[#0071e3] focus-within:ring-4 focus-within:ring-[#0071e3]/15 transition-all shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#86868b] dark:text-slate-500">
                      <Lock size={16} />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      className="w-full bg-transparent pl-10 pr-11 py-3 text-sm text-[#1d1d1f] dark:text-white placeholder:text-[#86868b]/70 dark:placeholder:text-slate-500 focus:outline-none font-medium"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[#86868b] dark:text-slate-500 hover:text-[#1d1d1f] dark:hover:text-slate-200 transition-colors cursor-pointer"
                      tabIndex={-1}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, height: 0, y: -4 }}
                      animate={{ opacity: 1, height: 'auto', y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200/80 dark:border-rose-900/60 rounded-xl text-xs text-rose-700 dark:text-rose-300 leading-relaxed font-semibold flex items-start gap-2">
                        <span className="shrink-0 mt-0.5">&#9888;&#65039;</span>
                        <span>{error}</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

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

              <div className="pt-3 border-t border-black/[0.06] dark:border-white/[0.08] text-center">
                <p className="text-xs text-[#86868b] dark:text-slate-500">
                  Works offline &bull; Your data stays safe &amp; encrypted
                </p>
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 px-4 sm:px-6 py-3.5 bg-white/70 dark:bg-slate-900/55 backdrop-blur-md border-t border-black/[0.06] dark:border-white/[0.08] text-xs text-[#86868b] dark:text-slate-500">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
          <div>
            &copy; {new Date().getFullYear()} {platformName}. All rights reserved.
          </div>
          <div className="flex items-center gap-3">
            <span>Enterprise Mobile Retail POS</span>
            <span>&bull;</span>
            <a
              href="https://wa.me/923012616367?text=Hi!%20I%20need%20support%20for%20EdgeX%20POS."
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#0071e3] dark:text-[#2997ff] hover:text-[#0077ed] hover:underline font-semibold transition"
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
