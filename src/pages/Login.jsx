import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
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
  Wifi,
  WifiOff,
  Sparkles,
  CheckCircle2
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
    <div className="min-h-screen relative flex flex-col justify-between overflow-hidden font-sans selection:bg-blue-500 selection:text-white">

      {/* ── 1. CINEMATIC BACKGROUND: High-End Mobile Showroom & Flagship Phones ── */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        {/* Animated Background Image with Gentle Breathing Motion */}
        <motion.div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: 'url("/mobile_shop_bg.jpg")' }}
          initial={{ scale: 1 }}
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Semi-Transparent Glassmorphic Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-tr from-slate-950/90 via-slate-900/75 to-slate-950/85 backdrop-blur-[5px]" />

        {/* Dynamic Atmospheric Light Flares */}
        <motion.div
          animate={{
            opacity: [0.35, 0.55, 0.35],
            scale: [1, 1.15, 1]
          }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-[-15%] left-[10%] w-[500px] h-[500px] rounded-full bg-blue-500/20 blur-[130px]"
        />
        <motion.div
          animate={{
            opacity: [0.25, 0.45, 0.25],
            scale: [1, 1.2, 1]
          }}
          transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
          className="absolute bottom-[-10%] right-[15%] w-[600px] h-[600px] rounded-full bg-indigo-500/20 blur-[140px]"
        />
      </div>

      {/* ── 2. FROSTED GLASS HEADER ── */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative z-20 px-6 sm:px-10 py-4.5 border-b border-white/[0.08] bg-slate-950/40 backdrop-blur-xl flex items-center justify-between"
      >
        <div className="flex items-center gap-3.5">
          <motion.div
            whileHover={{ scale: 1.06, rotate: 2 }}
            className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-500 p-0.5 shadow-lg shadow-blue-500/30 flex items-center justify-center overflow-hidden"
          >
            <div className="w-full h-full bg-slate-950/80 rounded-[14px] p-1.5 flex items-center justify-center">
              <img src={logoUrl} alt={platformName} className="w-full h-full object-contain drop-shadow" />
            </div>
          </motion.div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-base text-white tracking-tight leading-none">
                {platformName}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30">
                POS OS
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 hidden sm:block">
              Mobile Store Retail & Serialized Inventory
            </p>
          </div>
        </div>

        {/* Live Network & Terminal Sync Status */}
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border backdrop-blur-md transition-colors ${
            isOnline
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
              : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
          }`}>
            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span className="text-[11px] font-semibold">{isOnline ? 'Terminal Online' : 'Offline Ready'}</span>
          </div>
        </div>
      </motion.header>

      {/* Broadcast Announcement Banner */}
      <div className="relative z-20">
        <BroadcastBanner isLogin />
      </div>

      {/* ── 3. MAIN CONTENT: Glassmorphic Split Experience ── */}
      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-8 sm:py-12 flex items-center justify-center">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 w-full items-center">

          {/* Left Column: Mobile Retail Showcase & Feature Pills (Desktop) */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="hidden lg:block lg:col-span-7 space-y-7 text-left"
          >
            {/* Tagline Badge */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.08] border border-white/[0.15] backdrop-blur-md text-xs font-semibold text-blue-300 shadow-sm">
              <Sparkles size={14} className="text-cyan-400 animate-spin-slow" />
              <span>Tailored for Smartphone & Electronics Showrooms</span>
            </div>

            {/* Hero Heading */}
            <div className="space-y-3">
              <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-[1.15]">
                Complete Control Over Every{' '}
                <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-300 bg-clip-text text-transparent">
                  IMEI & Sale.
                </span>
              </h1>
              <p className="text-slate-300 text-base leading-relaxed max-w-xl">
                Experience high-speed barcode checkout, automated bilingual WhatsApp receipts, instant customer credit ledgers, and multi-vault inventory protection.
              </p>
            </div>

            {/* Semi-Transparent Glass Feature Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-2 max-w-2xl">
              <motion.div
                whileHover={{ y: -4, borderColor: 'rgba(56, 189, 248, 0.4)' }}
                className="p-4 rounded-2xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.12] backdrop-blur-xl transition shadow-lg space-y-2"
              >
                <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-300 flex items-center justify-center">
                  <Smartphone size={18} />
                </div>
                <h3 className="text-xs font-bold text-white">Dual IMEI & PTA</h3>
                <p className="text-[11px] text-slate-300 leading-normal">
                  Tracks box pack, used, PTA approved, and warranty statuses seamlessly.
                </p>
              </motion.div>

              <motion.div
                whileHover={{ y: -4, borderColor: 'rgba(52, 211, 153, 0.4)' }}
                className="p-4 rounded-2xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.12] backdrop-blur-xl transition shadow-lg space-y-2"
              >
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 flex items-center justify-center">
                  <Receipt size={18} />
                </div>
                <h3 className="text-xs font-bold text-white">WhatsApp Slips</h3>
                <p className="text-[11px] text-slate-300 leading-normal">
                  Dispatches branded customer invoices directly to phone with warranty notes.
                </p>
              </motion.div>

              <motion.div
                whileHover={{ y: -4, borderColor: 'rgba(192, 132, 252, 0.4)' }}
                className="p-4 rounded-2xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.12] backdrop-blur-xl transition shadow-lg space-y-2"
              >
                <div className="w-9 h-9 rounded-xl bg-purple-500/20 border border-purple-400/30 text-purple-300 flex items-center justify-center">
                  <Users size={18} />
                </div>
                <h3 className="text-xs font-bold text-white">Khata & Ledgers</h3>
                <p className="text-[11px] text-slate-300 leading-normal">
                  Dealer udhaar, supplier balance tracking, and daily cash drawer reconciliation.
                </p>
              </motion.div>
            </div>

            {/* Subtle Enterprise Trust Pill */}
            <div className="flex items-center gap-2 text-xs text-slate-400 pt-1">
              <CheckCircle2 size={15} className="text-cyan-400" />
              <span>Offline-first PWA sync • Thermal ESC/POS ready • Bank transfer reconciliation</span>
            </div>
          </motion.div>

          {/* Right Column: Clean Glassmorphic Login Card */}
          <div className="lg:col-span-5 w-full flex justify-center">
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
              className="w-full max-w-md bg-slate-900/70 border border-white/[0.18] backdrop-blur-3xl rounded-[28px] p-6 sm:p-8 shadow-[0_30px_90px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.08)] space-y-6 relative overflow-hidden"
            >
              {/* Subtle Ambient Card Top Shimmer */}
              <div className="absolute top-0 left-1/4 right-1/4 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent pointer-events-none" />

              {/* Card Header */}
              <div className="text-center space-y-2">
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  className="w-16 h-16 mx-auto rounded-2xl bg-white/[0.08] border border-white/[0.15] p-2 flex items-center justify-center shadow-lg shadow-black/20 backdrop-blur-md"
                >
                  <img src={logoUrl} alt={platformName} className="max-w-full max-h-full object-contain drop-shadow" />
                </motion.div>

                <div>
                  <h2 className="text-2xl font-bold text-white tracking-tight">
                    Sign in to EdgeX
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-300 mt-0.5">
                    Enter your staff credentials to continue
                  </p>
                </div>
              </div>

              {/* Login Form */}
              <form onSubmit={handleLogin} className="space-y-4">
                {/* Username Input */}
                <div className="space-y-1.5 text-left">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300 ml-0.5">
                    Username or Email
                  </label>
                  <div className="relative rounded-xl border border-white/[0.18] bg-white/[0.07] hover:bg-white/[0.1] focus-within:bg-slate-950/60 focus-within:border-cyan-400 focus-within:ring-4 focus-within:ring-cyan-500/20 transition-all duration-200">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <User size={16} />
                    </div>
                    <input
                      type="text"
                      placeholder="admin or user@domain.com"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      autoComplete="username"
                      className="w-full bg-transparent pl-10 pr-3 py-3 text-sm text-white placeholder:text-slate-400 focus:outline-none font-medium"
                    />
                  </div>
                </div>

                {/* Password Input */}
                <div className="space-y-1.5 text-left">
                  <div className="flex items-center justify-between px-0.5">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={handleQuickDemoFill}
                      className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition cursor-pointer"
                    >
                      ⚡ Fill Demo
                    </button>
                  </div>
                  <div className="relative rounded-xl border border-white/[0.18] bg-white/[0.07] hover:bg-white/[0.1] focus-within:bg-slate-950/60 focus-within:border-cyan-400 focus-within:ring-4 focus-within:ring-cyan-500/20 transition-all duration-200">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Lock size={16} />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      className="w-full bg-transparent pl-10 pr-11 py-3 text-sm text-white placeholder:text-slate-400 focus:outline-none font-medium"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-white transition-colors cursor-pointer"
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
                      initial={{ opacity: 0, height: 0, y: -6 }}
                      animate={{ opacity: 1, height: 'auto', y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="p-3 bg-red-500/20 border border-red-500/40 rounded-xl text-xs text-red-200 leading-relaxed font-semibold flex items-start gap-2">
                        <span className="shrink-0 mt-0.5">⚠️</span>
                        <span>{error}</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Dynamic Glowing Sign-In Action Button */}
                <motion.button
                  type="submit"
                  disabled={loading}
                  whileHover={{ scale: 1.015 }}
                  whileTap={{ scale: 0.985 }}
                  className="w-full py-3.5 px-5 bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 hover:from-blue-500 hover:via-indigo-500 hover:to-cyan-400 text-white font-bold text-sm rounded-xl transition duration-200 shadow-[0_4px_24px_rgba(37,99,235,0.45)] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed mt-2"
                >
                  {loading ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                    />
                  ) : (
                    <>
                      <span>Sign In</span>
                      <ArrowRight size={16} />
                    </>
                  )}
                </motion.button>
              </form>

              {/* Card Footer Micro-note */}
              <div className="pt-3 border-t border-white/[0.08] text-center">
                <p className="text-[11px] text-slate-400">
                  Offline PWA Ready • Serialized Hardware Vault Encrypted
                </p>
              </div>
            </motion.div>
          </div>

        </div>
      </main>

      {/* ── 4. CLEAN, DIGNIFIED FOOTER: Single Contact Point ── */}
      <footer className="relative z-10 px-6 py-4 border-t border-white/[0.08] bg-slate-950/50 backdrop-blur-md text-xs text-slate-400">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
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
              className="text-cyan-400 hover:text-cyan-300 hover:underline font-medium transition"
            >
              Support: 0301-2616367
            </a>
          </div>
        </div>
      </footer>

    </div>
  )
}

export default Login