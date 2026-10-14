import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, rlsSession } from '../services/supabase'
import { supabaseAdmin } from '../services/supabaseAdmin'
import { db as localDB } from '../services/db'
import { hashPassword } from '../utils/authUtils'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Smartphone, 
  Zap, 
  MessageSquare, 
  ShieldCheck, 
  Lock, 
  User, 
  Eye, 
  EyeOff, 
  ArrowRight, 
  PhoneCall, 
  CheckCircle2, 
  Layers
} from 'lucide-react'
import BroadcastBanner from '../components/BroadcastBanner'

function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [logoUrl, setLogoUrl] = useState(() => {
    const lastShopId = localStorage.getItem('last_shop_id')
    return lastShopId ? localStorage.getItem(`shop_logo_${lastShopId}`) || '/edgex_pos_logo_platform.png' : '/edgex_pos_logo_platform.png'
  })
  const [platformName, setPlatformName] = useState(() => {
    const lastShopId = localStorage.getItem('last_shop_id')
    return lastShopId ? localStorage.getItem(`shop_name_${lastShopId}`) || 'EdgeX POS' : 'EdgeX POS'
  })

  useEffect(() => {
    document.title = platformName ? `${platformName} - Login` : 'EdgeX Mobile Shop POS'
  }, [platformName])

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

    try { impersonate(impId, { name: shopName, logo_url: logoUrl }) } catch (_) {}
    window.location.href = '/dashboard'
  }, [searchParams])

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const isOffline = !navigator.onLine

    // ── Offline fast-path: skip RPC entirely ──────────────────────────────
    if (isOffline) {
      try {
        const hashedPassword = await hashPassword(password)
        const allUsers = await localDB.users.toArray()
        const localUser = allUsers.find(u =>
          u.username?.toLowerCase() === username.trim().toLowerCase()
        )

        if (!localUser) {
          setError('⚠️ Offline: No saved login found for this username. Please connect to internet and login once first.')
          setLoading(false)
          return
        }

        if (localUser.password !== hashedPassword) {
          setError('Offline: Incorrect password.')
          setLoading(false)
          return
        }

        if (localUser.is_active === false) {
          setError('Offline: This account is marked inactive.')
          setLoading(false)
          return
        }

        if (localUser.shop_id) {
          localStorage.setItem('last_shop_id', localUser.shop_id)
          try {
            const localShop = await localDB.shops.get(localUser.shop_id)
            if (localShop?.name) localStorage.setItem(`shop_name_${localUser.shop_id}`, localShop.name)
            if (localShop?.logo_url) localStorage.setItem(`shop_logo_${localUser.shop_id}`, localShop.logo_url)
          } catch (_) {}
        }

        login({
          id: localUser.id,
          username: localUser.username,
          email: localUser.email || '',
          role: localUser.role,
          shop_id: localUser.shop_id,
          permissions: localUser.permissions || []
        })

        setError('✅ Logged in offline. Some features (sync, reports) require internet.')
        setTimeout(() => navigate('/dashboard'), 1500)
      } catch (err) {
        setError('Offline login failed. Please connect to internet.')
      } finally {
        setLoading(false)
      }
      return
    }

    // ── Online path ───────────────────────────────────────────────────────
    try {
      const hashedPassword = await hashPassword(password)
      const cleanUsername = username.trim().toLowerCase()

      // Direct Superadmin authentication path (babarjoya@gmail.com and any superadmin user)
      if (supabaseAdmin) {
        try {
          const { data: saUsers, error: saError } = await supabaseAdmin
            .from('users')
            .select('*')
            .or(`email.ilike.${cleanUsername},username.ilike.${cleanUsername}`)
            .eq('password', hashedPassword)
            .eq('role', 'superadmin')
            .eq('is_active', true)
            .limit(1)

          const saUser = saUsers?.[0]
          if (!saError && saUser) {
            const sessionUser = {
              id: saUser.id,
              username: saUser.username || 'Superadmin',
              email: saUser.email || cleanUsername,
              role: 'superadmin',
              shop_id: null,
              permissions: []
            }
            login(sessionUser)
            localStorage.setItem('user_pw_hash', hashedPassword)
            localStorage.setItem('superadmin_session', JSON.stringify(sessionUser))
            window.location.href = '/admin'
            return
          }
        } catch (saErr) {
          console.warn('Superadmin check skipped:', saErr)
        }
      }

      // Use secure_login RPC
      const rpcPromise = supabase.rpc('secure_login', {
        p_username: username.trim(),
        p_password_hash: hashedPassword
      })
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Network unavailable — switching to offline login')), 5000)
      )
      const { data: loginResult, error: loginError } = await Promise.race([rpcPromise, timeoutPromise])

      if (loginError) {
        console.error('Login RPC error:', loginError)
        const errMsg = (loginError.message || '').toLowerCase()
        const isNetworkError = errMsg.includes('fetch') ||
          errMsg.includes('network') ||
          errMsg.includes('failed to fetch') ||
          errMsg.includes('load failed') ||
          errMsg.includes('networkerror') ||
          loginError.code === 'NETWORK_ERROR' ||
          !navigator.onLine

        if (isNetworkError) {
          throw new Error('Network unavailable — switching to offline login')
        }

        setError('Login failed. Please verify credentials or contact support.')
        setLoading(false)
        return
      }

      if (!loginResult || !loginResult.success) {
        const errorMsg = loginResult?.error || 'Invalid username or password'
        if (errorMsg.includes('suspended')) {
          const reasonStr = loginResult?.suspension_reason ? ` (${loginResult.suspension_reason})` : ''
          setError(`Account suspended${reasonStr}. Contact support: 0301-2616367`)
        } else if (errorMsg.includes('Multiple accounts')) {
          setError('Multiple accounts found. Please use your email address.')
        } else {
          setError('Invalid username or password')
        }
        setLoading(false)
        return
      }

      const userData = loginResult.user
      const shopConfig = loginResult.shop_config
      const sessionToken = loginResult.session_token

      if (sessionToken) {
        localStorage.setItem('session_token', sessionToken)
      }

      // If user is a superadmin, immediately navigate to superadmin portal
      if (userData.role === 'superadmin' || cleanUsername === 'babarjoya@gmail.com') {
        const sessionUser = {
          id: userData.id,
          username: userData.username || 'Superadmin',
          email: userData.email || cleanUsername,
          role: 'superadmin',
          shop_id: null,
          permissions: []
        }
        login(sessionUser)
        localStorage.setItem('user_pw_hash', hashedPassword)
        localStorage.setItem('superadmin_session', JSON.stringify(sessionUser))
        window.location.href = '/superadmin'
        return
      }

      if (userData.shop_id) {
        localStorage.setItem('last_shop_id', userData.shop_id)
        try {
          const { data: shopData } = await supabase
            .from('shops')
            .select('name, logo_url')
            .eq('id', userData.shop_id)
            .maybeSingle()
          if (shopData) {
            if (shopData.name) {
              localStorage.setItem(`shop_name_${userData.shop_id}`, shopData.name)
            }
            if (shopData.logo_url) {
              localStorage.setItem(`shop_logo_${userData.shop_id}`, shopData.logo_url)
            }
            try {
              await localDB.shops.put({ id: userData.shop_id, name: shopData.name, logo_url: shopData.logo_url })
            } catch (dbErr) {
              console.warn('Could not save shop details to localDB:', dbErr)
            }
          }
        } catch (shopErr) {
          console.warn('Could not fetch shop branding on login:', shopErr)
        }
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
      }, loginResult.authorized_shops || [], loginResult.branches || [])

      navigate('/dashboard')

    } catch (networkError) {
      console.error('Network error during login:', networkError)
      try {
        const hashedPassword = await hashPassword(password)
        const allUsers = await localDB.users.toArray()
        const localUser = allUsers.find(u =>
          u.username?.toLowerCase() === username.trim().toLowerCase()
        )

        if (!localUser) {
          setError('⚠️ No offline credentials found. Please connect to internet to sign in once.')
          setLoading(false)
          return
        }

        if (localUser && localUser.password === hashedPassword && localUser.is_active !== false) {
          if (localUser.shop_id) {
            localStorage.setItem('last_shop_id', localUser.shop_id)
            try {
              const localShop = await localDB.shops.get(localUser.shop_id)
              if (localShop) {
                if (localShop.name) localStorage.setItem(`shop_name_${localUser.shop_id}`, localShop.name)
                if (localShop.logo_url) localStorage.setItem(`shop_logo_${localUser.shop_id}`, localShop.logo_url)
              }
            } catch (_) {}
          }

          login({
            id: localUser.id,
            username: localUser.username,
            email: localUser.email || '',
            role: localUser.role,
            shop_id: localUser.shop_id,
            permissions: localUser.permissions || []
          })

          setError('✅ Logged in offline. Some features require internet.')
          setTimeout(() => navigate('/dashboard'), 1500)
        } else {
          setError('Offline mode: Incorrect password.')
        }
      } catch (offlineError) {
        setError('Unable to login. Please check your internet connection.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#08080a] text-white flex flex-col justify-between relative overflow-hidden font-sans select-none">
      {/* Dynamic Apple-Style Ambient Aurora Glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] sm:w-[700px] h-[500px] sm:h-[700px] bg-gradient-to-br from-blue-600/20 via-indigo-600/10 to-transparent rounded-full blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-15%] right-[-10%] w-[550px] sm:w-[750px] h-[550px] sm:h-[750px] bg-gradient-to-tl from-emerald-600/15 via-teal-600/10 to-transparent rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-[40%] right-[30%] w-[350px] h-[350px] bg-violet-600/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Top Navbar */}
      <header className="relative z-20 px-6 sm:px-12 py-6 flex items-center justify-between border-b border-white/[0.06] backdrop-blur-md bg-[#08080a]/40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#0071e3] to-[#2997ff] p-0.5 shadow-lg shadow-blue-500/20 flex items-center justify-center overflow-hidden">
            <img src={logoUrl} alt={platformName} className="w-full h-full object-contain drop-shadow" />
          </div>
          <div>
            <div className="text-base font-extrabold tracking-tight text-white flex items-center gap-2">
              <span>{platformName}</span>
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
                Mobile POS
              </span>
            </div>
            <p className="text-[11px] text-[#86868b] hidden sm:block">Specialized Mobile Phone & Retail Point of Sale</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs text-[#86868b]">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-emerald-400 font-medium text-[11px]">Cloud Synced</span>
            <span className="text-white/20">•</span>
            <span className="text-[11px]">Offline Engine Active</span>
          </div>
          <a
            href="tel:03012616367"
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] text-xs font-semibold text-white transition-all cursor-pointer"
          >
            <PhoneCall size={13} className="text-blue-400" />
            <span className="hidden md:inline">Support:</span>
            <span className="font-mono text-blue-400">0301-2616367</span>
          </a>
        </div>
      </header>

      {/* Global Broadcast Announcement Banner */}
      <div className="relative z-20">
        <BroadcastBanner />
      </div>

      {/* Main Container */}
      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-6 sm:py-12 flex items-center justify-center">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 w-full items-center">
          
          {/* Login Card (ORDER 1 ON MOBILE - APPEARS FIRST AT TOP) */}
          <div className="order-1 lg:order-2 lg:col-span-5 flex justify-center w-full">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="w-full max-w-md bg-[#1c1c1e]/85 backdrop-blur-3xl border border-white/[0.14] rounded-[28px] sm:rounded-[32px] p-6 sm:p-8 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.8),inset_0_1px_0_0_rgba(255,255,255,0.12)] relative space-y-6"
            >
              {/* Card Header & Apple Squircle Brand Icon */}
              <div className="text-center space-y-2.5">
                <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto rounded-[22px] bg-gradient-to-b from-white/[0.16] to-white/[0.04] p-[1.5px] shadow-2xl shadow-blue-500/10 flex items-center justify-center">
                  <div className="w-full h-full bg-gradient-to-b from-[#242426] to-[#161618] rounded-[20px] p-2.5 flex items-center justify-center overflow-hidden">
                    <img src={logoUrl} alt={platformName} className="max-w-full max-h-full object-contain drop-shadow" />
                  </div>
                </div>

                <div className="space-y-1">
                  <h2 className="text-2xl sm:text-[26px] font-semibold text-white tracking-[-0.03em]">
                    Sign in to EdgeX
                  </h2>
                  <p className="text-xs sm:text-[13px] text-[#86868b] tracking-[-0.01em]">
                    Point of Sale Terminal & Store Management
                  </p>
                </div>
              </div>

              {/* Login Form */}
              <form onSubmit={handleLogin} className="space-y-4">
                {/* Username / Email Input */}
                <div className="space-y-1.5 text-left">
                  <label className="block text-[11px] font-medium uppercase tracking-wider text-[#a1a1a6] ml-1">
                    Email or Username
                  </label>
                  <div className="relative rounded-[16px] bg-[#2c2c2e]/60 hover:bg-[#2c2c2e]/80 focus-within:bg-[#2c2c2e] border border-white/[0.1] focus-within:border-[#0071e3] focus-within:ring-4 focus-within:ring-[#0071e3]/20 transition-all duration-200">
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
                      className="w-full bg-transparent pl-11 pr-4 py-3.5 text-sm text-white placeholder-[#86868b] focus:outline-none tracking-[-0.01em]"
                    />
                  </div>
                </div>

                {/* Password Input */}
                <div className="space-y-1.5 text-left">
                  <label className="block text-[11px] font-medium uppercase tracking-wider text-[#a1a1a6] ml-1">
                    Password
                  </label>
                  <div className="relative rounded-[16px] bg-[#2c2c2e]/60 hover:bg-[#2c2c2e]/80 focus-within:bg-[#2c2c2e] border border-white/[0.1] focus-within:border-[#0071e3] focus-within:ring-4 focus-within:ring-[#0071e3]/20 transition-all duration-200">
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
                      className="w-full bg-transparent pl-11 pr-11 py-3.5 text-sm text-white placeholder-[#86868b] focus:outline-none tracking-[-0.01em]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[#86868b] hover:text-white transition-colors cursor-pointer"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
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
                      <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-[14px] text-xs text-red-400 leading-relaxed font-medium flex items-start gap-2">
                        <span className="shrink-0 mt-0.5">⚠️</span>
                        <span>{error}</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Apple-Style Primary Action Button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 px-6 bg-[#0071e3] hover:bg-[#0077ED] active:bg-[#0062c4] text-white font-medium text-sm rounded-[16px] transition-all duration-200 shadow-[0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.25)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer mt-3"
                >
                  {loading ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full"
                    />
                  ) : (
                    <>
                      <span>Open Counter Terminal</span>
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </form>

              {/* Card Footer Hints */}
              <div className="pt-3 border-t border-white/[0.08] text-center space-y-2">
                <p className="text-[11px] text-[#86868b] tracking-[-0.01em]">
                  Multi-Tenant Security • High-Speed Barcode Billing
                </p>
                <div className="inline-flex items-center gap-1.5 text-[10px] text-blue-400 font-mono bg-blue-500/10 px-2.5 py-1 rounded-full border border-blue-500/20">
                  <ShieldCheck size={11} />
                  <span>Superadmin: babarjoya@gmail.com</span>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Left Column: Mobile Shop Showcase (ORDER 2 ON MOBILE - APPEARS BELOW LOGIN FORM) */}
          <div className="order-2 lg:order-1 lg:col-span-7 space-y-8 text-center lg:text-left">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="space-y-4 max-w-xl mx-auto lg:mx-0"
            >
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-teal-500/10 border border-blue-500/20 text-xs font-semibold text-blue-300">
                <Sparkles size={13} className="text-blue-400" />
                <span>Next-Generation Retail OS for Phone Stores</span>
              </div>

              <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-white leading-[1.12]">
                Smart POS Engineered for{' '}
                <span className="bg-gradient-to-r from-[#2997ff] via-[#5e5ce6] to-[#30d158] bg-clip-text text-transparent">
                  Mobile Shops.
                </span>
              </h1>

              <p className="text-sm sm:text-base text-[#86868b] leading-relaxed">
                Streamline serialized device inventories, automate walk-in phone buy-backs, print instant thermal bills, and send WhatsApp invoices with 1 tap.
              </p>
            </motion.div>

            {/* Feature Cards Grid (Apple Glass Style) */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 max-w-xl mx-auto lg:mx-0"
            >
              <div className="p-4 rounded-2xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.07] backdrop-blur-xl transition group text-left">
                <div className="w-9 h-9 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center mb-2.5 group-hover:scale-105 transition-transform">
                  <Smartphone size={18} />
                </div>
                <h3 className="text-xs font-bold text-white mb-1">IMEI Tracking & Buy-Backs</h3>
                <p className="text-[11px] text-[#86868b] leading-relaxed">
                  15-digit IMEI scanning with instant auto-fetch for previously sold devices.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.07] backdrop-blur-xl transition group text-left">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center mb-2.5 group-hover:scale-105 transition-transform">
                  <MessageSquare size={18} />
                </div>
                <h3 className="text-xs font-bold text-white mb-1">WhatsApp Bill & Warranty</h3>
                <p className="text-[11px] text-[#86868b] leading-relaxed">
                  Automatic invoice summaries sent with phone model, date, and warranty note.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.07] backdrop-blur-xl transition group text-left">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center mb-2.5 group-hover:scale-105 transition-transform">
                  <Zap size={18} />
                </div>
                <h3 className="text-xs font-bold text-white mb-1">Offline-First Engine</h3>
                <p className="text-[11px] text-[#86868b] leading-relaxed">
                  Zero counter downtime. Keep billing during internet or power dropouts.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.07] backdrop-blur-xl transition group text-left">
                <div className="w-9 h-9 rounded-xl bg-purple-500/15 text-purple-400 flex items-center justify-center mb-2.5 group-hover:scale-105 transition-transform">
                  <Layers size={18} />
                </div>
                <h3 className="text-xs font-bold text-white mb-1">Store Asset Wealth</h3>
                <p className="text-[11px] text-[#86868b] leading-relaxed">
                  Real-time stock valuation separating phone inventory from accessories.
                </p>
              </div>
            </motion.div>

            {/* Micro Live Device Preview Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.25 }}
              className="p-4 rounded-2xl bg-gradient-to-r from-white/[0.04] to-white/[0.02] border border-white/[0.08] backdrop-blur-xl max-w-xl mx-auto lg:mx-0 flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center text-sm font-bold shrink-0 shadow-md">
                  📱
                </div>
                <div className="min-w-0 text-left">
                  <div className="text-xs font-bold text-white flex items-center gap-2 truncate">
                    <span>iPhone 15 Pro Max 256GB</span>
                    <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 text-[9px] font-bold">PTA APPROVED</span>
                  </div>
                  <div className="text-[10px] text-[#86868b] font-mono mt-0.5 truncate">
                    IMEI: 354892109283741 • 7-Day Warranty
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-black text-white">Rs. 385,000</div>
                <div className="text-[9px] text-emerald-400 font-bold flex items-center justify-end gap-1 mt-0.5">
                  <CheckCircle2 size={10} />
                  <span>WhatsApp Sent</span>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 px-6 py-4 border-t border-white/[0.06] backdrop-blur-md bg-[#08080a]/40 text-center text-[11px] text-[#86868b] flex flex-col sm:flex-row items-center justify-between gap-2 max-w-7xl mx-auto w-full">
        <div>
          Developed with <span className="text-red-500">❤︎</span> by EdgeX Digital & Babar Joya
        </div>
        <div className="flex items-center gap-3">
          <span>Version 2.2 Mobile Edition</span>
          <span>•</span>
          <span>Offline PWA Ready</span>
        </div>
      </footer>
    </div>
  )
}

export default Login