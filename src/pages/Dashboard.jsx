import { useEffect, useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { printHTML, getShopBranding } from '../utils/printUtils'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts'
import {
  TrendingUp,
  CreditCard,
  Package,
  AlertTriangle,
  Smartphone,
  Clock,
  RefreshCw,
  Moon,
  ShoppingBag,
  FileText,
  Banknote,
  ChevronRight,
  Sparkles,
  DollarSign,
  Percent,
  Activity,
  Layers,
  Receipt,
  Wallet,
  ArrowUpRight
} from 'lucide-react'

// Apple HIG / Linear SaaS Widget Stat Card
const AppleWidget = ({ title, hint, value, icon, color, bgTint, subValue, badge, isHero, onClick }) => (
  <div
    onClick={onClick}
    className={`p-4 sm:p-5 rounded-[22px] transition-all duration-200 group flex flex-col justify-between cursor-pointer relative overflow-hidden ${
      isHero
        ? 'bg-gradient-to-br from-emerald-500/[0.08] via-white/95 to-teal-500/[0.04] dark:from-emerald-950/40 dark:via-[#1c1c1e]/95 dark:to-[#1c1c1e]/95 border-2 border-emerald-500/35 dark:border-emerald-500/45 shadow-[0_4px_20px_rgba(16,185,129,0.12)] hover:shadow-[0_8px_28px_rgba(16,185,129,0.2)] hover:-translate-y-0.5'
        : 'bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl border border-black/[0.05] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:-translate-y-0.5'
    }`}
  >
    {isHero && (
      <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
    )}
    <div>
      <div className="flex justify-between items-start mb-2.5">
        <div className={`w-10 h-10 rounded-[14px] flex items-center justify-center ${bgTint} ${color} transition-transform group-hover:scale-105 shadow-2xs`}>
          {icon}
        </div>
        {badge && (
          <span className={`text-[10px] font-bold tracking-wider px-2.5 py-0.5 rounded-full border ${
            isHero
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
              : 'bg-[#f5f5f7] dark:bg-white/10 text-[#86868b] dark:text-gray-300 border-black/[0.04] dark:border-white/[0.06]'
          }`}>
            {badge}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <h3 className="text-[#86868b] text-[11px] font-bold uppercase tracking-wider">{title}</h3>
        {hint && (
          <span className="text-[10px] font-bold text-[#86868b]/90 dark:text-[#86868b] px-1.5 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06]">
            {hint}
          </span>
        )}
      </div>
      <p className={`text-[22px] sm:text-[25px] font-black tracking-tight mt-1 tabular-nums ${
        isHero
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-[#1d1d1f] dark:text-[#f5f5f7]'
      }`}>
        {typeof value === 'number' && title.toLowerCase().includes('rs')
          ? `Rs. ${Math.round(value).toLocaleString()}`
          : value}
      </p>
    </div>

    {subValue && (
      <div className="pt-2 mt-2 border-t border-black/[0.04] dark:border-white/[0.06] flex items-center justify-between text-[11px]">
        <span className="text-[#86868b] font-medium truncate">{subValue}</span>
        <span className={`group-hover:translate-x-0.5 transition-transform ${isHero ? 'text-emerald-500 font-bold' : 'text-gray-400 group-hover:text-[#0071e3]'}`}>→</span>
      </div>
    )}
  </div>
)

function Dashboard() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)

  const [stats, setStats] = useState({
    todaySales: 0,
    todayCOGS: 0,
    todayProfit: 0,
    todayProfitMargin: 0,
    todayNetProfit: 0,
    todayCashSales: 0,
    todayCreditSales: 0,
    todayOnlineSales: 0,
    todayItemsSold: 0,
    todayBulkSold: 0,
    todayBulkRevenue: 0,
    todayPhonesSold: 0,
    todayPhonesRevenue: 0,
    todayOrdersCount: 0,
    todayAOV: 0,
    todayExpenses: 0,
    todayPurchasesCost: 0,
    todayPurchasedUnits: 0,
    todayPurchasedPhones: 0,
    todayPurchasedBulk: 0,
    todayNetCashDrawer: 0,
    monthlySales: 0,
    monthlyOrdersCount: 0,
    lowStockCount: 0,
    productCount: 0,
    phonesInStock: 0,
    phonesValuation: 0,
    productsValuation: 0,
    productsStockTotal: 0,
    totalStockValuation: 0,
    planInfo: null,
    recentSales: [],
    topSellingToday: [],
    lowStockItems: []
  })

  const [weeklyTrend, setWeeklyTrend] = useState([])
  const [showEOD, setShowEOD] = useState(false)
  const [eodData, setEodData] = useState(null)
  const [eodLoading, setEodLoading] = useState(false)

  const sid = user?.shop_id
  const shopName = (sid ? localStorage.getItem(`shop_name_${sid}`) : null) || 'EdgeX POS'

  useEffect(() => {
    if (user?.shop_id) {
      fetchDashboardStats()
    }
  }, [user?.shop_id])

  const fetchDashboardStats = async () => {
    setLoading(true)

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayISO = today.toISOString()

    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    const monthISO = firstDayOfMonth.toISOString()

    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(today.getDate() - 6)
    sevenDaysAgo.setHours(0, 0, 0, 0)
    const sevenDaysISO = sevenDaysAgo.toISOString()

    try {
      if (!navigator.onLine) throw new Error('Offline')

      const fetchPromise = Promise.all([
        // 1. Today's sales with full line-item metadata
        supabase
          .from('sales')
          .select('id, total_amount, discount, payment_type, online_provider, created_at, customer_id, sale_items(id, sale_id, phone_id, product_id, product_name, cost_price, price, unit_price, line_total, subtotal, quantity, returned_qty, imei_snapshot, products(id, name, cost_price, category_id, categories(name))), customers(name)')
          .eq('shop_id', user.shop_id)
          .eq('sale_type', 'sale')
          .gte('created_at', todayISO),

        // 2. Monthly sales
        supabase
          .from('sales')
          .select('id, total_amount, discount, created_at')
          .eq('shop_id', user.shop_id)
          .eq('sale_type', 'sale')
          .gte('created_at', monthISO),

        // 3. Last 7 days sales for trend
        supabase
          .from('sales')
          .select('total_amount, discount, created_at')
          .eq('shop_id', user.shop_id)
          .eq('sale_type', 'sale')
          .gte('created_at', sevenDaysISO),

        // 4. Recent sales (latest 6)
        supabase
          .from('sales')
          .select('id, total_amount, discount, payment_type, online_provider, created_at, customer_id, customers(name)')
          .eq('shop_id', user.shop_id)
          .eq('sale_type', 'sale')
          .order('created_at', { ascending: false })
          .limit(6),

        // 5. Products catalog & inventory
        supabase
          .from('products')
          .select('id, name, stock_quantity, low_stock_threshold, cost_price, sale_price')
          .eq('shop_id', user.shop_id),

        // 6. Mobile Phones inventory
        supabase
          .from('phones')
          .select('id, brand, model, storage, color, status, cost_price, sale_price, additional_costs')
          .eq('shop_id', user.shop_id),

        // 7. Today's Expenses
        supabase
          .from('expenses')
          .select('id, amount, category, created_at')
          .eq('shop_id', user.shop_id)
          .gte('created_at', todayISO),

        // 8. Today's Inward Purchases
        supabase
          .from('purchases')
          .select('id, total_amount, payment_type, item_type, total_items, created_at, purchase_items(id, quantity, product_name)')
          .eq('shop_id', user.shop_id)
          .gte('created_at', todayISO),

        // 9. Shop config
        supabase
          .rpc('get_shop_config', { p_shop_id: user.shop_id })
          .then(r => (r?.error || !r?.data)
            ? supabase.from('shops').select('status, subscription_plan, subscription_fee, next_billing_date').eq('id', user.shop_id).maybeSingle()
            : r
          )
          .catch(() => ({ data: null }))
      ])

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 4500))
      const [todayRes, monthRes, weekRes, recentRes, prodRes, phonesRes, expRes, purRes, shopConfigRes] = await Promise.race([
        fetchPromise,
        timeoutPromise
      ])

      const rawConfig = shopConfigRes?.data || {}
      const config = {
        plan_name: rawConfig.plan_name || rawConfig.subscription_plan || 'Business Pro',
        product_limit: rawConfig.product_limit || 500,
        user_limit: rawConfig.user_limit || 5,
        status: rawConfig.status || 'active',
        ...rawConfig
      }
      if (config.status === 'suspended' && !user.isImpersonating) {
        alert('Your account has been suspended due to an unpaid subscription fee. Logging out.')
        logout()
        navigate('/')
        return
      }

      // Update local limits cache
      localStorage.setItem('plan_limits', JSON.stringify({
        product_limit: config.product_limit || 100,
        user_limit: config.user_limit || 3,
        plan_name: config.plan_name || 'PRO'
      }))

      const todaySalesList = todayRes.data || []
      const monthSalesList = monthRes.data || []
      const weekSalesList = weekRes.data || []
      const recentSalesList = recentRes.data || []
      const productList = prodRes.data || []
      const phonesList = phonesRes.data || []
      const todayExpensesList = expRes.data || []
      const todayPurchasesList = purRes.data || []

      processDashboardData({
        todaySalesList,
        monthSalesList,
        weekSalesList,
        recentSalesList,
        productList,
        phonesList,
        todayExpensesList,
        todayPurchasesList,
        config
      })
    } catch (err) {
      console.warn('Dashboard: calculating from local DB...', err)
      try {
        const sidStr = String(user.shop_id)
        const [lSales, lProducts, lPhones, lItems, lExpenses, lPurchases, lPurchaseItems] = await Promise.all([
          db.sales.toArray().catch(() => []),
          db.products.toArray().catch(() => []),
          db.phones ? db.phones.toArray().catch(() => []) : Promise.resolve([]),
          db.sale_items.toArray().catch(() => []),
          db.expenses ? db.expenses.toArray().catch(() => []) : Promise.resolve([]),
          db.purchases ? db.purchases.toArray().catch(() => []) : Promise.resolve([]),
          db.purchase_items ? db.purchase_items.toArray().catch(() => []) : Promise.resolve([])
        ])

        const mySales = lSales.filter(s => String(s.shop_id) === sidStr && s.sale_type === 'sale')
        const todaySalesList = mySales.filter(s => new Date(s.created_at) >= today).map(s => ({
          ...s,
          sale_items: lItems.filter(i => i.sale_id === s.id)
        }))
        const monthSalesList = mySales.filter(s => new Date(s.created_at) >= firstDayOfMonth)
        const weekSalesList = mySales.filter(s => new Date(s.created_at) >= sevenDaysAgo)
        const recentSalesList = [...mySales].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6)
        const productList = lProducts.filter(p => String(p.shop_id) === sidStr)
        const phonesList = (lPhones || []).filter(p => String(p.shop_id) === sidStr)
        const todayExpensesList = (lExpenses || []).filter(e => String(e.shop_id) === sidStr && new Date(e.created_at) >= today)

        const pItemsByPId = (lPurchaseItems || []).reduce((acc, pi) => {
          if (!acc[pi.purchase_id]) acc[pi.purchase_id] = []
          acc[pi.purchase_id].push(pi)
          return acc
        }, {})
        const todayPurchasesList = (lPurchases || []).filter(p => String(p.shop_id) === sidStr && new Date(p.created_at) >= today).map(p => ({
          ...p,
          purchase_items: pItemsByPId[p.id] || []
        }))
        const config = JSON.parse(localStorage.getItem('plan_limits') || '{}')

        processDashboardData({
          todaySalesList,
          monthSalesList,
          weekSalesList,
          recentSalesList,
          productList,
          phonesList,
          todayExpensesList,
          todayPurchasesList,
          config
        })
      } catch (fallbackErr) {
        console.error('Final Dashboard Fallback Error:', fallbackErr)
      }
    } finally {
      setLoading(false)
    }
  }

  const processDashboardData = ({
    todaySalesList,
    monthSalesList,
    weekSalesList,
    recentSalesList,
    productList,
    phonesList,
    todayExpensesList,
    todayPurchasesList,
    config
  }) => {
    // Lookups for accurate phone & product cost and naming (unified with Reports)
    const phoneMap = (phonesList || []).reduce((acc, p) => {
      const pName = `${p.brand || ''} ${p.model || ''}${p.storage ? ` ${p.storage}` : ''}`.trim()
      const baseCost = Number(p.cost_price || 0)
      const directCost = Number(p.additional_costs || 0)
      acc[p.id] = {
        name: pName || 'Mobile Phone',
        baseCost,
        directCost,
        cost: baseCost + directCost,
        price: Number(p.sale_price || 0)
      }
      return acc
    }, {})

    const productCostMap = (productList || []).reduce((acc, p) => {
      if (p.id) acc[p.id] = Number(p.cost_price || 0)
      if (p.name) acc[p.name] = Number(p.cost_price || 0)
      return acc
    }, {})

    // 1. Today's Sales Financials & Line-Item Aggregation
    let todayPhonesCost = 0
    let todayBulkCost = 0
    let todayItemsSold = 0
    let todayBulkSold = 0
    let todayBulkRevenue = 0
    let todayPhonesSold = 0
    let todayPhonesRevenue = 0
    const todayProdMap = {}

    todaySalesList.forEach(s => {
      (s.sale_items || []).forEach(i => {
        const netQty = Math.max(0, Number(i.quantity || 1) - Number(i.returned_qty || 0))
        if (netQty <= 0) return

        todayItemsSold += netQty

        // Parse imei_snapshot if present
        let snap = null
        if (i.imei_snapshot) {
          if (typeof i.imei_snapshot === 'object') {
            snap = i.imei_snapshot
          } else if (typeof i.imei_snapshot === 'string') {
            try { snap = JSON.parse(i.imei_snapshot) } catch (_) {}
          }
        }

        // Determine product name cleanly without exposing raw IMEI
        let name = ''
        if (i.product_name && i.product_name.trim()) {
          name = i.product_name.trim()
        } else if (i.products?.name) {
          name = i.products.name.trim()
        } else if (i.phone_id && phoneMap[i.phone_id]?.name) {
          name = phoneMap[i.phone_id].name
        } else if (snap && (snap.brand || snap.model)) {
          name = `${snap.brand || ''} ${snap.model || ''}${snap.storage ? ` ${snap.storage}` : ''}`.trim()
        } else if (i.brand && i.model) {
          name = `${i.brand} ${i.model}`.trim()
        }
        name = name.replace(/\s*\(?IMEI[:\s]+[0-9/,\s]+\)?/gi, '').trim() || 'Uncategorized Product'

        const isPhone = Boolean(i.phone_id || snap || i.item_type === 'phone' || (i.products?.categories?.name === 'Mobile Phones'))

        const phoneInfo = i.phone_id ? phoneMap[i.phone_id] : null
        const directCost = Number((Number(i.additional_costs) > 0 ? i.additional_costs : null) ?? (phoneInfo ? phoneInfo.directCost : (snap?.additional_costs || 0)) ?? 0)
        const baseCost = Number(
          (Number(i.cost_price) > 0 ? i.cost_price : null) ??
          (phoneInfo ? phoneInfo.baseCost : null) ??
          (i.product_id ? productCostMap[i.product_id] : null) ??
          (productCostMap[name] || 0)
        )
        const costPrice = baseCost + directCost
        const unitPrice = Number(
          (Number(i.unit_price) > 0 ? i.unit_price : null) ??
          (Number(i.price) > 0 ? i.price : null) ??
          (phoneInfo ? phoneInfo.price : 0) ?? 0
        )

        let lineRev = Number(
          (Number(i.line_total) > 0 ? i.line_total : null) ??
          (Number(i.subtotal) > 0 ? i.subtotal : null) ??
          (netQty * unitPrice)
        )
        if (lineRev <= 0 && Number(s.total_amount || 0) > 0 && (s.sale_items?.length || 1) === 1) {
          lineRev = Number(s.total_amount || 0)
        }

        const lineCost = netQty * costPrice

        if (isPhone) {
          todayPhonesSold += netQty
          todayPhonesRevenue += lineRev
          todayPhonesCost += lineCost
        } else {
          todayBulkSold += netQty
          todayBulkRevenue += lineRev
          todayBulkCost += lineCost
        }

        if (!todayProdMap[name]) {
          todayProdMap[name] = { name, qty: 0, revenue: 0, cost: 0, isPhone }
        }
        todayProdMap[name].qty += netQty
        todayProdMap[name].revenue += lineRev
        todayProdMap[name].cost += lineCost
      })
    })

    const todayItemsRevenue = todayPhonesRevenue + todayBulkRevenue
    const todayGrossSales = todayItemsRevenue > 0
      ? todayItemsRevenue
      : todaySalesList.reduce((sum, s) => sum + Number(s.total_amount || s.net_amount || 0), 0)
    const todayTotalDiscount = todaySalesList.reduce((sum, s) => sum + Number(s.discount || 0), 0)
    const todayNetSales = Math.max(0, todayGrossSales - todayTotalDiscount)
    const todayCOGS = todayPhonesCost + todayBulkCost
    const todayProfit = todayNetSales - todayCOGS
    const todayProfitMargin = todayNetSales > 0 ? (todayProfit / todayNetSales) * 100 : 0
    const todayOrdersCount = todaySalesList.length
    const todayAOV = todayOrdersCount > 0 ? todayGrossSales / todayOrdersCount : 0

    // Payment breakdowns
    const todayCashSales = todaySalesList
      .filter(s => s.payment_type === 'cash')
      .reduce((sum, s) => sum + (Number(s.total_amount || 0) - Number(s.discount || 0)), 0)

    const todayOnlineSales = todaySalesList
      .filter(s => ['online', 'jazzcash', 'easypaisa', 'bank', 'sadapay', 'nayapay'].includes(String(s.payment_type || '').toLowerCase()))
      .reduce((sum, s) => sum + (Number(s.total_amount || 0) - Number(s.discount || 0)), 0)

    const todayCreditSales = todaySalesList
      .filter(s => s.payment_type === 'credit')
      .reduce((sum, s) => sum + (Number(s.total_amount || 0) - Number(s.discount || 0)), 0)

    // 2. Today's Expenses
    const todayExpenses = (todayExpensesList || []).reduce((sum, e) => sum + Number(e.amount || 0), 0)
    const todayNetProfit = todayProfit - todayExpenses

    // 3. Today's Purchases / Inward Procurement
    let todayPurchasesCost = 0
    let todayCashPurchases = 0
    let todayPurchasedUnits = 0
    let todayPurchasedPhones = 0
    let todayPurchasedBulk = 0

    ;(todayPurchasesList || []).forEach(p => {
      const pCost = Number(p.total_amount || 0)
      todayPurchasesCost += pCost
      if (String(p.payment_type || '').toLowerCase() === 'cash') {
        todayCashPurchases += pCost
      }

      const isBulk = Boolean((p.purchase_items && p.purchase_items.length > 0) || (p.item_type && p.item_type !== 'phone'))
      if (isBulk) {
        let pQty = 0
        if (p.purchase_items && p.purchase_items.length > 0) {
          pQty = p.purchase_items.reduce((s, pi) => s + Number(pi.quantity || 1), 0)
        } else {
          pQty = Number(p.total_items || 1)
        }
        todayPurchasedBulk += pQty
        todayPurchasedUnits += pQty
      } else {
        todayPurchasedPhones += 1
        todayPurchasedUnits += 1
      }
    })

    const todayNetCashDrawer = todayCashSales - todayExpenses - todayCashPurchases

    // 4. Month-to-date total
    const monthlyTotal = monthSalesList.reduce((sum, s) => sum + (Number(s.total_amount || 0) - Number(s.discount || 0)), 0)
    const monthlyOrdersCount = monthSalesList.length

    // 5. Inventory Valuations & Stock Health
    const inStockPhones = phonesList.filter(p => p.status === 'in_stock')
    const phonesValuation = inStockPhones.reduce((sum, p) => sum + Number(p.cost_price || 0) + Number(p.additional_costs || 0), 0)
    const productsValuation = productList.reduce((sum, p) => sum + (Number(p.cost_price || 0) * Math.max(0, Number(p.stock_quantity || 0))), 0)
    const productsStockTotal = productList.reduce((sum, p) => sum + Math.max(0, Number(p.stock_quantity || 0)), 0)
    const totalStockValuation = phonesValuation + productsValuation

    const lowStockList = productList
      .filter(p => Number(p.stock_quantity || 0) <= Number(p.low_stock_threshold || 5))
      .sort((a, b) => Number(a.stock_quantity) - Number(b.stock_quantity))

    // 6. 7-Day Trend Chart
    const daysArr = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      d.setHours(0, 0, 0, 0)
      const dayLabel = d.toLocaleDateString('en-PK', { weekday: 'short' })
      const dateStr = d.toISOString().split('T')[0]
      daysArr.push({ day: dayLabel, date: dateStr, amount: 0 })
    }

    weekSalesList.forEach(s => {
      const saleDate = s.created_at ? s.created_at.split('T')[0] : ''
      const entry = daysArr.find(d => d.date === saleDate)
      if (entry) {
        entry.amount += (Number(s.total_amount || 0) - Number(s.discount || 0))
      }
    })
    setWeeklyTrend(daysArr)

    // 7. Top Selling Products Today
    const topProducts = Object.values(todayProdMap)
      .map(p => ({
        ...p,
        profit: p.revenue - p.cost,
        margin: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue) * 100 : 0
      }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5)

    setStats({
      todaySales: todayGrossSales,
      todayCOGS,
      todayProfit,
      todayProfitMargin,
      todayNetProfit,
      todayCashSales,
      todayCreditSales,
      todayOnlineSales,
      todayItemsSold,
      todayBulkSold,
      todayBulkRevenue,
      todayPhonesSold,
      todayPhonesRevenue,
      todayOrdersCount,
      todayAOV,
      todayExpenses,
      todayPurchasesCost,
      todayPurchasedUnits,
      todayPurchasedPhones,
      todayPurchasedBulk,
      todayNetCashDrawer,
      monthlySales: monthlyTotal,
      monthlyOrdersCount,
      lowStockCount: lowStockList.length,
      productCount: productList.length,
      phonesInStock: inStockPhones.length,
      phonesValuation,
      productsValuation,
      productsStockTotal,
      totalStockValuation,
      planInfo: config,
      recentSales: recentSalesList,
      topSellingToday: topProducts,
      lowStockItems: lowStockList.slice(0, 5)
    })
  }

  // EOD Closing Logic
  const openEOD = async () => {
    setEodLoading(true)
    setShowEOD(true)
    try {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const [expRes, purRes] = await Promise.all([
        supabase.from('expenses').select('amount').eq('shop_id', user.shop_id).gte('created_at', today.toISOString()),
        supabase.from('purchases').select('total_amount, payment_type').eq('shop_id', user.shop_id).gte('created_at', today.toISOString())
      ])
      const todayExpenses = (expRes.data || []).reduce((s, e) => s + Number(e.amount || 0), 0)
      const purchasesList = purRes.data || []
      const todayCashPurchases = purchasesList.filter(p => p.payment_type === 'cash').reduce((s, p) => s + Number(p.total_amount || 0), 0)
      const todayBankPurchases = purchasesList.filter(p => ['bank', 'online'].includes(String(p.payment_type || '').toLowerCase())).reduce((s, p) => s + Number(p.total_amount || 0), 0)
      const todayCreditPurchases = purchasesList.filter(p => p.payment_type === 'credit').reduce((s, p) => s + Number(p.total_amount || 0), 0)

      setEodData({
        cashSales: stats.todayCashSales,
        onlineSales: stats.todayOnlineSales,
        creditSales: stats.todayCreditSales,
        totalSales: stats.todaySales,
        profit: stats.todayProfit,
        expenses: todayExpenses,
        cashPurchases: todayCashPurchases,
        bankPurchases: todayBankPurchases,
        creditPurchases: todayCreditPurchases,
        netCash: stats.todayCashSales - todayExpenses - todayCashPurchases
      })
    } catch (e) {
      console.error('EOD fetch error:', e)
    } finally {
      setEodLoading(false)
    }
  }

  const shareEODWhatsApp = () => {
    const d = eodData
    if (!d) return
    const dateStr = new Date().toLocaleDateString('en-PK', { dateStyle: 'medium' })
    const msg =
      `🌙 *End of Day Summary — ${dateStr}*\n*${shopName}*\n\n` +
      `💵 Cash Sales: Rs. ${Math.round(d.cashSales).toLocaleString()}\n` +
      `📱 Digital/Online: Rs. ${Math.round(d.onlineSales).toLocaleString()}\n` +
      `📒 Customer Credit: Rs. ${Math.round(d.creditSales).toLocaleString()}\n` +
      `📊 Total Revenue: Rs. ${Math.round(d.totalSales).toLocaleString()}\n\n` +
      `💸 Shop Expenses: Rs. ${Math.round(d.expenses).toLocaleString()}\n` +
      `📦 Cash Purchases: Rs. ${Math.round(d.cashPurchases).toLocaleString()}\n\n` +
      `📈 Gross Business Profit: Rs. ${Math.round(d.profit).toLocaleString()}\n` +
      `💰 *Net Cash in Hand: Rs. ${Math.round(d.netCash).toLocaleString()}*`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  const printEOD = () => {
    const d = eodData
    if (!d) return
    const branding = getShopBranding(user?.shop_id)
    const dateStr = new Date().toLocaleDateString('en-PK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    printHTML(`<html><head><title>End of Day Report</title>
      <style>
        @page{size:80mm auto;margin:3mm}
        *{box-sizing:border-box}
        body{font-family:'Courier New', monospace;width:290px;margin:0 auto;padding:10px 4px;font-size:12px;color:#000}
        h2,p.center{text-align:center;margin:2px 0;}
        hr{border:none;border-top:1px dashed #000;margin:6px 0;}
        .row{display:flex;justify-content:space-between;padding:3px 0;}
        .bold{font-weight:bold;}
      </style></head><body>
      <h2>${branding.name}</h2>
      ${branding.phone ? `<p class="center" style="font-size:11px;">${branding.phone}</p>` : ''}
      <p class="center bold" style="margin-top:4px;">🌙 END OF DAY SUMMARY</p>
      <p class="center" style="font-size:11px;">${dateStr}</p>
      <hr/>
      <p class="center bold">SALES INFLOW</p>
      <div class="row"><span>Cash Sales:</span><span class="bold">Rs. ${Math.round(d.cashSales).toLocaleString()}</span></div>
      <div class="row"><span>Digital / Online:</span><span class="bold">Rs. ${Math.round(d.onlineSales).toLocaleString()}</span></div>
      <div class="row"><span>Credit (Khata):</span><span class="bold">Rs. ${Math.round(d.creditSales).toLocaleString()}</span></div>
      <div class="row bold" style="border-top:1px solid #ddd;margin-top:2px;padding-top:2px">
        <span>Total Sales:</span><span>Rs. ${Math.round(d.totalSales).toLocaleString()}</span>
      </div>
      <hr/>
      <p class="center bold">OUTFLOWS</p>
      <div class="row"><span>Expenses:</span><span>Rs. ${Math.round(d.expenses).toLocaleString()}</span></div>
      <div class="row"><span>Cash Purchases:</span><span>Rs. ${Math.round(d.cashPurchases).toLocaleString()}</span></div>
      <hr/>
      <div class="row bold"><span>Gross Profit:</span><span>Rs. ${Math.round(d.profit).toLocaleString()}</span></div>
      <div class="row bold" style="font-size:14px;border-top:1px solid #000;padding-top:4px;margin-top:4px">
        <span>Net Cash in Hand:</span><span>Rs. ${Math.round(d.netCash).toLocaleString()}</span>
      </div>
      <hr/>
      <p class="center" style="font-size:10px;color:#666;">Generated at: ${new Date().toLocaleTimeString('en-PK')}</p>
      </body></html>`)
  }

  // 7-Day total calculations
  const weeklyTotal = useMemo(() => {
    return weeklyTrend.reduce((sum, d) => sum + d.amount, 0)
  }, [weeklyTrend])

  const weeklyAvg = useMemo(() => {
    return weeklyTrend.length > 0 ? weeklyTotal / weeklyTrend.length : 0
  }, [weeklyTotal, weeklyTrend])

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 font-[-apple-system,BlinkMacSystemFont,'SF_Pro_Display','SF_Pro_Text','Plus_Jakarta_Sans',sans-serif]">
      {/*  Million-Dollar SaaS Header Strip with Live Activity Indicator */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1 pb-1">
        <div>
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] border border-black/[0.06] dark:border-white/[0.1] shadow-2xs">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="font-extrabold text-blue-600">📱 {shopName}</span>
            </span>
            <span className="text-xs text-[#86868b] font-medium">
              • {new Date().toLocaleDateString('en-PK', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
            Store Intelligence
          </h1>
          <p className="text-[#86868b] text-xs sm:text-sm mt-0.5 font-normal">
            Real-time sales velocity, net earnings, cash register balance, and inventory valuation.
          </p>
        </div>

        {/* SaaS Quick Action Control Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/pos"
            className="px-3.5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 active:scale-95 text-white text-xs font-bold rounded-full shadow-xs hover:shadow transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <ShoppingBag size={14} />
            <span>+ New Sale (POS)</span>
          </Link>

          <Link
            to="/purchases"
            className="px-3 py-2 bg-white dark:bg-[#1c1c1e] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] active:scale-95 text-[#1d1d1f] dark:text-[#f5f5f7] text-xs font-semibold rounded-full border border-black/[0.08] dark:border-white/[0.1] shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Smartphone size={14} className="text-purple-600" />
            <span>+ Buy Phone</span>
          </Link>

          <Link
            to="/expenses"
            className="px-3 py-2 bg-white dark:bg-[#1c1c1e] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] active:scale-95 text-[#1d1d1f] dark:text-[#f5f5f7] text-xs font-semibold rounded-full border border-black/[0.08] dark:border-white/[0.1] shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <DollarSign size={14} className="text-rose-500" />
            <span>+ Expense</span>
          </Link>

          <button
            onClick={openEOD}
            className="px-3.5 py-2 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 text-amber-900 dark:text-amber-300 text-xs font-bold rounded-full border border-amber-200/80 dark:border-amber-700/50 shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Moon size={13} className="text-amber-600" />
            <span>Close Day (EOD)</span>
          </button>

          <button
            onClick={fetchDashboardStats}
            disabled={loading}
            className="w-8.5 h-8.5 flex items-center justify-center bg-white dark:bg-[#1c1c1e] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] active:scale-95 border border-black/[0.08] dark:border-white/[0.1] rounded-full transition text-[#1d1d1f] dark:text-[#f5f5f7] cursor-pointer shadow-2xs"
            title="Refresh Stats"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/*  Apple Control Center Primary KPI Widgets (6 Core Financial Metrics with Hero Net Profit) */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 animate-pulse">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-32 bg-[#e5e5ea]/50 dark:bg-[#2c2c2e]/50 rounded-[22px]"></div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {/* 1. Today's Gross Sales */}
          <AppleWidget
            title="Today's Sales (Rs)"
            hint="فروخت"
            value={stats.todaySales}
            icon={<Banknote size={20} />}
            color="text-[#0071e3]"
            bgTint="bg-[#0071e3]/10"
            badge="Today"
            subValue={
              stats.todayOrdersCount > 0
                ? `${stats.todayOrdersCount} orders • Avg: Rs. ${Math.round(stats.todayAOV).toLocaleString()}`
                : 'No sales yet'
            }
            onClick={() => navigate('/sales')}
          />

          {/* 2. Today's Net Profit (THE HERO METRIC - Saaf Munafa) */}
          <AppleWidget
            isHero={true}
            title="Net Profit (Rs)"
            hint="صافی منافع"
            value={stats.todayNetProfit}
            icon={<Sparkles size={20} />}
            color="text-emerald-600 dark:text-emerald-400"
            bgTint="bg-emerald-500/15"
            badge="Pure Profit"
            subValue={
              stats.todaySales > 0
                ? `Rs. ${Math.round(stats.todayProfit).toLocaleString()} gross − Rs. ${Math.round(stats.todayExpenses).toLocaleString()} exp`
                : 'Pure profit after all expenses'
            }
            onClick={() => navigate('/reports')}
          />

          {/* 3. Today's Gross Profit */}
          <AppleWidget
            title="Gross Profit (Rs)"
            hint="مارجن"
            value={stats.todayProfit}
            icon={<TrendingUp size={20} />}
            color="text-[#34c759]"
            bgTint="bg-[#34c759]/10"
            badge={`${(stats.todayProfitMargin ?? 0).toFixed(1)}% Margin`}
            subValue={`COGS: Rs. ${Math.round(stats.todayCOGS).toLocaleString()}`}
            onClick={() => navigate('/reports')}
          />

          {/* 4. Items Sold Today */}
          <AppleWidget
            title="Units Sold Today"
            hint="تعداد"
            value={`${stats.todayItemsSold} Pcs`}
            icon={<ShoppingBag size={20} />}
            color="text-[#5856d6]"
            bgTint="bg-[#5856d6]/10"
            badge="Volume"
            subValue={`${stats.todayPhonesSold} phones • ${stats.todayBulkSold} accessories`}
            onClick={() => navigate('/reports')}
          />

          {/* 5. Today's Inward Purchases / Procurement */}
          <AppleWidget
            title="Purchases Today (Rs)"
            hint="خریداری"
            value={stats.todayPurchasesCost}
            icon={<CreditCard size={20} />}
            color="text-[#ff9500]"
            bgTint="bg-[#ff9500]/10"
            badge="Stock In"
            subValue={
              stats.todayPurchasedUnits > 0
                ? `${stats.todayPurchasedPhones} phones • ${stats.todayPurchasedBulk} acc`
                : 'No purchases today'
            }
            onClick={() => navigate('/purchases')}
          />

          {/* 6. Inventory Asset Valuation */}
          <AppleWidget
            title="Stock Value (Rs)"
            hint="سرمایہ"
            value={stats.totalStockValuation}
            icon={<Smartphone size={20} />}
            color="text-[#af52de]"
            bgTint="bg-[#af52de]/10"
            badge="Asset"
            subValue={`${stats.phonesInStock} phones • ${stats.productsStockTotal} accessories`}
            onClick={() => navigate('/products')}
          />
        </div>
      )}

      {/*  Real-Time Cash Flow & Operational Health Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* 1. Cash in Drawer (Galla) */}
        <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl p-3.5 rounded-[18px] border border-black/[0.05] dark:border-white/[0.08] shadow-2xs flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-bold text-[#86868b] uppercase tracking-wider block">Cash in Drawer</span>
              <span className="text-[10px] text-emerald-600 font-bold">(گلہ)</span>
            </div>
            <span className={`text-base font-extrabold tabular-nums ${stats.todayNetCashDrawer >= 0 ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>
              Rs. {Math.round(stats.todayNetCashDrawer).toLocaleString()}
            </span>
            <span className="text-[10px] text-[#86868b] block mt-0.5">Cash in hand balance</span>
          </div>
          <div className="w-8.5 h-8.5 rounded-[12px] bg-[#34c759]/10 text-[#34c759] flex items-center justify-center font-bold text-xs shrink-0">
            <Wallet size={16} />
          </div>
        </div>

        {/* 2. Digital / Bank Inflow */}
        <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl p-3.5 rounded-[18px] border border-black/[0.05] dark:border-white/[0.08] shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-[#86868b] uppercase tracking-wider block">Digital / Bank</span>
            <span className="text-base font-extrabold text-[#0071e3] tabular-nums">
              Rs. {Math.round(stats.todayOnlineSales).toLocaleString()}
            </span>
            <span className="text-[10px] text-[#86868b] block mt-0.5">JazzCash • Bank transfers</span>
          </div>
          <div className="w-8.5 h-8.5 rounded-[12px] bg-[#0071e3]/10 text-[#0071e3] flex items-center justify-center font-bold text-xs shrink-0">
            💳
          </div>
        </div>

        {/* 3. Operating Expenses */}
        <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl p-3.5 rounded-[18px] border border-black/[0.05] dark:border-white/[0.08] shadow-2xs flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-bold text-[#86868b] uppercase tracking-wider block">Today's Expenses</span>
              <span className="text-[10px] text-rose-500 font-bold">(خرچے)</span>
            </div>
            <span className="text-base font-extrabold text-[#ff3b30] tabular-nums">
              Rs. {Math.round(stats.todayExpenses).toLocaleString()}
            </span>
            <span className="text-[10px] text-[#86868b] block mt-0.5">Shop running costs</span>
          </div>
          <div className="w-8.5 h-8.5 rounded-[12px] bg-[#ff3b30]/10 text-[#ff3b30] flex items-center justify-center font-bold text-xs shrink-0">
            💸
          </div>
        </div>

        {/* 4. Month Sales (MTD) */}
        <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl p-3.5 rounded-[18px] border border-black/[0.05] dark:border-white/[0.08] shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-[#86868b] uppercase tracking-wider block">Month Sales (MTD)</span>
            <span className="text-base font-extrabold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">
              Rs. {Math.round(stats.monthlySales).toLocaleString()}
            </span>
            <span className="text-[10px] text-[#86868b] block mt-0.5">{stats.monthlyOrdersCount} orders this month</span>
          </div>
          <div className="w-8.5 h-8.5 rounded-[12px] bg-[#5856d6]/10 text-[#5856d6] flex items-center justify-center font-bold text-xs shrink-0">
            <Activity size={16} />
          </div>
        </div>

        {/* 5. Low Stock Alert Watchlist */}
        <div
          onClick={() => navigate('/products')}
          className="col-span-2 sm:col-span-3 lg:col-span-1 bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl p-3.5 rounded-[18px] border border-black/[0.05] dark:border-white/[0.08] shadow-2xs flex items-center justify-between cursor-pointer hover:border-[#ff9500]/40 transition"
        >
          <div>
            <span className="text-[10px] font-bold text-[#86868b] uppercase tracking-wider block">Catalog Health</span>
            <span className={`text-base font-extrabold tabular-nums ${stats.lowStockCount > 0 ? 'text-[#ff9500]' : 'text-[#34c759]'}`}>
              {stats.lowStockCount > 0 ? `${stats.lowStockCount} Reorders Due` : 'Stock Healthy'}
            </span>
            <span className="text-[10px] text-[#86868b] block mt-0.5">
              {stats.lowStockCount > 0 ? 'Items below reorder point' : 'All items well-stocked'}
            </span>
          </div>
          <div className={`w-8.5 h-8.5 rounded-[12px] flex items-center justify-center shrink-0 ${stats.lowStockCount > 0 ? 'bg-[#ff9500]/10 text-[#ff9500]' : 'bg-[#34c759]/10 text-[#34c759]'}`}>
            <AlertTriangle size={16} />
          </div>
        </div>
      </div>

      {/*  Middle Analytics Row: 7-Day Velocity Chart & Inventory Capital Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Apple Stocks-style 7-Day Sales Trend (2 Columns) */}
        <div className="lg:col-span-2 bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl p-5 sm:p-6 rounded-[24px] border border-black/[0.05] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
              <div>
                <h3 className="text-[#1d1d1f] dark:text-[#f5f5f7] font-semibold text-[15px] flex items-center gap-2">
                  <span className="w-2 h-2 bg-[#0071e3] rounded-full"></span>
                  <span>7-Day Sales Velocity</span>
                </h3>
                <p className="text-[#86868b] text-xs mt-0.5">
                  Daily revenue velocity • Avg: Rs. {Math.round(weeklyAvg).toLocaleString()}/day
                </p>
              </div>

              <div className="flex items-center gap-4 text-left sm:text-right">
                <div>
                  <span className="text-[10px] font-semibold uppercase text-[#86868b] tracking-wider block">7-Day Total</span>
                  <span className="text-base sm:text-lg font-bold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">
                    Rs. {Math.round(weeklyTotal).toLocaleString()}
                  </span>
                </div>
                <Link
                  to="/reports"
                  className="text-xs font-semibold text-[#0071e3] hover:underline flex items-center gap-0.5 cursor-pointer"
                >
                  <span>Daily Breakdown</span>
                  <ChevronRight size={13} />
                </Link>
              </div>
            </div>

            <div className="h-56 w-full mt-2">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={weeklyTrend}>
                  <defs>
                    <linearGradient id="appleSalesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0071e3" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#0071e3" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="day"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#86868b', fontWeight: 600 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: '#86868b' }}
                    tickFormatter={v => v >= 1000 ? `${Math.round(v / 1000)}k` : v}
                  />
                  <Tooltip
                    formatter={val => [`Rs. ${Number(val).toLocaleString()}`, 'Revenue']}
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      borderRadius: '14px',
                      border: '1px solid rgba(0, 0, 0, 0.08)',
                      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.08)',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#1d1d1f'
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke="#0071e3"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#appleSalesGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Quick Metrics Bar Under Velocity Chart */}
          <div className="grid grid-cols-3 gap-2.5 pt-4 border-t border-black/[0.04] dark:border-white/[0.06] mt-3">
            <div className="p-3 rounded-[16px] bg-[#f5f5f7] dark:bg-white/[0.04] text-center border border-black/[0.02] dark:border-white/[0.04]">
              <span className="text-[10px] font-semibold text-[#86868b] uppercase tracking-wider block">Average Ticket (AOV)</span>
              <span className="text-xs sm:text-sm font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mt-0.5 block tabular-nums">
                Rs. {Math.round(stats.todayAOV).toLocaleString()}
              </span>
            </div>

            <div className="p-3 rounded-[16px] bg-[#f5f5f7] dark:bg-white/[0.04] text-center border border-black/[0.02] dark:border-white/[0.04]">
              <span className="text-[10px] font-semibold text-[#86868b] uppercase tracking-wider block">Phones Sold (Today)</span>
              <span className="text-xs sm:text-sm font-bold text-[#af52de] mt-0.5 block tabular-nums">
                {stats.todayPhonesSold} Units • Rs. {Math.round(stats.todayPhonesRevenue).toLocaleString()}
              </span>
            </div>

            <div className="p-3 rounded-[16px] bg-[#f5f5f7] dark:bg-white/[0.04] text-center border border-black/[0.02] dark:border-white/[0.04]">
              <span className="text-[10px] font-semibold text-[#86868b] uppercase tracking-wider block">Accessories Sold</span>
              <span className="text-xs sm:text-sm font-bold text-[#0071e3] mt-0.5 block tabular-nums">
                {stats.todayBulkSold} Pcs • Rs. {Math.round(stats.todayBulkRevenue).toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/*  Apple Stock Valuation & Capital Asset Distribution Card */}
        <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl p-5 sm:p-6 rounded-[24px] border border-black/[0.05] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3.5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-[10px] bg-[#0071e3]/10 text-[#0071e3] flex items-center justify-center">
                  <Smartphone size={16} />
                </div>
                <div>
                  <h3 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-[15px] leading-tight">Stock Valuation</h3>
                  <p className="text-[11px] text-[#86868b]">Cost basis inventory investment</p>
                </div>
              </div>
              <button
                onClick={() => navigate('/products')}
                className="text-xs text-[#0071e3] font-semibold hover:underline cursor-pointer"
              >
                Catalog →
              </button>
            </div>

            <div className="p-3.5 rounded-[18px] bg-[#f5f5f7] dark:bg-white/[0.04] border border-black/[0.03] dark:border-white/[0.04] mb-3.5">
              <span className="text-[10px] font-semibold text-[#86868b] uppercase tracking-wider block">Total Inventory Assets</span>
              <span className="text-2xl font-bold tracking-tight text-[#1d1d1f] dark:text-white mt-0.5 block tabular-nums">
                Rs. {Math.round(stats.totalStockValuation).toLocaleString()}
              </span>
            </div>

            {/* Asset Allocation Ratio Bar */}
            <div className="w-full h-2 bg-[#e5e5ea] dark:bg-[#2c2c2e] rounded-full overflow-hidden flex mb-3">
              <div
                className="bg-[#af52de] h-full"
                style={{
                  width: `${stats.totalStockValuation > 0 ? (stats.phonesValuation / stats.totalStockValuation) * 100 : 50}%`
                }}
                title={`Phones: Rs. ${Math.round(stats.phonesValuation).toLocaleString()}`}
              />
              <div
                className="bg-[#0071e3] h-full"
                style={{
                  width: `${stats.totalStockValuation > 0 ? (stats.productsValuation / stats.totalStockValuation) * 100 : 50}%`
                }}
                title={`Accessories: Rs. ${Math.round(stats.productsValuation).toLocaleString()}`}
              />
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center p-2.5 rounded-[14px] bg-[#af52de]/5 border border-[#af52de]/10">
                <span className="text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2 font-medium">
                  <Smartphone size={13} className="text-[#af52de]" />
                  <span>Mobile Phones ({stats.phonesInStock} units)</span>
                </span>
                <span className="font-bold text-[#af52de] tabular-nums">
                  Rs. {Math.round(stats.phonesValuation).toLocaleString()}
                </span>
              </div>

              <div className="flex justify-between items-center p-2.5 rounded-[14px] bg-[#0071e3]/5 border border-[#0071e3]/10">
                <span className="text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2 font-medium">
                  <Package size={13} className="text-[#0071e3]" />
                  <span>Accessories ({stats.productsStockTotal || 0} pcs)</span>
                </span>
                <span className="font-bold text-[#0071e3] tabular-nums">
                  Rs. {Math.round(stats.productsValuation).toLocaleString()}
                </span>
              </div>

              <div className="flex justify-between items-center p-2.5 rounded-[14px] bg-[#34c759]/5 border border-[#34c759]/10">
                <span className="text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2 font-medium">
                  <AlertTriangle size={13} className={stats.lowStockCount > 0 ? 'text-[#ff9500]' : 'text-[#34c759]'} />
                  <span>Stock Reorder Health</span>
                </span>
                <span className={`font-bold tabular-nums ${stats.lowStockCount > 0 ? 'text-[#ff9500]' : 'text-[#34c759]'}`}>
                  {stats.lowStockCount > 0 ? `${stats.lowStockCount} items low` : 'All Healthy'}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={() => navigate('/products')}
            className="w-full mt-3 py-2 bg-white dark:bg-[#2c2c2e] hover:bg-[#f5f5f7] dark:hover:bg-[#3a3a3c] border border-black/[0.08] dark:border-white/[0.1] text-[#1d1d1f] dark:text-[#f5f5f7] text-xs font-semibold rounded-full shadow-xs transition cursor-pointer flex items-center justify-center gap-1.5"
          >
            <span>Manage Catalog & Stock</span>
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/*  Bottom Row: Top Movers, Live Activity, and Reorder Watchlist */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 1. Top Moving Products Today */}
        <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl p-5 sm:p-6 rounded-[24px] border border-black/[0.05] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] text-[15px] flex items-center gap-1.5">
                  <Sparkles size={16} className="text-[#ff9500]" />
                  <span>Top Moving Products Today</span>
                </h3>
                <p className="text-[#86868b] text-xs">Fastest velocity items sold today</p>
              </div>
              <Link to="/reports" className="text-xs text-[#0071e3] font-semibold hover:underline flex items-center gap-0.5">
                <span>View Report</span>
                <ChevronRight size={13} />
              </Link>
            </div>

            {stats.topSellingToday.length > 0 ? (
              <div className="space-y-2">
                {stats.topSellingToday.map((p, idx) => (
                  <div
                    key={p.name}
                    className="flex items-center justify-between p-3 rounded-[16px] bg-[#f5f5f7]/60 dark:bg-white/[0.03] hover:bg-[#f5f5f7] dark:hover:bg-white/[0.06] transition border border-black/[0.02] dark:border-white/[0.04]"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-[#0071e3]/10 text-[#0071e3] font-bold text-xs flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <div>
                        <h4 className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] text-xs sm:text-sm truncate max-w-[160px] sm:max-w-[200px]" title={p.name}>
                          {p.name}
                        </h4>
                        <span className="text-[11px] text-[#86868b]">
                          {p.qty} {p.isPhone ? 'phones' : 'pcs'} • Profit: Rs. {Math.round(p.profit).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-xs sm:text-sm text-[#1d1d1f] dark:text-white block tabular-nums">
                        Rs. {Math.round(p.revenue).toLocaleString()}
                      </span>
                      <span className="text-[10px] font-semibold text-[#34c759]">
                        {(p.margin ?? 0).toFixed(0)}% margin
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-9 text-center text-[#86868b] text-xs italic bg-[#f5f5f7] dark:bg-white/[0.03] rounded-[18px]">
                No product sales recorded yet today. Completed orders will appear here.
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-black/[0.04] dark:border-white/[0.06] flex justify-between items-center text-xs">
            <span className="text-[#86868b] font-medium">Period Total Units:</span>
            <span className="font-bold text-[#0071e3] tabular-nums">
              {stats.todayItemsSold} Items Sold Today
            </span>
          </div>
        </div>

        {/* 2. Live Recent Transactions Feed */}
        <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl p-5 sm:p-6 rounded-[24px] border border-black/[0.05] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] text-[15px] flex items-center gap-1.5">
                  <Clock size={16} className="text-[#0071e3]" />
                  <span>Recent Checkout Activity</span>
                </h3>
                <p className="text-[#86868b] text-xs">Live store order stream</p>
              </div>
              <Link to="/sales" className="text-xs text-[#0071e3] font-semibold hover:underline flex items-center gap-0.5">
                <span>All Orders</span>
                <ChevronRight size={13} />
              </Link>
            </div>

            {stats.recentSales.length > 0 ? (
              <div className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                {stats.recentSales.map(s => {
                  const custName = s.customer_name || s.customers?.name || 'Walk-in Customer'
                  const pType = String(s.payment_type || 'cash').toLowerCase()
                  const netAmount = Number(s.total_amount || 0) - Number(s.discount || 0)
                  const timeStr = s.created_at
                    ? new Date(s.created_at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })
                    : ''

                  return (
                    <div key={s.id} className="py-2.5 flex items-center justify-between hover:bg-[#f5f5f7]/60 dark:hover:bg-white/[0.03] px-2 rounded-[14px] transition">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#f5f5f7] dark:bg-white/10 text-[#0071e3] font-bold text-xs flex items-center justify-center shrink-0">
                          #{s.id}
                        </div>
                        <div className="truncate max-w-[120px] sm:max-w-[150px]">
                          <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] text-xs block truncate">{custName}</span>
                          <span className="text-[11px] text-[#86868b]">{timeStr}</span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="font-bold text-xs sm:text-sm text-[#1d1d1f] dark:text-[#f5f5f7] block tabular-nums">
                          Rs. {Math.round(netAmount).toLocaleString()}
                        </span>
                        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full inline-block ${
                          pType === 'cash'
                            ? 'bg-[#34c759]/10 text-[#34c759]'
                            : pType === 'credit'
                              ? 'bg-[#ff9500]/10 text-[#ff9500]'
                              : 'bg-[#5856d6]/10 text-[#5856d6]'
                        }`}>
                          {pType}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="py-9 text-center text-[#86868b] text-xs italic bg-[#f5f5f7] dark:bg-white/[0.03] rounded-[18px]">
                No recent transactions recorded yet.
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-black/[0.04] dark:border-white/[0.06] flex justify-between items-center text-xs">
            <span className="text-[#86868b] font-medium">Total Orders Today:</span>
            <span className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">
              {stats.todayOrdersCount} Invoices
            </span>
          </div>
        </div>

        {/* 3. Reorder Watchlist & Low Stock Alerts (Replacing Old Debtors/Receivables) */}
        <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl p-5 sm:p-6 rounded-[24px] border border-black/[0.05] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] text-[15px] flex items-center gap-1.5">
                  <AlertTriangle size={16} className={stats.lowStockCount > 0 ? 'text-[#ff3b30]' : 'text-[#34c759]'} />
                  <span>Reorder & Critical Stock</span>
                </h3>
                <p className="text-[#86868b] text-xs">Items nearing depletion or zero stock</p>
              </div>
              <Link to="/products" className="text-xs text-[#0071e3] font-semibold hover:underline flex items-center gap-0.5">
                <span>Manage</span>
                <ChevronRight size={13} />
              </Link>
            </div>

            {stats.lowStockItems.length > 0 ? (
              <div className="space-y-2">
                {stats.lowStockItems.map(item => (
                  <div
                    key={item.id}
                    className="p-3 rounded-[16px] bg-[#ff3b30]/5 border border-[#ff3b30]/15 flex justify-between items-center text-xs hover:bg-[#ff3b30]/10 transition"
                  >
                    <div className="truncate max-w-[170px]">
                      <span className="font-semibold text-[#1d1d1f] dark:text-gray-200 block truncate" title={item.name}>
                        {item.name}
                      </span>
                      <span className="text-[11px] text-[#86868b]">
                        Cost: Rs. {Math.round(Number(item.cost_price || 0)).toLocaleString()} • Threshold: {item.low_stock_threshold || 5}
                      </span>
                    </div>
                    <span className="font-bold text-[#ff3b30] px-2.5 py-1 rounded-full bg-white dark:bg-[#1c1c1e] text-xs shadow-2xs tabular-nums">
                      {item.stock_quantity} left
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-9 text-center text-[#34c759] text-xs font-semibold bg-[#34c759]/5 border border-[#34c759]/15 rounded-[18px]">
                ✓ All catalog inventory levels are healthy!
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-black/[0.04] dark:border-white/[0.06] flex justify-between items-center text-xs">
            <span className="text-[#86868b] font-medium">Reorder Items:</span>
            <span className={`font-bold tabular-nums ${stats.lowStockCount > 0 ? 'text-[#ff3b30]' : 'text-[#34c759]'}`}>
              {stats.lowStockCount} Items Below Threshold
            </span>
          </div>
        </div>
      </div>

      {/*  macOS / iOS App Launchpad */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#86868b] mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Link
            to="/pos"
            className="flex flex-col items-center justify-center p-4 bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl border border-black/[0.05] dark:border-white/[0.08] rounded-[22px] hover:shadow-[0_8px_20px_rgba(0,0,0,0.06)] active:scale-95 transition-all text-center group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-[16px] bg-gradient-to-tr from-[#0071e3] to-[#42a5f5] text-white flex items-center justify-center shadow-[0_4px_12px_rgba(0,113,227,0.3)] transition-transform group-hover:scale-105 mb-2">
              <ShoppingBag size={22} />
            </div>
            <span className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">New POS Sale</span>
            <span className="text-[10px] text-[#86868b]">Register Checkout</span>
          </Link>

          <Link
            to="/products"
            className="flex flex-col items-center justify-center p-4 bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl border border-black/[0.05] dark:border-white/[0.08] rounded-[22px] hover:shadow-[0_8px_20px_rgba(0,0,0,0.06)] active:scale-95 transition-all text-center group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-[16px] bg-gradient-to-tr from-[#7b1fa2] to-[#ab47bc] text-white flex items-center justify-center shadow-[0_4px_12px_rgba(123,31,162,0.3)] transition-transform group-hover:scale-105 mb-2">
              <Smartphone size={22} />
            </div>
            <span className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Mobile Devices</span>
            <span className="text-[10px] text-[#86868b]">Phones & IMEIs</span>
          </Link>

          <Link
            to="/products"
            className="flex flex-col items-center justify-center p-4 bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl border border-black/[0.05] dark:border-white/[0.08] rounded-[22px] hover:shadow-[0_8px_20px_rgba(0,0,0,0.06)] active:scale-95 transition-all text-center group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-[16px] bg-gradient-to-tr from-[#059669] to-[#34d399] text-white flex items-center justify-center shadow-[0_4px_12px_rgba(5,150,105,0.3)] transition-transform group-hover:scale-105 mb-2">
              <Package size={22} />
            </div>
            <span className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Product Catalog</span>
            <span className="text-[10px] text-[#86868b]">Stock & Barcodes</span>
          </Link>

          <Link
            to="/purchases"
            className="flex flex-col items-center justify-center p-4 bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl border border-black/[0.05] dark:border-white/[0.08] rounded-[22px] hover:shadow-[0_8px_20px_rgba(0,0,0,0.06)] active:scale-95 transition-all text-center group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-[16px] bg-gradient-to-tr from-[#0d9488] to-[#2dd4bf] text-white flex items-center justify-center shadow-[0_4px_12px_rgba(13,148,136,0.3)] transition-transform group-hover:scale-105 mb-2">
              <CreditCard size={22} />
            </div>
            <span className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Purchases</span>
            <span className="text-[10px] text-[#86868b]">Stock Procurement</span>
          </Link>

          <Link
            to="/reports"
            className="flex flex-col items-center justify-center p-4 bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl border border-black/[0.05] dark:border-white/[0.08] rounded-[22px] hover:shadow-[0_8px_20px_rgba(0,0,0,0.06)] active:scale-95 transition-all text-center group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-[16px] bg-gradient-to-tr from-[#4f46e5] to-[#818cf8] text-white flex items-center justify-center shadow-[0_4px_12px_rgba(79,70,229,0.3)] transition-transform group-hover:scale-105 mb-2">
              <FileText size={22} />
            </div>
            <span className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Reports & P&L</span>
            <span className="text-[10px] text-[#86868b]">Daily & Weekly Trends</span>
          </Link>

          <Link
            to="/customers"
            className="flex flex-col items-center justify-center p-4 bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl border border-black/[0.05] dark:border-white/[0.08] rounded-[22px] hover:shadow-[0_8px_20px_rgba(0,0,0,0.06)] active:scale-95 transition-all text-center group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-[16px] bg-gradient-to-tr from-[#ea580c] to-[#fb923c] text-white flex items-center justify-center shadow-[0_4px_12px_rgba(234,88,12,0.3)] transition-transform group-hover:scale-105 mb-2">
              <Receipt size={22} />
            </div>
            <span className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Customers</span>
            <span className="text-[10px] text-[#86868b]">Customer Profiles</span>
          </Link>
        </div>
      </div>

      {/*  Apple Modal Sheet: End of Day Summary */}
      {showEOD && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-2xl rounded-[28px] shadow-[0_20px_60px_rgba(0,0,0,0.25)] border border-black/[0.08] dark:border-white/[0.12] w-full max-w-md overflow-hidden">
            {/* Sheet Handle */}
            <div className="pt-3 pb-1 flex justify-center">
              <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
            </div>

            <div className="p-6 pt-2">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h2 className="text-lg font-bold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-1.5">
                    <Moon size={17} className="text-[#0071e3]" /> End of Day Settlement
                  </h2>
                  <p className="text-[#86868b] text-xs mt-0.5">
                    {new Date().toLocaleDateString('en-PK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                </div>
                <button
                  onClick={() => setShowEOD(false)}
                  className="w-7 h-7 rounded-full bg-[#f5f5f7] dark:bg-white/10 text-[#86868b] hover:text-[#1d1d1f] flex items-center justify-center text-xs font-bold cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {eodLoading ? (
                <div className="py-12 text-center text-[#86868b] text-xs font-medium">Calculating settlement metrics...</div>
              ) : eodData ? (
                <div className="space-y-4">
                  {/* Collections */}
                  <div className="bg-[#f5f5f7] dark:bg-white/[0.04] p-4 rounded-[18px] border border-black/[0.02] dark:border-white/[0.04] space-y-2 text-xs">
                    <p className="text-[10px] font-semibold text-[#86868b] uppercase tracking-wider">Collections</p>
                    <div className="flex justify-between">
                      <span className="text-[#86868b]">Cash Collections:</span>
                      <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                        Rs. {Math.round(eodData.cashSales).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#86868b]">Digital / Online:</span>
                      <span className="font-semibold text-[#0071e3]">
                        Rs. {Math.round(eodData.onlineSales).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#86868b]">Customer Credit:</span>
                      <span className="font-semibold text-[#ff9500]">
                        Rs. {Math.round(eodData.creditSales).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-black/[0.04] dark:border-white/[0.06] pt-2 font-bold text-sm">
                      <span className="text-[#1d1d1f] dark:text-white">Total Sales:</span>
                      <span className="text-[#0071e3]">Rs. {Math.round(eodData.totalSales).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Outflows */}
                  <div className="bg-[#f5f5f7] dark:bg-white/[0.04] p-4 rounded-[18px] border border-black/[0.02] dark:border-white/[0.04] space-y-2 text-xs">
                    <p className="text-[10px] font-semibold text-[#86868b] uppercase tracking-wider">Outflows</p>
                    <div className="flex justify-between">
                      <span className="text-[#86868b]">Operating Expenses:</span>
                      <span className="font-semibold text-[#ff3b30]">
                        - Rs. {Math.round(eodData.expenses).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#86868b]">Cash Purchases:</span>
                      <span className="font-semibold text-[#ff3b30]">
                        - Rs. {Math.round(eodData.cashPurchases).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Profit & Net Drawer */}
                  <div className="bg-[#0071e3]/10 dark:bg-[#0071e3]/15 p-4 rounded-[18px] border border-[#0071e3]/20 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-[#1d1d1f] dark:text-gray-200">Gross Business Profit:</span>
                      <span className="font-bold text-sm text-[#34c759]">
                        Rs. {Math.round(eodData.profit).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-sm pt-2 border-t border-[#0071e3]/20 font-bold">
                      <span className="text-[#1d1d1f] dark:text-white">Net Cash in Drawer:</span>
                      <span className={`text-lg font-bold ${eodData.netCash >= 0 ? 'text-[#0071e3]' : 'text-[#ff3b30]'}`}>
                        Rs. {Math.round(eodData.netCash).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="pt-2 flex gap-2">
                    <button
                      onClick={printEOD}
                      className="flex-1 py-2.5 bg-[#0071e3] hover:bg-[#0077ed] text-white font-semibold text-xs rounded-full shadow-xs active:scale-[0.98] transition cursor-pointer"
                    >
                      🖨️ Thermal Print
                    </button>
                    <button
                      onClick={shareEODWhatsApp}
                      className="flex-1 py-2.5 bg-[#34c759] hover:bg-[#30d158] text-white font-semibold text-xs rounded-full shadow-xs active:scale-[0.98] transition cursor-pointer"
                    >
                      📱 WhatsApp
                    </button>
                    <button
                      onClick={() => setShowEOD(false)}
                      className="px-4 py-2.5 bg-[#f5f5f7] dark:bg-white/10 hover:bg-[#e5e5ea] text-[#1d1d1f] dark:text-white font-semibold text-xs rounded-full transition cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Dashboard
