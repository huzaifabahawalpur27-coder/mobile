import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { supabase, rlsSession } from '../services/supabase'
import { supabaseAdmin } from '../services/supabaseAdmin'
import { db as localDB } from '../services/db'
import { hashPassword } from '../utils/authUtils'
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
  CheckCircle2, 
  Layers,
  Sparkles,
  Copy,
  Check,
  Barcode,
  Radio,
  ExternalLink,
  Clock
} from 'lucide-react'
import BroadcastBanner from '../components/BroadcastBanner'

// Live Phone Sold Stream Data for the Real-time Terminal Animation
const LIVE_PHONE_SALES = [
  {
    id: 'tx-1',
    model: 'iPhone 15 Pro Max',
    spec: '256GB • Natural Titanium',
    imei: '354892109283741',
    condition: 'Brand New (Pack Pack)',
    pta: 'PTA Approved (Physical + eSIM)',
    buyer: 'Kashif Mehmood',
    city: 'Gulberg III, Lahore',
    amount: 385000,
    paymentMethod: 'Cash Counter',
    time: 'Just now',
    invoiceNo: '#INV-9821',
    warranty: '1-Year Apple Official',
    color: 'from-blue-600 to-indigo-600',
    tagBg: 'bg-blue-50 text-blue-700 border-blue-200'
  },
  {
    id: 'tx-2',
    model: 'Samsung Galaxy S24 Ultra',
    spec: '512GB • Titanium Violet',
    imei: '864201948271034',
    condition: 'Official PTA Pack',
    pta: 'Dual SIM PTA Approved',
    buyer: 'Dr. Hamza Bilal',
    city: 'Model Town, Lahore',
    amount: 315000,
    paymentMethod: 'HBL Bank Transfer',
    time: '12s ago',
    invoiceNo: '#INV-9822',
    warranty: '1-Year Official Warranty',
    color: 'from-purple-600 to-violet-600',
    tagBg: 'bg-purple-50 text-purple-700 border-purple-200'
  },
  {
    id: 'tx-3',
    model: 'Xiaomi 14 Ultra',
    spec: '16/512GB • Ceramic White',
    imei: '867301984261783',
    condition: 'With Photography Kit',
    pta: 'Dual SIM PTA Approved',
    buyer: 'Engr. Tariq Jameel',
    city: 'DHA Phase 6, Lahore',
    amount: 248000,
    paymentMethod: 'Card POS Swipe',
    time: '34s ago',
    invoiceNo: '#INV-9823',
    warranty: 'Official Airlink Warranty',
    color: 'from-cyan-600 to-blue-600',
    tagBg: 'bg-cyan-50 text-cyan-700 border-cyan-200'
  },
  {
    id: 'tx-4',
    model: 'Redmi Note 13 Pro 5G',
    spec: '8/256GB • Midnight Black',
    imei: '359102847581932',
    condition: 'Brand New Box Pack',
    pta: 'Official PTA Approved',
    buyer: 'Usman Ali',
    city: 'Bahawalpur Cantt',
    amount: 64500,
    paymentMethod: 'Cash Counter',
    time: '1m ago',
    invoiceNo: '#INV-9824',
    warranty: '1-Year Xiaomi Warranty',
    color: 'from-emerald-600 to-teal-600',
    tagBg: 'bg-emerald-50 text-emerald-700 border-emerald-200'
  }
]

