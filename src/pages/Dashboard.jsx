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
  Users,
  Target,
  ArrowUpRight,
  Clock,
  RefreshCw,
  Moon,
  ShoppingBag,
  FileText,
  Banknote,
  ChevronRight,
  CheckCircle2,
  Sparkles
} from 'lucide-react'

// Apple HIG Widget Stat Card
const AppleWidget = ({ title, value, icon, color, bgTint, subValue, badge, onClick }) => (
  <div
    onClick={onClick}
    className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl p-5 rounded-[22px] border border-black/[0.05] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:-translate-y-0.5 transition-all duration-200 group flex flex-col justify-between"
  >
    <div>
      <div className="flex justify-between items-start mb-3">
        <div className={`w-10 h-10 rounded-[14px] flex items-center justify-center ${bgTint} ${color} transition-transform group-hover:scale-105 shadow-2xs`}>
          {icon}
        </div>
        {badge && (
          <span className="text-[10px] font-semibold tracking-wider px-2.5 py-0.5 rounded-full bg-[#f5f5f7] dark:bg-white/10 text-[#86868b] dark:text-gray-300 border border-black/[0.04] dark:border-white/[0.06]">
            {badge}
          </span>
        )}
      </div>
      <h3 className="text-[#86868b] text-[11px] font-semibold uppercase tracking-wider">{title}</h3>
      <p className="text-[22px] sm:text-[25px] font-bold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight mt-1">
        {typeof value === 'number' && title.toLowerCase().includes('rs')
          ? `Rs. ${Math.round(value).toLocaleString()}`
          : value}
      </p>
    </div>

    {subValue && (
      <div className="pt-2 mt-2 border-t border-black/[0.04] dark:border-white/[0.06] flex items-center justify-between text-[11px]">
        <span className="text-[#86868b] font-medium">{subValue}</span>
        <span className="text-gray-300 dark:text-gray-600 group-hover:text-[#0071e3] transition">→</span>
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
    todayProfit: 0,
    todayProfitMargin: 0,
    todayCashSales: 0,
    todayCreditSales: 0,
    todayOnlineSales: 0,
    todayItemsSold: 0,
    todayBulkSold: 0,
    todayBulkRevenue: 0,
    todayPhonesSold: 0,
    todayPhonesRevenue: 0,
    monthlySales: 0,
    totalReceivables: 0,
    debtorsCount: 0,
    lowStockCount: 0,
    productCount: 0,
    phonesInStock: 0,
    phonesValuation: 0,
    productsValuation: 0,
    productsStockTotal: 0,
    totalStockValuation: 0,
    planInfo: null,
    topDebtors: [],
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
        // 1. Today's sales with items
        supabase
          .from('sales')
          .select('id, total_amount, discount, payment_type, online_provider, created_at, customer_id, sale_items(product_name, cost_price, quantity, returned_qty, products(name)), customers(name)')
          .eq('shop_id', user.shop_id)
          .eq('sale_type', 'sale')
          .gte('created_at', todayISO),

        // 2. Monthly sales
        supabase
          .from('sales')
          .select('total_amount, discount, created_at')
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

        // 5. Customers
        supabase
          .from('customers')
          .select('id, name, phone, outstanding_balance')
          .eq('shop_id', user.shop_id),

        // 6. Products
        supabase
          .from('products')
          .select('id, name, stock_quantity, low_stock_threshold, cost_price, sale_price')
          .eq('shop_id', user.shop_id),

        // 7. Phones (Mobile Inventory)
        supabase
          .from('phones')
          .select('id, brand, model, storage, color, status, cost_price, sale_price')
          .eq('shop_id', user.shop_id),

        // 8. Shop config (with graceful fallback if RPC is missing)
        supabase
          .rpc('get_shop_config', { p_shop_id: user.shop_id })
          .then(r => (r?.error || !r?.data)
            ? supabase.from('shops').select('status, subscription_plan, subscription_fee, next_billing_date').eq('id', user.shop_id).maybeSingle()
            : r
          )
          .catch(() => ({ data: null }))
      ])

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 4500))
      const [todayRes, monthRes, weekRes, recentRes, custRes, prodRes, phonesRes, shopConfigRes] = await Promise.race([
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
      const custList = custRes.data || []
      const productList = prodRes.data || []
      const phonesList = phonesRes.data || []

      processDashboardData({
        todaySalesList,
        monthSalesList,
        weekSalesList,
        recentSalesList,
        custList,
        productList,
        phonesList,
        config
      })
    } catch (err) {
      console.warn('Dashboard: calculating from local DB...', err)
      try {
        const sidStr = String(user.shop_id)
        const [lSales, lCustomers, lProducts, lPhones, lItems] = await Promise.all([
          db.sales.toArray().catch(() => []),
          db.customers.toArray().catch(() => []),
          db.products.toArray().catch(() => []),
          db.phones ? db.phones.toArray().catch(() => []) : Promise.resolve([]),
          db.sale_items.toArray().catch(() => [])
        ])

        const mySales = lSales.filter(s => String(s.shop_id) === sidStr && s.sale_type === 'sale')
        const todaySalesList = mySales.filter(s => new Date(s.created_at) >= today).map(s => ({
          ...s,
          sale_items: lItems.filter(i => i.sale_id === s.id)
        }))
        const monthSalesList = mySales.filter(s => new Date(s.created_at) >= firstDayOfMonth)
        const weekSalesList = mySales.filter(s => new Date(s.created_at) >= sevenDaysAgo)
        const recentSalesList = [...mySales].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6)
        const custList = lCustomers.filter(c => String(c.shop_id) === sidStr)
        const productList = lProducts.filter(p => String(p.shop_id) === sidStr)
        const phonesList = (lPhones || []).filter(p => String(p.shop_id) === sidStr)
        const config = JSON.parse(localStorage.getItem('plan_limits') || '{}')

        processDashboardData({
          todaySalesList,
          monthSalesList,
          weekSalesList,
          recentSalesList,
          custList,
          productList,
          phonesList,
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
    custList,
    productList,
    phonesList,
    config
  }) => {
    // Lookups for accurate phone & product cost fallback
    const phoneCostMap = (phonesList || []).reduce((acc, p) => {
      acc[p.id] = Number(p.cost_price || 0)
      return acc
    }, {})
    const productCostMap = (productList || []).reduce((acc, p) => {
      if (p.id) acc[p.id] = Number(p.cost_price || 0)
      if (p.name) acc[p.name] = Number(p.cost_price || 0)
      return acc
    }, {})

    // 1. Today's Financials
    const todayTotal = todaySalesList.reduce((sum, s) => sum + (Number(s.total_amount || 0) - Number(s.discount || 0)), 0)

    let todayCOGS = 0
    let todayItemsSold = 0
    let todayBulkSold = 0
    let todayBulkRevenue = 0
    let todayPhonesSold = 0
    let todayPhonesRevenue = 0
    const todayProdMap = {}

    todaySalesList.forEach(s => {
      (s.sale_items || []).forEach(i => {
        const netQty = Math.max(0, Number(i.quantity || 1) - Number(i.returned_qty || 0))
        if (netQty > 0) {
          todayItemsSold += netQty
          const isPhone = Boolean(i.phone_id || i.imei_snapshot || i.item_type === 'phone')
          const itemRev = Number(i.unit_price || i.price || 0) * netQty

          const pName = String(i.product_name || i.products?.name || 'Item').trim()
          const unitCost = Number(
            (Number(i.cost_price) > 0 ? i.cost_price : null) ??
            (i.phone_id ? phoneCostMap[i.phone_id] : null) ??
            (i.product_id ? productCostMap[i.product_id] : null) ??
            (productCostMap[pName] || 0)
          )
          const cost = unitCost * netQty
          todayCOGS += cost

          if (isPhone) {
            todayPhonesSold += netQty
            todayPhonesRevenue += itemRev
          } else {
            todayBulkSold += netQty
            todayBulkRevenue += itemRev
          }

          if (!todayProdMap[pName]) {
            todayProdMap[pName] = { name: pName, qty: 0, revenue: 0, isPhone }
          }
          todayProdMap[pName].qty += netQty
          todayProdMap[pName].revenue += itemRev
        }
      })
    })

    const todayItemsRevenue = todayPhonesRevenue + todayBulkRevenue
    const todayTotalDiscount = todaySalesList.reduce((sum, s) => sum + Number(s.discount || 0), 0)
    const todayNetSales = todayItemsRevenue > 0 ? Math.max(0, todayItemsRevenue - todayTotalDiscount) : todayTotal
    const todayProfit = todayNetSales - todayCOGS
    const todayProfitMargin = todayNetSales > 0 ? (todayProfit / todayNetSales) * 100 : 0

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

    // 2. Month-to-date total
    const monthlyTotal = monthSalesList.reduce((sum, s) => sum + (Number(s.total_amount || 0) - Number(s.discount || 0)), 0)

    // 3. Customer Receivables
    const debtors = custList.filter(c => Number(c.outstanding_balance || 0) > 0)
    const totalReceivables = debtors.reduce((sum, c) => sum + Number(c.outstanding_balance || 0), 0)
    const topDebtors = [...debtors].sort((a, b) => Number(b.outstanding_balance) - Number(a.outstanding_balance)).slice(0, 5)

    // 4. Inventory Valuations & Low Stock
    const inStockPhones = phonesList.filter(p => p.status === 'in_stock')
    const phonesValuation = inStockPhones.reduce((sum, p) => sum + Number(p.cost_price || 0), 0)
    const productsValuation = productList.reduce((sum, p) => sum + (Number(p.cost_price || 0) * Math.max(0, Number(p.stock_quantity || 0))), 0)
    const productsStockTotal = productList.reduce((sum, p) => sum + Math.max(0, Number(p.stock_quantity || 0)), 0)
    const totalStockValuation = phonesValuation + productsValuation

    const lowStockList = productList
      .filter(p => Number(p.stock_quantity || 0) <= Number(p.low_stock_threshold || 5))
      .sort((a, b) => Number(a.stock_quantity) - Number(b.stock_quantity))

    // 5. 7-Day Trend Chart
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

    // 6. Top Selling Products Today
    const topProducts = Object.values(todayProdMap)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5)

    setStats({
      todaySales: todayTotal,
      todayProfit,
      todayProfitMargin,
      todayCashSales,
      todayCreditSales,
      todayOnlineSales,
      todayItemsSold,
      todayBulkSold,
      todayBulkRevenue,
      todayPhonesSold,
      todayPhonesRevenue,
      monthlySales: monthlyTotal,
      totalReceivables,
      debtorsCount: debtors.length,
      lowStockCount: lowStockList.length,
      productCount: productList.length,
      phonesInStock: inStockPhones.length,
      phonesValuation,
      productsValuation,
      productsStockTotal,
      totalStockValuation,
      planInfo: config,
      topDebtors,
      recentSales: recentSalesList,
      topSellingToday: topProducts,
      lowStockItems: lowStockList.slice(0, 4)
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

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 font-[-apple-system,BlinkMacSystemFont,'SF_Pro_Display','SF_Pro_Text','Plus_Jakarta_Sans',sans-serif]">
      {/*  Apple Native Title & Actions Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-1 pb-1">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#e5e5ea]/80 dark:bg-[#2c2c2e]/80 text-[#1d1d1f] dark:text-[#f5f5f7] border border-black/[0.04] dark:border-white/[0.08]">
              <span className="text-xs leading-none font-bold text-[#0071e3]"></span>
              <span>{shopName}</span>
            </span>
            <span className="text-xs text-[#86868b] font-medium">
              • {new Date().toLocaleDateString('en-PK', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
            Overview
          </h1>
          <p className="text-[#86868b] text-xs sm:text-sm mt-0.5 font-normal">
            Real-time store performance, product sales velocity, and inventory valuation.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={openEOD}
            className="px-3.5 py-2 bg-white dark:bg-[#1c1c1e] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] active:scale-[0.98] text-[#1d1d1f] dark:text-[#f5f5f7] text-xs font-semibold rounded-full border border-black/[0.08] dark:border-white/[0.1] shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Moon size={13} className="text-[#ff9500]" />
            <span>Close Day (EOD)</span>
          </button>

          <button
            onClick={fetchDashboardStats}
            disabled={loading}
            className="w-8.5 h-8.5 flex items-center justify-center bg-white dark:bg-[#1c1c1e] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] active:scale-95 border border-black/[0.08] dark:border-white/[0.1] rounded-full transition text-[#1d1d1f] dark:text-[#f5f5f7] cursor-pointer shadow-xs"
            title="Refresh Stats"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/*  Apple Control Center KPI Widgets */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 animate-pulse">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-32 bg-[#e5e5ea]/50 dark:bg-[#2c2c2e]/50 rounded-[22px]"></div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          <AppleWidget
            title="Today's Sales (Rs)"
            value={stats.todaySales}
            icon={<Banknote size={20} />}
            color="text-[#0071e3]"
            bgTint="bg-[#0071e3]/10"
            badge="Today"
            subValue={
              stats.todayItemsSold > 0
                ? `${stats.todayPhonesSold} phones • ${stats.todayBulkSold} accessories`
                : `Cash: Rs. ${Math.round(stats.todayCashSales).toLocaleString()}`
            }
            onClick={() => navigate('/sales')}
          />

          <AppleWidget
            title="Today's Profit (Rs)"
            value={stats.todayProfit}
            icon={<TrendingUp size={20} />}
            color="text-[#34c759]"
            bgTint="bg-[#34c759]/10"
            badge="Gross"
            subValue={`${stats.todayProfitMargin.toFixed(1)}% margin`}
            onClick={() => navigate('/reports')}
          />

          <AppleWidget
            title="Month Sales (Rs)"
            value={stats.monthlySales}
            icon={<CreditCard size={20} />}
            color="text-[#5856d6]"
            bgTint="bg-[#5856d6]/10"
            badge="MTD"
            subValue="Monthly velocity"
            onClick={() => navigate('/reports')}
          />

          <AppleWidget
            title="Receivables (Rs)"
            value={stats.totalReceivables}
            icon={<Users size={20} />}
            color="text-[#ff9500]"
            bgTint="bg-[#ff9500]/10"
            badge="Khata"
            subValue={`${stats.debtorsCount} pending accounts`}
            onClick={() => navigate('/customer-ledger')}
          />

          <AppleWidget
            title="Phones in Stock"
            value={`${stats.phonesInStock} Units`}
            icon={<Smartphone size={20} />}
            color="text-[#af52de]"
            bgTint="bg-[#af52de]/10"
            badge="Mobile"
            subValue={`Cost: Rs. ${Math.round(stats.phonesValuation).toLocaleString()}`}
            onClick={() => navigate('/products')}
          />

          <AppleWidget
            title="Low Stock Alerts"
            value={stats.lowStockCount}
            icon={<AlertTriangle size={20} />}
            color={stats.lowStockCount > 0 ? 'text-[#ff3b30]' : 'text-[#34c759]'}
            bgTint={stats.lowStockCount > 0 ? 'bg-[#ff3b30]/10' : 'bg-[#34c759]/10'}
            badge="Alert"
            subValue={stats.lowStockCount > 0 ? `${stats.lowStockCount} need reorder` : 'All healthy'}
            onClick={() => navigate('/products')}
          />
        </div>
      )}

      {/*  Middle Analytics Row: 7-Day Velocity Chart & Apple Activity Daily Goal */}
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
                <p className="text-[#86868b] text-xs mt-0.5">Rolling daily revenue performance</p>
              </div>

              <div className="text-left sm:text-right">
                <span className="text-[10px] font-semibold uppercase text-[#86868b] tracking-wider block">7-Day Total</span>
                <span className="text-lg font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">
                  Rs. {Math.round(weeklyTotal).toLocaleString()}
                </span>
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

          {/* iOS Payment Channels Inflow Row */}
          <div className="grid grid-cols-3 gap-2.5 pt-4 border-t border-black/[0.04] dark:border-white/[0.06] mt-3">
            <div className="p-3 rounded-[16px] bg-[#f5f5f7] dark:bg-white/[0.04] text-center border border-black/[0.02] dark:border-white/[0.04]">
              <span className="text-[10px] font-semibold text-[#86868b] uppercase tracking-wider block">Cash Inflow</span>
              <span className="text-xs sm:text-sm font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mt-0.5 block">
                Rs. {Math.round(stats.todayCashSales).toLocaleString()}
              </span>
            </div>

            <div className="p-3 rounded-[16px] bg-[#f5f5f7] dark:bg-white/[0.04] text-center border border-black/[0.02] dark:border-white/[0.04]">
              <span className="text-[10px] font-semibold text-[#86868b] uppercase tracking-wider block">Digital / Bank</span>
              <span className="text-xs sm:text-sm font-bold text-[#0071e3] mt-0.5 block">
                Rs. {Math.round(stats.todayOnlineSales).toLocaleString()}
              </span>
            </div>

            <div className="p-3 rounded-[16px] bg-[#f5f5f7] dark:bg-white/[0.04] text-center border border-black/[0.02] dark:border-white/[0.04]">
              <span className="text-[10px] font-semibold text-[#86868b] uppercase tracking-wider block">Credit (Khata)</span>
              <span className="text-xs sm:text-sm font-bold text-[#ff9500] mt-0.5 block">
                Rs. {Math.round(stats.todayCreditSales).toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/*  Apple Stock Valuation & Asset Wealth Card */}
        <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl p-5 sm:p-6 rounded-[24px] border border-black/[0.05] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3.5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-[10px] bg-[#0071e3]/10 text-[#0071e3] flex items-center justify-center">
                  <Smartphone size={16} />
                </div>
                <div>
                  <h3 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-[15px] leading-tight">Stock Valuation</h3>
                  <p className="text-[11px] text-[#86868b]">Inventory worth at cost basis</p>
                </div>
              </div>
              <button
                onClick={() => navigate('/inventory')}
                className="text-xs text-[#0071e3] font-semibold hover:underline cursor-pointer"
              >
                Stock View →
              </button>
            </div>

            <div className="p-3.5 rounded-[18px] bg-[#f5f5f7] dark:bg-white/[0.04] border border-black/[0.03] dark:border-white/[0.04] mb-3.5">
              <span className="text-[10px] font-semibold text-[#86868b] uppercase tracking-wider block">Total Inventory Assets</span>
              <span className="text-2xl font-bold tracking-tight text-[#1d1d1f] dark:text-white mt-0.5 block tabular-nums">
                Rs. {Math.round(stats.totalStockValuation).toLocaleString()}
              </span>
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
                  <span>Stock Health</span>
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
            <span>Manage Catalog & Products</span>
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/*  Bottom Row: Product Velocity & Transactions Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Top Moving Products Today */}
        <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl p-5 sm:p-6 rounded-[24px] border border-black/[0.05] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] text-[15px] flex items-center gap-1.5">
                  <Sparkles size={16} className="text-[#ff9500]" />
                  <span>Top Moving Products Today</span>
                </h3>
                <p className="text-[#86868b] text-xs">Fastest velocity items by Product Name</p>
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
                        <h4 className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] text-xs sm:text-sm">{p.name}</h4>
                        <span className="text-[11px] text-[#86868b]">{p.qty} units sold today</span>
                      </div>
                    </div>
                    <span className="font-bold text-xs sm:text-sm text-[#1d1d1f] dark:text-white">
                      Rs. {Math.round(p.revenue).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-9 text-center text-[#86868b] text-xs italic bg-[#f5f5f7] dark:bg-white/[0.03] rounded-[18px]">
                No product sales recorded yet today. Completed orders will appear here.
              </div>
            )}
          </div>

          {/* Urgent Low Stock Alerts */}
          {stats.lowStockItems.length > 0 && (
            <div className="mt-5 pt-4 border-t border-black/[0.04] dark:border-white/[0.06]">
              <div className="flex justify-between items-center mb-2.5">
                <span className="text-xs font-semibold text-[#ff3b30] flex items-center gap-1">
                  <AlertTriangle size={13} /> Low Stock Warnings
                </span>
                <Link to="/products" className="text-[11px] text-[#0071e3] font-medium hover:underline">
                  Manage Catalog →
                </Link>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {stats.lowStockItems.map(item => (
                  <div
                    key={item.id}
                    className="p-2.5 rounded-[14px] bg-[#ff3b30]/5 border border-[#ff3b30]/15 flex justify-between items-center text-xs"
                  >
                    <span className="font-medium text-[#1d1d1f] dark:text-gray-200 truncate max-w-[120px]" title={item.name}>
                      {item.name}
                    </span>
                    <span className="font-bold text-[#ff3b30] px-2 py-0.5 rounded-full bg-white dark:bg-[#1c1c1e] text-[11px] shadow-2xs">
                      {item.stock_quantity} left
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Live Recent Transactions Feed */}
        <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl p-5 sm:p-6 rounded-[24px] border border-black/[0.05] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] text-[15px] flex items-center gap-1.5">
                  <Clock size={16} className="text-[#0071e3]" />
                  <span>Recent Sales Activity</span>
                </h3>
                <p className="text-[#86868b] text-xs">Live checkout transactions</p>
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
                        <div className="w-8 h-8 rounded-full bg-[#f5f5f7] dark:bg-white/10 text-[#0071e3] font-bold text-xs flex items-center justify-center">
                          #{s.id}
                        </div>
                        <div>
                          <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] text-xs block">{custName}</span>
                          <span className="text-[11px] text-[#86868b]">{timeStr}</span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="font-bold text-xs sm:text-sm text-[#1d1d1f] dark:text-[#f5f5f7] block">
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

          {/* Top Outstanding Customers (Debtors) */}
          {stats.topDebtors.length > 0 && (
            <div className="mt-5 pt-4 border-t border-black/[0.04] dark:border-white/[0.06]">
              <div className="flex justify-between items-center mb-2.5">
                <span className="text-xs font-semibold text-[#ff9500] flex items-center gap-1">
                  <Users size={13} /> Customer Ledger Balances
                </span>
                <Link to="/customer-ledger" className="text-[11px] text-[#0071e3] font-medium hover:underline">
                  Full Ledger →
                </Link>
              </div>

              <div className="space-y-1.5">
                {stats.topDebtors.slice(0, 3).map(c => (
                  <Link
                    key={c.id}
                    to={`/customers/${c.id}`}
                    className="flex justify-between items-center px-2 py-1.5 rounded-[12px] hover:bg-[#f5f5f7] dark:hover:bg-white/[0.03] text-xs transition"
                  >
                    <span className="font-medium text-[#1d1d1f] dark:text-gray-300">{c.name}</span>
                    <span className="font-bold text-[#ff3b30]">
                      Rs. {Math.round(Number(c.outstanding_balance)).toLocaleString()}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
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
            to="/customers"
            className="flex flex-col items-center justify-center p-4 bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl border border-black/[0.05] dark:border-white/[0.08] rounded-[22px] hover:shadow-[0_8px_20px_rgba(0,0,0,0.06)] active:scale-95 transition-all text-center group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-[16px] bg-gradient-to-tr from-[#ea580c] to-[#fb923c] text-white flex items-center justify-center shadow-[0_4px_12px_rgba(234,88,12,0.3)] transition-transform group-hover:scale-105 mb-2">
              <Users size={22} />
            </div>
            <span className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Customers</span>
            <span className="text-[10px] text-[#86868b]">Ledger & Khata</span>
          </Link>

          <Link
            to="/reports"
            className="flex flex-col items-center justify-center p-4 bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl border border-black/[0.05] dark:border-white/[0.08] rounded-[22px] hover:shadow-[0_8px_20px_rgba(0,0,0,0.06)] active:scale-95 transition-all text-center group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-[16px] bg-gradient-to-tr from-[#4f46e5] to-[#818cf8] text-white flex items-center justify-center shadow-[0_4px_12px_rgba(79,70,229,0.3)] transition-transform group-hover:scale-105 mb-2">
              <FileText size={22} />
            </div>
            <span className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Reports & P&L</span>
            <span className="text-[10px] text-[#86868b]">Sales Analysis</span>
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