function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Realtime Live Phone Sales Animation State
  const [currentSaleIdx, setCurrentSaleIdx] = useState(0)
  const [isScanning, setIsScanning] = useState(false)
  const [liveCount, setLiveCount] = useState(48)
  const [liveRevenue, setLiveRevenue] = useState(2840000)
  const [copied, setCopied] = useState(false)

  const [logoUrl, setLogoUrl] = useState(() => {
    const lastShopId = localStorage.getItem('last_shop_id')
    return lastShopId ? localStorage.getItem(`shop_logo_${lastShopId}`) || '/edgex_pos_logo_platform.png' : '/edgex_pos_logo_platform.png'
  })
  const [platformName, setPlatformName] = useState(() => {
    const lastShopId = localStorage.getItem('last_shop_id')
    return lastShopId ? localStorage.getItem(`shop_name_${lastShopId}`) || 'EdgeX POS' : 'EdgeX POS'
  })

  // Ensure login screen is presented in pristine Apple Light UI
  useEffect(() => {
    document.title = platformName ? `${platformName} - Apple Light Login` : 'EdgeX Mobile Shop POS'
    const hadDark = document.documentElement.classList.contains('dark')
    document.documentElement.classList.remove('dark')
    document.documentElement.setAttribute('data-theme', 'light')
    return () => {
      if (hadDark) {
        document.documentElement.classList.add('dark')
        document.documentElement.setAttribute('data-theme', 'dark')
      }
    }
  }, [platformName])

  // Real-time Phone Sold Simulation Ticker
  useEffect(() => {
    const interval = setInterval(() => {
      setIsScanning(true)
      setTimeout(() => {
        setCurrentSaleIdx(prev => {
          const nextIdx = (prev + 1) % LIVE_PHONE_SALES.length
          setLiveRevenue(rev => rev + LIVE_PHONE_SALES[nextIdx].amount)
          return nextIdx
        })
        setLiveCount(c => c + 1)
        setIsScanning(false)
      }, 500)
    }, 4500)
    return () => clearInterval(interval)
  }, [])

  const handleCopyWhatsApp = () => {
    navigator.clipboard.writeText('03012616367')
    setCopied(true)
    setTimeout(() => setCopied(false), 2200)
  }

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

    try { impersonate(impId, { name: shopName, logo_url: logoUrl }) } catch (_) {}
    window.location.href = '/dashboard'
  }, [searchParams])

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
          setError('⚠️ Server se rabta nahi ho saka aur is device par offline login save nahi hai. Meharbani karke pehle online login karein.')
          setLoading(false)
          return false
        }

        if (localUser.password !== hashedPassword) {
          setError('Offline: Incorrect password.')
          setLoading(false)
          return false
        }

        if (localUser.is_active === false) {
          setError('Offline: This account is marked inactive.')
          setLoading(false)
          return false
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

        setError('✅ Logged in offline. Some features require internet.')
        setTimeout(() => navigate('/dashboard'), 1000)
        return true
      } catch (err) {
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
        console.warn('RPC secure_login error:', rpcError)
        // Fallback: If supabaseAdmin is available, attempt direct verification
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
            throw new Error('Network unavailable — switching to offline login')
          }

          if (errMsg.includes('v_shop') || errMsg.includes('assigned yet')) {
            setError('Database update required: Please run FIX_SECURE_LOGIN_AND_PAYMENTS.sql in Supabase SQL Editor.')
          } else {
            setError(rpcError.message || 'Login service unavailable. Please contact support.')
          }
          setLoading(false)
          return
        }

        let msg = loginData?.error || loginData?.message || 'Invalid username or password'
        if (msg.includes('multiple accounts') || msg.includes('Multiple accounts')) {
          msg = '⚠️ Multiple accounts share this username. Please sign in using your full email address.'
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

      // ── Superadmin Redirect Fast-Path ──
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
      try {
        const hashedPassword = await hashPassword(password)
        const allUsers = await localDB.users.toArray()
        const localUser = allUsers.find(u =>
          u.username?.toLowerCase() === username.trim().toLowerCase()
        )

        if (!localUser) {
          setError('⚠️ Server se rabta nahi ho saka aur is device par offline login save nahi hai. Meharbani karke pehle online login karein.')
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
        setError('Login mein masla pesh aya. Meharbani karke dobara koshish karein.')
      }
    } finally {
      setLoading(false)
    }
  }

  const currentSale = LIVE_PHONE_SALES[currentSaleIdx]

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f] flex flex-col justify-between relative overflow-hidden font-sans select-none antialiased">
      {/* ── Apple Light Ambient Diffused Glows ── */}
      <div className="absolute top-[-10%] left-[-8%] w-[600px] h-[600px] bg-gradient-to-br from-blue-300/35 via-indigo-200/25 to-transparent rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-15%] right-[-10%] w-[700px] h-[700px] bg-gradient-to-tl from-emerald-300/30 via-teal-200/20 to-transparent rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute top-[35%] right-[25%] w-[450px] h-[450px] bg-purple-200/25 rounded-full blur-[130px] pointer-events-none" />

      {/* ── Top Apple Frosted Header ── */}
      <header className="relative z-20 px-4 sm:px-10 py-4 flex items-center justify-between border-b border-black/[0.06] backdrop-blur-xl bg-white/75 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#0071e3] to-[#2997ff] p-0.5 shadow-md shadow-blue-500/20 flex items-center justify-center overflow-hidden">
            <img src={logoUrl} alt={platformName} className="w-full h-full object-contain drop-shadow" />
          </div>
          <div>
            <div className="text-base font-extrabold tracking-tight text-[#1d1d1f] flex items-center gap-2">
              <span>{platformName}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-50 text-[#0071e3] border border-blue-200/80">
                Mobile POS
              </span>
            </div>
            <p className="text-[11px] text-[#86868b] hidden sm:block">Serialized Phone Inventory & Instant Barcode Terminal</p>
          </div>
        </div>

        {/* Header Right: Live Status & Prominent WhatsApp Demo Link */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50/80 border border-emerald-200/80 text-xs text-emerald-800">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span className="text-[11px] font-semibold">Live Terminal Synced</span>
            <span className="text-emerald-300">•</span>
            <span className="text-[11px] text-emerald-700">Offline PWA Engine</span>
          </div>

          {/* Official WhatsApp Demo Access Button */}
          <a
            href="https://wa.me/923012616367?text=Hi%20Babar!%20I%20would%20like%20a%20Live%20Demo%20Account%20for%20EdgeX%20Mobile%20POS."
            target="_blank"
            rel="noopener noreferrer"
            title="Chat on WhatsApp with Founder (0301-2616367)"
            className="group flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#25D366] hover:bg-[#20bd5a] text-white text-xs font-semibold shadow-sm hover:shadow-md transition-all active:scale-95 cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current shrink-0">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
            </svg>
            <span className="hidden sm:inline">WhatsApp Demo:</span>
            <span className="font-mono font-bold tracking-tight">0301-2616367</span>
          </a>
        </div>
      </header>

      {/* Global Broadcast Announcement Banner */}
      <div className="relative z-20">
        <BroadcastBanner />
      </div>

      {/* ── Main Container ── */}
      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-6 sm:py-10 flex items-center justify-center">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 w-full items-center">
          
          {/* ═════════════════════════════════════════════════════════════════════
              LOGIN CARD (ORDER 1 ON MOBILE - APPEARS FIRST AT TOP)
              ═════════════════════════════════════════════════════════════════════ */}
          <div className="order-1 lg:order-2 lg:col-span-5 flex justify-center w-full">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="w-full max-w-md bg-white/90 backdrop-blur-3xl border border-black/[0.08] rounded-[32px] p-6 sm:p-8 shadow-[0_30px_70px_-15px_rgba(0,0,0,0.08),0_1px_3px_rgba(0,0,0,0.04)] relative space-y-6"
            >
              {/* Card Header & Apple Squircle Brand Icon */}
              <div className="text-center space-y-2.5">
                <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto rounded-[24px] bg-gradient-to-b from-white to-slate-100 p-1 shadow-xl shadow-blue-500/10 border border-slate-200/80 flex items-center justify-center">
                  <div className="w-full h-full bg-gradient-to-tr from-slate-50 to-white rounded-[20px] p-2 flex items-center justify-center overflow-hidden">
                    <img src={logoUrl} alt={platformName} className="max-w-full max-h-full object-contain drop-shadow-sm" />
                  </div>
                </div>

                <div className="space-y-1">
                  <h2 className="text-2xl sm:text-[26px] font-bold text-[#1d1d1f] tracking-[-0.03em]">
                    Sign in to EdgeX
                  </h2>
                  <p className="text-xs sm:text-[13px] text-[#86868b] tracking-[-0.01em]">
                    Mobile Store POS & Serialized Inventory
                  </p>
                </div>
              </div>

              {/* Login Form */}
              <form onSubmit={handleLogin} className="space-y-4">
                {/* Username / Email Input */}
                <div className="space-y-1.5 text-left">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#6e6e73] ml-1">
                    Email or Username
                  </label>
                  <div className="relative rounded-[16px] bg-slate-50 hover:bg-slate-100/70 focus-within:bg-white border border-slate-200/90 focus-within:border-[#0071e3] focus-within:ring-4 focus-within:ring-[#0071e3]/15 transition-all duration-200">
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
                      className="w-full bg-transparent pl-11 pr-4 py-3.5 text-sm text-[#1d1d1f] placeholder-[#86868b] focus:outline-none tracking-[-0.01em] font-medium"
                    />
                  </div>
                </div>

                {/* Password Input */}
                <div className="space-y-1.5 text-left">
                  <div className="flex justify-between items-center px-1">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#6e6e73]">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={handleQuickDemoFill}
                      className="text-[11px] font-bold text-[#0071e3] hover:underline cursor-pointer"
                    >
                      ⚡ Quick Demo Fill
                    </button>
                  </div>
                  <div className="relative rounded-[16px] bg-slate-50 hover:bg-slate-100/70 focus-within:bg-white border border-slate-200/90 focus-within:border-[#0071e3] focus-within:ring-4 focus-within:ring-[#0071e3]/15 transition-all duration-200">
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
                      className="w-full bg-transparent pl-11 pr-11 py-3.5 text-sm text-[#1d1d1f] placeholder-[#86868b] focus:outline-none tracking-[-0.01em] font-medium"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[#86868b] hover:text-[#1d1d1f] transition-colors cursor-pointer"
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
                      <div className="p-3 bg-red-50 border border-red-200 rounded-[16px] text-xs text-red-600 leading-relaxed font-semibold flex items-start gap-2">
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
                  className="w-full py-3.5 px-6 bg-[#0071e3] hover:bg-[#0077ED] active:bg-[#0062c4] text-white font-semibold text-sm rounded-[16px] transition-all duration-200 shadow-[0_4px_14px_rgba(0,113,227,0.35)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer mt-2"
                >
                  {loading ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
                    />
                  ) : (
                    <>
                      <span>Login</span>
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </form>

              {/* ── WhatsApp Instant Demo Card in Login Box ── */}
              <div className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-50/90 to-teal-50/80 border border-emerald-200/90 space-y-2 text-left">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-[#25D366] text-white flex items-center justify-center p-1 shadow-xs">
                      <svg viewBox="0 0 24 24" className="w-full h-full fill-current">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                      </svg>
                    </span>
                    <span className="text-xs font-bold text-slate-800">Want a Demo Account?</span>
                  </div>
                  <span className="text-[10px] uppercase font-mono font-bold bg-emerald-200/60 text-emerald-800 px-2 py-0.5 rounded-full">
                    Free Trial
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <a
                    href="https://wa.me/923012616367?text=Hi%20Babar!%20Please%20provide%20me%20a%20Demo%20Account%20for%20EdgeX%20POS."
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-1.5 px-3 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition"
                  >
                    <span>WhatsApp 0301-2616367</span>
                    <ExternalLink size={12} />
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyWhatsApp}
                    className="p-1.5 px-2.5 rounded-xl border border-emerald-300 bg-white hover:bg-emerald-50 text-emerald-700 text-xs font-semibold flex items-center gap-1 transition"
                    title="Copy Phone Number"
                  >
                    {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                    <span className="text-[11px]">{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              {/* Card Footer Hints */}
              <div className="pt-2 border-t border-slate-100 text-center space-y-1.5">
                <p className="text-[11px] text-[#86868b] tracking-[-0.01em]">
                  Multi-Branch • 15-Digit IMEI Scanning • Automated WhatsApp Slips
                </p>
                <div className="inline-flex items-center gap-1.5 text-[10px] text-slate-500 font-mono bg-slate-100/80 px-2.5 py-1 rounded-full border border-slate-200">
                  <ShieldCheck size={11} className="text-blue-500" />
                  <span>Platform Lead: Babar Joya (0301-2616367)</span>
                </div>
              </div>
            </motion.div>
          </div>

          {/* ═════════════════════════════════════════════════════════════════════
              SHOWCASE & REALTIME PHONE SOLD TERMINAL (ORDER 2 ON MOBILE)
              ═════════════════════════════════════════════════════════════════════ */}
          <div className="order-2 lg:order-1 lg:col-span-7 space-y-6 text-center lg:text-left">
            
            {/* ── Beautiful Techy Welcome Hero Animation ── */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="space-y-3.5 max-w-xl mx-auto lg:mx-0"
            >
              {/* Animated Techy Badge with Pulse */}
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-50/90 border border-blue-200/90 text-xs font-bold text-[#0071e3] shadow-xs">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#0071e3]"></span>
                </span>
                <span>Next-Generation Retail OS for Mobile Phones</span>
              </div>

              <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-[#1d1d1f] leading-[1.12]">
                Smart POS Engineered for{' '}
                <span className="bg-gradient-to-r from-[#0071e3] via-[#6366f1] to-[#059669] bg-clip-text text-transparent">
                  Mobile Retailers.
                </span>
              </h1>

              <p className="text-sm sm:text-base text-[#6e6e73] leading-relaxed">
                Complete serialized IMEI inventory control, instant thermal printing, warranty dispatch via WhatsApp, and live counter synchronization.
              </p>
            </motion.div>

            {/* ── REALTIME DATA ENTRY FOR PHONE SOLD ANIMATION CARD ── */}
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="relative overflow-hidden rounded-[28px] bg-white/95 backdrop-blur-2xl border border-slate-200/90 p-5 sm:p-6 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.07)] max-w-xl mx-auto lg:mx-0 space-y-4 text-left"
            >
              {/* Laser Scanning Beam Animation on transition */}
              <AnimatePresence>
                {isScanning && (
                  <motion.div
                    initial={{ top: '-10%', opacity: 0 }}
                    animate={{ top: '110%', opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.6, ease: 'easeInOut' }}
                    className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#0071e3] to-transparent shadow-[0_0_15px_#0071e3] pointer-events-none z-30"
                  />
                )}
              </AnimatePresence>

              {/* Terminal Live Bar Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </span>
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5 font-mono">
                    <Radio size={12} className="text-emerald-500 animate-pulse" />
                    Real-time Phone Sold Stream
                  </span>
                </div>

                <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500">
                  <span className="font-bold text-slate-800">{liveCount}</span> Phones Sold Today
                </div>
              </div>

              {/* Dynamic Sold Phone Animation Detail */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentSale.id}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ duration: 0.35 }}
                  className="space-y-3.5"
                >
                  {/* Phone Header & Badges */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-2xl bg-gradient-to-tr ${currentSale.color} text-white flex items-center justify-center font-bold text-lg shadow-md shrink-0`}>
                        <Smartphone size={22} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                            {currentSale.model}
                          </h3>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${currentSale.tagBg}`}>
                            {currentSale.pta}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                          {currentSale.spec} • {currentSale.warranty}
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-base sm:text-lg font-black text-slate-900">
                        Rs. {currentSale.amount.toLocaleString()}
                      </div>
                      <div className="text-[10px] font-bold text-emerald-600 flex items-center justify-end gap-1 mt-0.5">
                        <CheckCircle2 size={11} />
                        <span>Sold & Verified</span>
                      </div>
                    </div>
                  </div>

                  {/* Serialized IMEI & Tech Data Barcode Pill */}
                  <div className="p-3 bg-slate-50/90 rounded-2xl border border-slate-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 font-mono text-xs">
                    <div className="flex items-center gap-2">
                      <Barcode size={18} className="text-[#0071e3] shrink-0" />
                      <div>
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Serialized Hardware IMEI</span>
                        <span className="font-bold text-slate-800 tracking-wider">{currentSale.imei}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] self-end sm:self-auto">
                      <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 font-semibold text-[10px]">
                        {currentSale.paymentMethod}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center gap-1">
                        <span>WhatsApp Slip</span>
                        <Check size={10} />
                      </span>
                    </div>
                  </div>

                  {/* Buyer & Counter Details */}
                  <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-slate-400">Customer:</span>
                      <span className="font-semibold text-slate-800 truncate">{currentSale.buyer}</span>
                      <span className="text-slate-300">•</span>
                      <span className="text-slate-500 text-[11px] hidden sm:inline">{currentSale.city}</span>
                    </div>

                    <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5 shrink-0">
                      <Clock size={11} className="text-slate-400" />
                      <span>{currentSale.time}</span>
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>

              {/* Live POS Summary Footer */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  <span>Auto-IMEI Deducted from Vault</span>
                </div>
                <div className="font-mono font-bold text-slate-700">
                  Live Volume: Rs. {liveRevenue.toLocaleString()}
                </div>
              </div>
            </motion.div>

            {/* ── Feature Highlights Grid (Apple Clean Style) ── */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 max-w-xl mx-auto lg:mx-0 text-left"
            >
              <div className="p-3.5 rounded-2xl bg-white/80 hover:bg-white border border-slate-200/80 shadow-xs transition group">
                <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#0071e3] border border-blue-200 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                  <Smartphone size={16} />
                </div>
                <h3 className="text-xs font-bold text-slate-900 mb-0.5">IMEI Auto-Verification</h3>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Prevents duplicate device entry, tracks buy-backs, and auto-checks battery health.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-white/80 hover:bg-white border border-slate-200/80 shadow-xs transition group">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                  <MessageSquare size={16} />
                </div>
                <h3 className="text-xs font-bold text-slate-900 mb-0.5">1-Tap WhatsApp Invoicing</h3>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Dispatches branded slips directly to client phones with warranty period notes.
                </p>
              </div>
            </motion.div>

            {/* ── WhatsApp Founder / Demo Support Card ── */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.25 }}
              className="p-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white max-w-xl mx-auto lg:mx-0 shadow-md shadow-emerald-500/15 flex flex-col sm:flex-row items-center justify-between gap-3 text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-white text-[#25D366] flex items-center justify-center shrink-0 shadow-sm">
                  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">Call / WhatsApp for Live Demo</h4>
                  <p className="text-[11px] text-emerald-100 font-mono font-medium">
                    Babar Joya: <span className="font-bold underline">0301-2616367</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <a
                  href="https://wa.me/923012616367?text=Hi%20Babar!%20I%20want%20to%20test%20the%20EdgeX%20POS%20Demo."
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-1.5 rounded-xl bg-white text-emerald-800 hover:bg-emerald-50 text-xs font-bold shadow-sm transition active:scale-95 flex items-center gap-1.5"
                >
                  <span>Chat on WhatsApp</span>
                  <ExternalLink size={12} />
                </a>
              </div>
            </motion.div>

          </div>
        </div>
      </main>

      {/* ── Apple Light Minimal Footer ── */}
      <footer className="relative z-10 px-6 py-4 border-t border-black/[0.06] backdrop-blur-md bg-white/60 text-center text-[11px] text-[#86868b] flex flex-col sm:flex-row items-center justify-between gap-2 max-w-7xl mx-auto w-full">
        <div>
          Engineered with <span className="text-red-500">❤︎</span> by EdgeX Digital & Babar Joya
        </div>
        <div className="flex items-center gap-3">
          <span>Version 2.4 Apple Light Edition</span>
          <span>•</span>
          <span>Offline PWA Ready</span>
          <span>•</span>
          <a
            href="https://wa.me/923012616367"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#0071e3] hover:underline font-mono font-bold"
          >
            WhatsApp: 0301-2616367
          </a>
        </div>
      </footer>
    </div>
  )
}

export default Login