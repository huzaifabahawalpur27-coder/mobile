import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, BarChart, Bar
} from 'recharts'
import * as XLSX from 'xlsx'
import { db } from '../services/db'
import { hasFeature } from '../utils/featureGate'
import UpgradeWall from '../components/UpgradeWall'
import { printHTML, getShopBranding, brandedA4Header } from '../utils/printUtils'
import {
  DollarSign, Package, TrendingUp, BarChart3, PieChart as PieIcon,
  Search, Download, Printer, Award, Zap,
  Calendar, RefreshCw, X, ShoppingBag, Layers, Smartphone,
  CheckCircle2, AlertTriangle, AlertCircle, ArrowUpRight
} from 'lucide-react'

function Reports() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('today') // today, week, month, year, custom, all
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [activeTab, setActiveTab] = useState('products') // 'products', 'flow', 'overview', 'financials'
  const [catalogSegment, setCatalogSegment] = useState('all') // 'all', 'products', 'phones'

  // Product table filters & sorting
  const [productSearch, setProductSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [stockFilter, setStockFilter] = useState('all') // 'all', 'in_stock', 'low_stock', 'out_of_stock'
  const [sortBy, setSortBy] = useState('revenue') // 'revenue', 'qty', 'profit', 'margin', 'slow_moving'

  const [stats, setStats] = useState({
    grossSales: 0,
    costOfSales: 0,
    grossProfit: 0,
    expenses: 0,
    netProfit: 0,
    totalDiscount: 0,
    purchases: 0,
    totalUnitsSold: 0
  })

  const [flowStats, setFlowStats] = useState({
    bulkPurchasedUnits: 0,
    bulkPurchasedCost: 0,
    bulkPurchasedCash: 0,
    bulkPurchasedBank: 0,
    bulkPurchasedCredit: 0,
    bulkSoldUnits: 0,
    bulkSoldRevenue: 0,
    bulkSoldCost: 0,
    bulkSoldProfit: 0,
    bulkSoldMargin: 0,
    bulkStockUnits: 0,
    bulkStockValue: 0,
    phonePurchasedUnits: 0,
    phonePurchasedCost: 0,
    phonePurchasedCash: 0,
    phonePurchasedBank: 0,
    phonePurchasedCredit: 0,
    phoneSoldUnits: 0,
    phoneSoldRevenue: 0,
    phoneSoldCost: 0,
    phoneSoldProfit: 0,
    phoneSoldMargin: 0,
    phoneStockUnits: 0,
    phoneStockValue: 0,
    totalStockValuation: 0
  })

  const [productList, setProductList] = useState([])
  const [expenseBreakdown, setExpenseBreakdown] = useState([])
  const [salesTrend, setSalesTrend] = useState([])
  const [categoryData, setCategoryData] = useState([])
  const [categories, setCategories] = useState([])

  useEffect(() => {
    if (user?.shop_id) {
      fetchReportData()
    }
  }, [range, customStartDate, customEndDate, user?.shop_id])

  const fetchReportData = async () => {
    setLoading(true)

    let startDate = new Date()
    startDate.setHours(0, 0, 0, 0)
    let endDate = new Date()
    endDate.setHours(23, 59, 59, 999)

    if (range === 'today') {
      startDate.setHours(0, 0, 0, 0)
    } else if (range === 'week') {
      startDate.setDate(startDate.getDate() - 7)
    } else if (range === 'month') {
      startDate.setDate(1) // First of current month
    } else if (range === 'year') {
      startDate = new Date(new Date().getFullYear(), 0, 1) // First of current year
    } else if (range === 'custom') {
      if (customStartDate) {
        startDate = new Date(customStartDate)
        startDate.setHours(0, 0, 0, 0)
      }
      if (customEndDate) {
        endDate = new Date(customEndDate)
        endDate.setHours(23, 59, 59, 999)
      }
    } else if (range === 'all') {
      startDate = new Date(2000, 0, 1)
    }

    const startISO = startDate.toISOString()
    const endISO = endDate.toISOString()
    const sid = String(user.shop_id)

    try {
      if (!navigator.onLine) throw new Error('Offline')

      // Parallel fetching from Supabase
      const fetchPromise = Promise.all([
        supabase.from('sales').select('*').eq('shop_id', user.shop_id).eq('sale_type', 'sale').gte('created_at', startISO).lte('created_at', endISO),
        supabase.from('sale_items').select('*, products(name, category_id, categories(name)), sales!inner(created_at, sale_type, shop_id)').eq('sales.shop_id', user.shop_id).eq('sales.sale_type', 'sale').gte('sales.created_at', startISO).lte('sales.created_at', endISO),
        supabase.from('expenses').select('*').eq('shop_id', user.shop_id).gte('created_at', startISO).lte('created_at', endISO),
        supabase.from('purchases').select('*, purchase_items(*)').eq('shop_id', user.shop_id).gte('created_at', startISO).lte('created_at', endISO),
        supabase.from('products').select('id, name, stock_quantity, cost_price, sale_price, category_id, categories(name)').eq('shop_id', user.shop_id),
        supabase.from('categories').select('*').eq('shop_id', user.shop_id),
        supabase.from('phones').select('id, brand, model, storage, color, status, cost_price, sale_price').eq('shop_id', user.shop_id)
      ])

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
      const [salesRes, itemsRes, expensesRes, purchasesRes, productsRes, catsRes, phonesRes] = await Promise.race([fetchPromise, timeoutPromise])

      const sales = salesRes.data || []
      const items = itemsRes.data || []
      const expenses = expensesRes.data || []
      const purchases = purchasesRes.data || []
      const liveProducts = productsRes.data || []
      const catList = catsRes.data || []
      const phones = phonesRes.data || []
      setCategories(catList)

      // Cache for offline use
      if (salesRes.data) await db.sales.bulkPut(JSON.parse(JSON.stringify(salesRes.data))).catch(() => {})
      if (itemsRes.data) await db.sale_items.bulkPut(JSON.parse(JSON.stringify(itemsRes.data))).catch(() => {})
      if (expensesRes.data) await db.expenses.bulkPut(JSON.parse(JSON.stringify(expensesRes.data))).catch(() => {})
      if (purchasesRes.data) await db.purchases.bulkPut(JSON.parse(JSON.stringify(purchasesRes.data))).catch(() => {})
      if (phonesRes.data && db.phones) await db.phones.bulkPut(JSON.parse(JSON.stringify(phonesRes.data))).catch(() => {})

      processData({ sales, items, expenses, purchases, liveProducts, catList, phones })
    } catch (e) {
      console.warn('Reports: calculating from local DB...', e)
      try {
        const [lSales, lItems, lExpenses, lPurchases, lPurchaseItems, lProducts, lCats, lPhones] = await Promise.all([
          db.sales.toArray(),
          db.sale_items.toArray(),
          db.expenses.toArray(),
          db.purchases.toArray(),
          db.purchase_items ? db.purchase_items.toArray().catch(() => []) : Promise.resolve([]),
          db.products.toArray(),
          db.categories.toArray(),
          db.phones ? db.phones.toArray().catch(() => []) : Promise.resolve([])
        ])

        const sales = lSales.filter(x => {
          if (String(x.shop_id) !== sid || x.sale_type !== 'sale') return false
          const t = new Date(x.created_at)
          return t >= startDate && t <= endDate
        })
        const saleIds = new Set(sales.map(s => s.id))
        const items = lItems.filter(i => saleIds.has(i.sale_id))
        const expenses = lExpenses.filter(x => {
          if (String(x.shop_id) !== sid) return false
          const t = new Date(x.created_at)
          return t >= startDate && t <= endDate
        })
        const purchasesRaw = lPurchases.filter(x => {
          if (String(x.shop_id) !== sid) return false
          const t = new Date(x.created_at)
          return t >= startDate && t <= endDate
        })
        const pItemsByPId = (lPurchaseItems || []).reduce((acc, pi) => {
          if (!acc[pi.purchase_id]) acc[pi.purchase_id] = []
          acc[pi.purchase_id].push(pi)
          return acc
        }, {})
        const purchases = purchasesRaw.map(p => ({
          ...p,
          purchase_items: p.purchase_items || pItemsByPId[p.id] || []
        }))
        const liveProducts = lProducts.filter(x => String(x.shop_id) === sid)
        const catList = lCats.filter(x => String(x.shop_id) === sid)
        const phones = (lPhones || []).filter(x => String(x.shop_id) === sid)
        setCategories(catList)

        processData({ sales, items, expenses, purchases, liveProducts, catList, phones })
      } catch (err) {
        console.error('Final Reports Fallback Error:', err)
      } finally {
        setLoading(false)
      }
    } finally {
      setLoading(false)
    }
  }

  const processData = ({ sales, items, expenses, purchases, liveProducts, catList, phones }) => {
    // 1. Overall Financials
    const grossSales = sales.reduce((sum, s) => sum + Number(s.total_amount || s.net_amount || 0), 0)
    const totalDiscount = sales.reduce((sum, s) => sum + Number(s.discount || 0), 0)
    const netSalesValue = grossSales - totalDiscount

    const costOfSales = items.reduce((sum, i) => {
      const qty = Number(i.quantity || i.qty || 1) - Number(i.returned_qty || 0)
      return sum + (Number(i.cost_price || 0) * qty)
    }, 0)

    const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0)
    const totalPurchases = purchases.reduce((sum, p) => sum + Number(p.total_amount || 0), 0)
    const grossProfit = netSalesValue - costOfSales
    const netProfit = grossProfit - totalExpenses

    let totalUnitsSold = 0

    // 2. Build Lookups for Product Names and Inventory Stock
    const phoneMap = (phones || []).reduce((acc, p) => {
      const pName = `${p.brand || ''} ${p.model || ''}${p.storage ? ` ${p.storage}` : ''}`.trim()
      acc[p.id] = {
        name: pName || 'Mobile Phone',
        cost: Number(p.cost_price || 0),
        price: Number(p.sale_price || 0)
      }
      return acc
    }, {})

    const catNameById = (catList || []).reduce((acc, c) => {
      acc[String(c.id)] = c.name
      return acc
    }, {})

    // Stock quantities grouped strictly by Product Name
    const stockMap = (liveProducts || []).reduce((acc, p) => {
      acc[p.name] = (acc[p.name] || 0) + Number(p.stock_quantity || 0)
      return acc
    }, {})

    const productCostMap = (liveProducts || []).reduce((acc, p) => {
      acc[p.name] = Number(p.cost_price || 0)
      return acc
    }, {})

    // Group in-stock phones by Product Name (e.g. "iPhone 13 128GB" -> 4 in stock)
    ;(phones || []).filter(p => p.status === 'in_stock').forEach(p => {
      const pName = `${p.brand || ''} ${p.model || ''}${p.storage ? ` ${p.storage}` : ''}`.trim() || 'Mobile Phone'
      stockMap[pName] = (stockMap[pName] || 0) + 1
    })

    // 3. INWARD FLOW (PURCHASES) BREAKDOWN
    let bulkPurchasedUnits = 0
    let bulkPurchasedCost = 0
    let bulkPurchasedCash = 0
    let bulkPurchasedBank = 0
    let bulkPurchasedCredit = 0

    let phonePurchasedUnits = 0
    let phonePurchasedCost = 0
    let phonePurchasedCash = 0
    let phonePurchasedBank = 0
    let phonePurchasedCredit = 0

    const inwardByProductName = {}

    purchases.forEach(p => {
      const isBulkPurchase = Boolean(
        (p.purchase_items && p.purchase_items.length > 0) ||
        (p.item_type && p.item_type !== 'phone')
      )
      const payType = String(p.payment_type || 'cash').toLowerCase()
      const pAmount = Number(p.total_amount || 0)

      if (isBulkPurchase) {
        let pUnits = 0
        if (p.purchase_items && p.purchase_items.length > 0) {
          p.purchase_items.forEach(pi => {
            const piQty = Number(pi.quantity || 1)
            pUnits += piQty
            const piName = String(pi.product_name || pi.products?.name || '').trim()
            if (piName) {
              inwardByProductName[piName] = (inwardByProductName[piName] || 0) + piQty
            }
          })
        } else {
          pUnits = Number(p.total_items || 1)
        }

        bulkPurchasedUnits += pUnits
        bulkPurchasedCost += pAmount
        if (payType === 'cash') bulkPurchasedCash += pAmount
        else if (['bank', 'online'].includes(payType)) bulkPurchasedBank += pAmount
        else bulkPurchasedCredit += pAmount
      } else {
        // Phone purchase
        phonePurchasedUnits += 1
        phonePurchasedCost += pAmount
        if (payType === 'cash') phonePurchasedCash += pAmount
        else if (['bank', 'online'].includes(payType)) phonePurchasedBank += pAmount
        else phonePurchasedCredit += pAmount
      }
    })

    // 4. OUTWARD FLOW (SALES) & PRODUCT AGGREGATION
    let bulkSoldUnits = 0
    let bulkSoldRevenue = 0
    let bulkSoldCost = 0
    let bulkSoldProfit = 0

    let phoneSoldUnits = 0
    let phoneSoldRevenue = 0
    let phoneSoldCost = 0
    let phoneSoldProfit = 0

    const prodMap = {}

    items.forEach(i => {
      const qty = Number(i.quantity || i.qty || 1) - Number(i.returned_qty || 0)
      if (qty <= 0) return
      totalUnitsSold += qty

      // Parse imei_snapshot if present to extract product model
      let snap = null
      if (i.imei_snapshot) {
        if (typeof i.imei_snapshot === 'object') {
          snap = i.imei_snapshot
        } else if (typeof i.imei_snapshot === 'string') {
          try { snap = JSON.parse(i.imei_snapshot) } catch (_) { /* invalid json ignored */ }
        }
      }

      // Determine product name cleanly without exposing IMEI
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
      const unitPrice = Number(i.unit_price ?? i.price ?? (i.phone_id ? phoneMap[i.phone_id]?.price : 0) ?? 0)
      const costPrice = Number(i.cost_price ?? (i.phone_id ? phoneMap[i.phone_id]?.cost : productCostMap[name] || 0) ?? 0)
      const lineRev = Number(i.line_total ?? i.subtotal ?? (qty * unitPrice))
      const lineCost = qty * costPrice
      const lineProfit = lineRev - lineCost
      const categoryName = i.products?.categories?.name ||
        catNameById[String(i.products?.category_id)] ||
        (isPhone ? 'Mobile Phones' : 'General')

      if (isPhone) {
        phoneSoldUnits += qty
        phoneSoldRevenue += lineRev
        phoneSoldCost += lineCost
        phoneSoldProfit += lineProfit
      } else {
        bulkSoldUnits += qty
        bulkSoldRevenue += lineRev
        bulkSoldCost += lineCost
        bulkSoldProfit += lineProfit
      }

      if (!prodMap[name]) {
        prodMap[name] = {
          name,
          category: categoryName,
          item_type: isPhone ? 'phone' : 'product',
          qty: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
          stock: stockMap[name] ?? 0,
          inwardQty: inwardByProductName[name] || 0,
          unitCost: costPrice
        }
      }

      prodMap[name].qty += qty
      prodMap[name].revenue += lineRev
      prodMap[name].cost += lineCost
      prodMap[name].profit += lineProfit
      if (categoryName !== 'General') prodMap[name].category = categoryName
    })

    // Also include live products that didn't sell this period so stock & inventory velocity show all items
    ;(liveProducts || []).forEach(p => {
      const pName = p.name?.trim()
      if (pName && !prodMap[pName]) {
        const catName = p.categories?.name || catNameById[String(p.category_id)] || 'General'
        const isPhone = catName === 'Mobile Phones'
        prodMap[pName] = {
          name: pName,
          category: catName,
          item_type: isPhone ? 'phone' : 'product',
          qty: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
          stock: Number(p.stock_quantity || 0),
          inwardQty: inwardByProductName[pName] || 0,
          unitCost: Number(p.cost_price || 0)
        }
      }
    })

    const compiledProducts = Object.values(prodMap).map(p => {
      const margin = p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0
      const avgPrice = p.qty > 0 ? p.revenue / p.qty : 0
      const avgCost = p.qty > 0 ? p.cost / p.qty : p.unitCost
      const netMovement = Number(p.inwardQty || 0) - Number(p.qty || 0)
      return {
        ...p,
        margin,
        avgPrice,
        avgCost,
        netMovement
      }
    })

    // 5. Stock Valuations
    const bulkStockUnits = (liveProducts || []).reduce((sum, p) => sum + Math.max(0, Number(p.stock_quantity || 0)), 0)
    const bulkStockValue = (liveProducts || []).reduce((sum, p) => sum + (Number(p.cost_price || 0) * Math.max(0, Number(p.stock_quantity || 0))), 0)
    const inStockPhones = (phones || []).filter(p => p.status === 'in_stock')
    const phoneStockUnits = inStockPhones.length
    const phoneStockValue = inStockPhones.reduce((sum, p) => sum + Number(p.cost_price || 0), 0)
    const totalStockValuation = bulkStockValue + phoneStockValue

    const bulkSoldMargin = bulkSoldRevenue > 0 ? (bulkSoldProfit / bulkSoldRevenue) * 100 : 0
    const phoneSoldMargin = phoneSoldRevenue > 0 ? (phoneSoldProfit / phoneSoldRevenue) * 100 : 0

    setFlowStats({
      bulkPurchasedUnits,
      bulkPurchasedCost,
      bulkPurchasedCash,
      bulkPurchasedBank,
      bulkPurchasedCredit,
      bulkSoldUnits,
      bulkSoldRevenue,
      bulkSoldCost,
      bulkSoldProfit,
      bulkSoldMargin,
      bulkStockUnits,
      bulkStockValue,
      phonePurchasedUnits,
      phonePurchasedCost,
      phonePurchasedCash,
      phonePurchasedBank,
      phonePurchasedCredit,
      phoneSoldUnits,
      phoneSoldRevenue,
      phoneSoldCost,
      phoneSoldProfit,
      phoneSoldMargin,
      phoneStockUnits,
      phoneStockValue,
      totalStockValuation
    })

    setProductList(compiledProducts)

    setStats({
      grossSales,
      costOfSales,
      grossProfit,
      expenses: totalExpenses,
      netProfit,
      totalDiscount,
      purchases: totalPurchases,
      totalUnitsSold
    })

    // 6. Expense Breakdown
    const expMap = {}
    expenses.forEach(e => {
      const cat = e.category || 'Other'
      expMap[cat] = (expMap[cat] || 0) + Number(e.amount || 0)
    })
    setExpenseBreakdown(Object.entries(expMap).map(([cat, val]) => ({ cat, val })).sort((a, b) => b.val - a.val))

    // 7. Sales Trend
    const trendMap = {}
    sales.forEach(s => {
      const date = new Date(s.created_at).toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })
      trendMap[date] = (trendMap[date] || 0) + Number(s.total_amount || 0)
    })
    setSalesTrend(Object.entries(trendMap).map(([date, amount]) => ({ date, amount })))

    // 8. Category Profit Distribution
    const catMap = {}
    compiledProducts.forEach(p => {
      catMap[p.category] = (catMap[p.category] || 0) + Math.max(0, p.profit)
    })
    setCategoryData(Object.entries(catMap).map(([name, value]) => ({ name, value })).filter(c => c.value > 0))
  }

  // Filtered & Sorted Product List
  const filteredProducts = useMemo(() => {
    return productList
      .filter(p => {
        if (catalogSegment === 'products' && p.item_type !== 'product') return false
        if (catalogSegment === 'phones' && p.item_type !== 'phone') return false

        const matchSearch = productSearch.trim()
          ? p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.category.toLowerCase().includes(productSearch.toLowerCase())
          : true
        const matchCat = selectedCategory !== 'all' ? p.category === selectedCategory : true

        let matchStock = true
        if (stockFilter === 'in_stock') matchStock = Number(p.stock) > 0
        else if (stockFilter === 'low_stock') matchStock = Number(p.stock) > 0 && Number(p.stock) <= 3
        else if (stockFilter === 'out_of_stock') matchStock = Number(p.stock) <= 0

        return matchSearch && matchCat && matchStock
      })
      .sort((a, b) => {
        if (sortBy === 'qty') return b.qty - a.qty
        if (sortBy === 'profit') return b.profit - a.profit
        if (sortBy === 'margin') return b.margin - a.margin
        if (sortBy === 'slow_moving') return a.qty - b.qty
        if (sortBy === 'inward') return (b.inwardQty || 0) - (a.inwardQty || 0)
        return b.revenue - a.revenue // default: highest revenue
      })
  }, [productList, productSearch, selectedCategory, stockFilter, sortBy, catalogSegment])

  // Top Product Highlights
  const topRevenueProduct = useMemo(() => {
    if (productList.length === 0) return null
    return [...productList].sort((a, b) => b.revenue - a.revenue)[0]
  }, [productList])

  const topUnitsProduct = useMemo(() => {
    if (productList.length === 0) return null
    return [...productList].sort((a, b) => b.qty - a.qty)[0]
  }, [productList])

  const topProfitProduct = useMemo(() => {
    if (productList.length === 0) return null
    return [...productList].sort((a, b) => b.profit - a.profit)[0]
  }, [productList])

  // Export Product Sales Report to Excel
  const handleExportProductReport = () => {
    const dataToExport = filteredProducts.map((p, idx) => ({
      'Rank': idx + 1,
      'Product Name': p.name,
      'Type': p.item_type === 'phone' ? 'Mobile Phone' : 'Bulk Product / Accessory',
      'Category': p.category,
      'Inward (Purchased)': p.inwardQty || 0,
      'Outward (Sold)': p.qty,
      'Net Movement': p.netMovement ?? ((p.inwardQty || 0) - p.qty),
      'Avg Selling Price (Rs.)': Math.round(p.avgPrice),
      'Avg Cost (Rs.)': Math.round(p.avgCost),
      'Total Revenue (Rs.)': Math.round(p.revenue),
      'Cost of Goods (Rs.)': Math.round(p.cost),
      'Gross Profit (Rs.)': Math.round(p.profit),
      'Margin (%)': `${p.margin.toFixed(1)}%`,
      'In-Stock Qty': p.stock,
    }))

    const ws = XLSX.utils.json_to_sheet(dataToExport)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Product Sales Report')
    XLSX.writeFile(wb, `Product_Sales_Report_${range.toUpperCase()}_${new Date().toLocaleDateString()}.xlsx`)
  }

  // Printable Executive Summary
  const handlePrintSummary = () => {
    const branding = getShopBranding(user?.shop_id)
    const header = brandedA4Header(branding, 'Product Performance & Business Report', `Period: ${range.toUpperCase()}`)
    const topRows = filteredProducts.slice(0, 30).map((p, idx) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;font-weight:bold;">${idx + 1}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;font-weight:600;">${p.name}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#666;">${p.category}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;font-weight:bold;">${p.qty}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">Rs. ${Math.round(p.avgPrice).toLocaleString()}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">Rs. ${Math.round(p.revenue).toLocaleString()}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">Rs. ${Math.round(p.profit).toLocaleString()}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;color:${p.margin >= 20 ? '#059669' : '#d97706'}">${p.margin.toFixed(1)}%</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${p.stock}</td>
      </tr>
    `).join('')

    printHTML(`
      <html><head><title>Product Report - ${range.toUpperCase()}</title>
      <style>
        @page{size:A4 portrait;margin:12mm}
        *{box-sizing:border-box;print-color-adjust:exact;-webkit-print-color-adjust:exact}
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1e293b; padding: 0; line-height: 1.5; }
        .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
        .stat-item { border: 1px solid #e2e8f0; background: #f8fafc; padding: 10px; border-radius: 8px; }
        .stat-label { color: #64748b; font-size: 10px; font-weight: bold; text-transform: uppercase; }
        .stat-value { font-size: 16px; font-weight: 800; color: #0f172a; margin-top: 3px; }
        .total-box { background: #f1f5f9; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #cbd5e1; }
        .total-row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 12px; }
        .final-profit { border-top: 2px solid #0f172a; padding-top: 8px; margin-top: 8px; font-size: 16px; font-weight: 800; display: flex; justify-content: space-between; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
        th { background: #1e293b; color: #fff; padding: 7px 8px; text-align: left; font-size: 10px; text-transform: uppercase; }
        th:not(:first-child):not(:nth-child(2)):not(:nth-child(3)) { text-align: right; }
        th:nth-child(4), th:nth-child(9) { text-align: center; }
      </style></head><body>
      ${header}

      <div class="stat-grid">
        <div class="stat-item"><div class="stat-label">Gross Revenue</div><div class="stat-value">Rs. ${stats.grossSales.toLocaleString()}</div></div>
        <div class="stat-item"><div class="stat-label">Total Units Sold</div><div class="stat-value">${stats.totalUnitsSold} items</div></div>
        <div class="stat-item"><div class="stat-label">Cost of Goods (COGS)</div><div class="stat-value">Rs. ${stats.costOfSales.toLocaleString()}</div></div>
        <div class="stat-item"><div class="stat-label">Net Profit</div><div class="stat-value" style="color:#2563eb">Rs. ${stats.netProfit.toLocaleString()}</div></div>
      </div>

      <div class="total-box">
        <div class="total-row"><span>Gross Sales:</span><span>Rs. ${stats.grossSales.toLocaleString()}</span></div>
        <div class="total-row"><span>Discounts:</span><span>-Rs. ${stats.totalDiscount.toLocaleString()}</span></div>
        <div class="total-row"><span>Cost of Sold Goods:</span><span>-Rs. ${stats.costOfSales.toLocaleString()}</span></div>
        <div class="total-row"><span>Gross Business Profit:</span><span style="font-weight:bold;color:#059669;">Rs. ${stats.grossProfit.toLocaleString()}</span></div>
        <div class="total-row"><span>Operating Expenses:</span><span>-Rs. ${stats.expenses.toLocaleString()}</span></div>
        <div class="final-profit"><span>Net Business Profit:</span><span>Rs. ${stats.netProfit.toLocaleString()}</span></div>
      </div>

      <h3 style="font-size:13px;font-weight:bold;margin:15px 0 6px 0;">Product Sales & Profit Breakdown</h3>
      <table>
        <thead>
          <tr>
            <th style="width:30px;">#</th>
            <th>Product Name</th>
            <th>Category</th>
            <th style="text-align:center;">Qty</th>
            <th style="text-align:right;">Avg Price</th>
            <th style="text-align:right;">Revenue</th>
            <th style="text-align:right;">Profit</th>
            <th style="text-align:right;">Margin %</th>
            <th style="text-align:center;">Stock</th>
          </tr>
        </thead>
        <tbody>
          ${topRows}
        </tbody>
      </table>
      </body></html>
    `)
  }

  if (!hasFeature('reports')) return <UpgradeWall feature="reports" />

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 font-[-apple-system,BlinkMacSystemFont,'SF_Pro_Display','SF_Pro_Text','Plus_Jakarta_Sans',sans-serif]">
      {/*  Apple Native Title & Range Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pt-1 pb-1">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#e5e5ea]/80 dark:bg-[#2c2c2e]/80 text-[#1d1d1f] dark:text-[#f5f5f7] border border-black/[0.04] dark:border-white/[0.08]">
              <span className="text-xs leading-none font-bold text-[#0071e3]"></span>
              <span>Reports & Analytics</span>
            </span>
            <span className="text-xs text-[#86868b] font-medium">
              • {filteredProducts.length} Products Analyzed
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
            Business Intelligence
          </h1>
          <p className="text-[#86868b] text-xs sm:text-sm mt-0.5 font-normal">
            Product sales volume, gross margins, inventory turnover, and financial performance.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* iOS Segmented Control for Time Range */}
          <div className="bg-[#e5e5ea]/80 dark:bg-[#2c2c2e]/80 p-1 rounded-full flex items-center backdrop-blur-md border border-black/[0.04] dark:border-white/[0.06] shadow-xs">
            {[
              { id: 'today', label: 'Today' },
              { id: 'week', label: '7 Days' },
              { id: 'month', label: 'Month' },
              { id: 'year', label: 'Year' },
              { id: 'custom', label: 'Custom' },
              { id: 'all', label: 'All' }
            ].map(r => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                  range === r.id
                    ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-xs'
                    : 'text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Action Pills */}
          <button
            onClick={handleExportProductReport}
            className="px-3.5 py-2 bg-white dark:bg-[#1c1c1e] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] active:scale-[0.98] text-[#1d1d1f] dark:text-[#f5f5f7] text-xs font-semibold rounded-full border border-black/[0.08] dark:border-white/[0.1] shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
            title="Download Product Sales Analysis in Excel (.xlsx)"
          >
            <Download size={13} className="text-[#34c759]" />
            <span>Excel</span>
          </button>

          <button
            onClick={handlePrintSummary}
            className="px-3.5 py-2 bg-[#0071e3] hover:bg-[#0077ed] active:scale-[0.98] text-white text-xs font-semibold rounded-full shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
            title="Print Executive A4 / Thermal Summary"
          >
            <Printer size={13} />
            <span>Print Report</span>
          </button>
        </div>
      </div>

      {/* Custom Date Range Pill Selector */}
      {range === 'custom' && (
        <div className="bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur-xl border border-black/[0.05] dark:border-white/[0.08] p-3.5 rounded-[20px] shadow-xs flex flex-wrap items-center gap-3 text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
          <div className="flex items-center gap-1.5 text-[#0071e3] font-semibold">
            <Calendar size={14} />
            <span>Custom Date Interval:</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#86868b] text-[11px] font-medium">From:</span>
            <input
              type="date"
              className="px-2.5 py-1 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-black/[0.06] dark:border-white/[0.08] rounded-full text-xs font-semibold outline-none focus:border-[#0071e3] text-[#1d1d1f] dark:text-[#f5f5f7]"
              value={customStartDate}
              onChange={e => setCustomStartDate(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#86868b] text-[11px] font-medium">To:</span>
            <input
              type="date"
              className="px-2.5 py-1 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-black/[0.06] dark:border-white/[0.08] rounded-full text-xs font-semibold outline-none focus:border-[#0071e3] text-[#1d1d1f] dark:text-[#f5f5f7]"
              value={customEndDate}
              onChange={e => setCustomEndDate(e.target.value)}
            />
          </div>
          {(customStartDate || customEndDate) && (
            <button
              onClick={() => { setCustomStartDate(''); setCustomEndDate(''); }}
              className="text-xs text-[#0071e3] hover:underline cursor-pointer font-semibold ml-auto flex items-center gap-1"
            >
              <X size={12} />
              <span>Reset</span>
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 animate-pulse">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-28 bg-[#e5e5ea]/50 dark:bg-[#2c2c2e]/50 rounded-[22px]"></div>
          ))}
        </div>
      ) : (
        <>
          {/*  Apple Squircle KPI Metric Widgets (6 Cards) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
            {/* 1. Gross Revenue */}
            <div className="bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur-xl rounded-[22px] p-4 border border-black/[0.05] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-all flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-[#86868b] tracking-wider uppercase">Gross Revenue</span>
                <div className="w-7 h-7 rounded-[9px] bg-[#0071e3]/10 text-[#0071e3] flex items-center justify-center shrink-0">
                  <DollarSign size={14} />
                </div>
              </div>
              <div>
                <div className="text-xl sm:text-2xl font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">
                  Rs. {stats.grossSales.toLocaleString()}
                </div>
                <p className="text-[11px] text-[#86868b] mt-1 font-medium truncate">Total sales receipts</p>
              </div>
            </div>

            {/* 2. Units Sold */}
            <div className="bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur-xl rounded-[22px] p-4 border border-black/[0.05] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-all flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-[#86868b] tracking-wider uppercase">Units Sold</span>
                <div className="w-7 h-7 rounded-[9px] bg-[#5856d6]/10 text-[#5856d6] flex items-center justify-center shrink-0">
                  <Package size={14} />
                </div>
              </div>
              <div>
                <div className="text-xl sm:text-2xl font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">
                  {stats.totalUnitsSold} <span className="text-xs font-normal text-[#86868b]">pcs</span>
                </div>
                <p className="text-[11px] text-[#86868b] mt-1 font-medium truncate">{filteredProducts.length} unique items</p>
              </div>
            </div>

            {/* 3. Cost of Goods (COGS) */}
            <div className="bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur-xl rounded-[22px] p-4 border border-black/[0.05] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-all flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-[#86868b] tracking-wider uppercase">Cost (COGS)</span>
                <div className="w-7 h-7 rounded-[9px] bg-[#ff9500]/10 text-[#ff9500] flex items-center justify-center shrink-0">
                  <ShoppingBag size={14} />
                </div>
              </div>
              <div>
                <div className="text-xl sm:text-2xl font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">
                  Rs. {stats.costOfSales.toLocaleString()}
                </div>
                <p className="text-[11px] text-[#86868b] mt-1 font-medium truncate">Stock purchase basis</p>
              </div>
            </div>

            {/* 4. Gross Profit */}
            <div className="bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur-xl rounded-[22px] p-4 border border-black/[0.05] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-all flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-[#86868b] tracking-wider uppercase">Gross Profit</span>
                <div className="w-7 h-7 rounded-[9px] bg-[#34c759]/10 text-[#34c759] flex items-center justify-center shrink-0">
                  <TrendingUp size={14} />
                </div>
              </div>
              <div>
                <div className="text-xl sm:text-2xl font-bold tracking-tight text-[#34c759] tabular-nums">
                  Rs. {stats.grossProfit.toLocaleString()}
                </div>
                <p className="text-[11px] text-[#86868b] mt-1 font-medium truncate">
                  {stats.grossSales > 0 ? ((stats.grossProfit / stats.grossSales) * 100).toFixed(1) : 0}% Margin
                </p>
              </div>
            </div>

            {/* 5. Operating Expenses */}
            <div className="bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur-xl rounded-[22px] p-4 border border-black/[0.05] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-all flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-[#86868b] tracking-wider uppercase">Expenses</span>
                <div className="w-7 h-7 rounded-[9px] bg-[#ff3b30]/10 text-[#ff3b30] flex items-center justify-center shrink-0">
                  <Layers size={14} />
                </div>
              </div>
              <div>
                <div className="text-xl sm:text-2xl font-bold tracking-tight text-[#ff3b30] tabular-nums">
                  Rs. {stats.expenses.toLocaleString()}
                </div>
                <p className="text-[11px] text-[#86868b] mt-1 font-medium truncate">Shop operations</p>
              </div>
            </div>

            {/* 6. Net Business Profit */}
            <div className="bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur-xl rounded-[22px] p-4 border border-black/[0.05] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-all flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-[#86868b] tracking-wider uppercase">Net Profit</span>
                <div className="w-7 h-7 rounded-[9px] bg-[#af52de]/10 text-[#af52de] flex items-center justify-center shrink-0">
                  <Zap size={14} />
                </div>
              </div>
              <div>
                <div className={`text-xl sm:text-2xl font-bold tracking-tight tabular-nums ${stats.netProfit >= 0 ? 'text-[#0071e3]' : 'text-[#ff3b30]'}`}>
                  Rs. {stats.netProfit.toLocaleString()}
                </div>
                <p className="text-[11px] text-[#86868b] mt-1 font-medium truncate">All costs deducted</p>
              </div>
            </div>
          </div>

          {/*  Authentic iOS Segmented Control Tab Switcher */}
          <div className="bg-[#e5e5ea]/80 dark:bg-[#2c2c2e]/80 p-1 rounded-full flex flex-wrap gap-1 backdrop-blur-md border border-black/[0.04] dark:border-white/[0.06] shadow-xs w-fit">
            <button
              onClick={() => setActiveTab('products')}
              className={`px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'products'
                  ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-xs'
                  : 'text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
              }`}
            >
              <Package size={13} className={activeTab === 'products' ? 'text-[#0071e3]' : ''} />
              <span>Product Sales & Profit ({filteredProducts.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'overview'
                  ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-xs'
                  : 'text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
              }`}
            >
              <BarChart3 size={13} className={activeTab === 'overview' ? 'text-[#0071e3]' : ''} />
              <span>Visual Sales Trends</span>
            </button>

            <button
              onClick={() => setActiveTab('flow')}
              className={`px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'flow'
                  ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-xs'
                  : 'text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
              }`}
            >
              <Layers size={13} className={activeTab === 'flow' ? 'text-[#0071e3]' : ''} />
              <span>📦 Product Flow & Velocity</span>
            </button>

            <button
              onClick={() => setActiveTab('financials')}
              className={`px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'financials'
                  ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-xs'
                  : 'text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
              }`}
            >
              <DollarSign size={13} className={activeTab === 'financials' ? 'text-[#0071e3]' : ''} />
              <span>P&L Statement</span>
            </button>
          </div>

          {/* TAB 1: PRODUCT SALES & PROFIT ANALYSIS */}
          {activeTab === 'products' && (
            <div className="space-y-4">
              {/*  Top Champions Cards (Apple Award Widgets) */}
              {productList.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                  {topRevenueProduct && (
                    <div className="bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur-xl border border-black/[0.05] dark:border-white/[0.08] rounded-[22px] p-4 shadow-xs flex items-center justify-between">
                      <div className="min-w-0 pr-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#0071e3] mb-1">
                          <Award size={12} />
                          <span>Highest Revenue</span>
                        </div>
                        <h4 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-sm truncate" title={topRevenueProduct.name}>
                          {topRevenueProduct.name}
                        </h4>
                        <span className="text-xs font-bold text-[#0071e3] mt-0.5 block">
                          Rs. {Math.round(topRevenueProduct.revenue).toLocaleString()} <span className="text-[11px] font-normal text-[#86868b]">({topRevenueProduct.qty} sold)</span>
                        </span>
                      </div>
                      <div className="w-10 h-10 rounded-[12px] bg-[#0071e3]/10 text-[#0071e3] flex items-center justify-center shrink-0">
                        <DollarSign size={18} />
                      </div>
                    </div>
                  )}

                  {topUnitsProduct && (
                    <div className="bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur-xl border border-black/[0.05] dark:border-white/[0.08] rounded-[22px] p-4 shadow-xs flex items-center justify-between">
                      <div className="min-w-0 pr-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#34c759] mb-1">
                          <Zap size={12} />
                          <span>Most Units Sold</span>
                        </div>
                        <h4 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-sm truncate" title={topUnitsProduct.name}>
                          {topUnitsProduct.name}
                        </h4>
                        <span className="text-xs font-bold text-[#34c759] mt-0.5 block">
                          {topUnitsProduct.qty} Units <span className="text-[11px] font-normal text-[#86868b]">(Rs. {Math.round(topUnitsProduct.revenue).toLocaleString()})</span>
                        </span>
                      </div>
                      <div className="w-10 h-10 rounded-[12px] bg-[#34c759]/10 text-[#34c759] flex items-center justify-center shrink-0">
                        <Package size={18} />
                      </div>
                    </div>
                  )}

                  {topProfitProduct && (
                    <div className="bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur-xl border border-black/[0.05] dark:border-white/[0.08] rounded-[22px] p-4 shadow-xs flex items-center justify-between">
                      <div className="min-w-0 pr-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#af52de] mb-1">
                          <TrendingUp size={12} />
                          <span>Top Profit Contributor</span>
                        </div>
                        <h4 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-sm truncate" title={topProfitProduct.name}>
                          {topProfitProduct.name}
                        </h4>
                        <span className="text-xs font-bold text-[#af52de] mt-0.5 block">
                          Rs. {Math.round(topProfitProduct.profit).toLocaleString()} <span className="text-[11px] font-normal text-[#86868b]">({topProfitProduct.margin.toFixed(1)}% margin)</span>
                        </span>
                      </div>
                      <div className="w-10 h-10 rounded-[12px] bg-[#af52de]/10 text-[#af52de] flex items-center justify-center shrink-0">
                        <Award size={18} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/*  Product Search & iOS Pill Filters Bar */}
              <div className="bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur-xl p-3 sm:p-3.5 rounded-[22px] border border-black/[0.05] dark:border-white/[0.08] shadow-xs flex flex-col md:flex-row gap-2.5 justify-between items-stretch md:items-center">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#86868b]" />
                  <input
                    type="text"
                    placeholder="Search by product name or category..."
                    className="w-full pl-9 pr-8 py-2 text-xs bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-black/[0.04] dark:border-white/[0.06] rounded-full focus:outline-none focus:border-[#0071e3] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#86868b] transition"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                  />
                  {productSearch && (
                    <button
                      onClick={() => setProductSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-white"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 items-center">
                  {/* Segment Switcher: All Items | 📦 Bulk Products | 📱 Mobile Phones */}
                  <div className="bg-[#f5f5f7] dark:bg-[#2c2c2e] p-0.5 rounded-full flex items-center border border-black/[0.06] dark:border-white/[0.08]">
                    {[
                      { id: 'all', label: 'All Items' },
                      { id: 'products', label: '📦 Bulk Products' },
                      { id: 'phones', label: '📱 Mobile Phones' }
                    ].map(seg => (
                      <button
                        key={seg.id}
                        type="button"
                        onClick={() => setCatalogSegment(seg.id)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold transition cursor-pointer ${
                          catalogSegment === seg.id
                            ? 'bg-white dark:bg-[#1c1c1e] text-[#0071e3] shadow-xs'
                            : 'text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
                        }`}
                      >
                        {seg.label}
                      </button>
                    ))}
                  </div>

                  <select
                    className="px-3 py-1.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-black/[0.06] dark:border-white/[0.08] rounded-full text-xs font-semibold outline-none text-[#1d1d1f] dark:text-[#f5f5f7] cursor-pointer"
                    value={selectedCategory}
                    onChange={e => setSelectedCategory(e.target.value)}
                  >
                    <option value="all">All Categories</option>
                    {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>

                  <select
                    className="px-3 py-1.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-black/[0.06] dark:border-white/[0.08] rounded-full text-xs font-semibold outline-none text-[#1d1d1f] dark:text-[#f5f5f7] cursor-pointer"
                    value={stockFilter}
                    onChange={e => setStockFilter(e.target.value)}
                  >
                    <option value="all">All Stock Status</option>
                    <option value="in_stock">In Stock Only</option>
                    <option value="low_stock">Low Stock (≤ 3)</option>
                    <option value="out_of_stock">Out of Stock (0)</option>
                  </select>

                  <select
                    className="px-3 py-1.5 bg-[#0071e3]/10 border border-[#0071e3]/20 rounded-full text-xs font-bold text-[#0071e3] outline-none cursor-pointer"
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value)}
                  >
                    <option value="revenue">Sort: Highest Revenue</option>
                    <option value="qty">Sort: Most Units Sold</option>
                    <option value="inward">Sort: Highest Inward (Purchased)</option>
                    <option value="profit">Sort: Highest Profit</option>
                    <option value="margin">Sort: Highest Margin %</option>
                    <option value="slow_moving">Sort: Slow Moving</option>
                  </select>
                </div>
              </div>

              {/*  iOS Inset Grouped Product Analysis Table */}
              <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl rounded-[24px] border border-black/[0.05] dark:border-white/[0.08] shadow-[0_4px_24px_rgba(0,0,0,0.03)] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#f5f5f7]/90 dark:bg-[#2c2c2e]/90 border-b border-black/[0.04] dark:border-white/[0.06] text-[#86868b] uppercase text-[10px] font-semibold tracking-wider">
                      <tr>
                        <th className="px-4 py-3 w-10">#</th>
                        <th className="px-5 py-3">Product Name</th>
                        <th className="px-3 py-3 text-center">Type</th>
                        <th className="px-4 py-3">Category</th>
                        <th className="px-3 py-3 text-center">Inward (In)</th>
                        <th className="px-4 py-3 text-center">Sold (Out)</th>
                        <th className="px-3 py-3 text-center">Net Flow</th>
                        <th className="px-4 py-3 text-right">Avg Price</th>
                        <th className="px-5 py-3 text-right">Total Revenue</th>
                        <th className="px-4 py-3 text-right">Cost (COGS)</th>
                        <th className="px-5 py-3 text-right">Gross Profit</th>
                        <th className="px-4 py-3 text-right">Margin %</th>
                        <th className="px-4 py-3 text-center">Stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                      {filteredProducts.map((p, idx) => (
                        <tr key={p.name} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition group">
                          <td className="px-4 py-3 text-[#86868b] font-medium">{idx + 1}</td>

                          {/* Product Name */}
                          <td className="px-5 py-3">
                            <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] group-hover:text-[#0071e3] transition block">
                              {p.name}
                            </span>
                            <div className="w-24 bg-[#e5e5ea] dark:bg-[#2c2c2e] rounded-full h-1 mt-1 overflow-hidden">
                              <div
                                className="bg-[#0071e3] h-full rounded-full"
                                style={{ width: `${Math.min(100, (p.revenue / (stats.grossSales || 1)) * 100)}%` }}
                              />
                            </div>
                          </td>

                          {/* Type */}
                          <td className="px-3 py-3 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              p.item_type === 'phone'
                                ? 'bg-[#af52de]/10 text-[#af52de]'
                                : 'bg-[#0071e3]/10 text-[#0071e3]'
                            }`}>
                              {p.item_type === 'phone' ? '📱 Mobile' : '📦 Bulk'}
                            </span>
                          </td>

                          {/* Category */}
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#e5e5ea]/70 dark:bg-[#2c2c2e]/70 text-[#86868b]">
                              {p.category}
                            </span>
                          </td>

                          {/* Inward Qty */}
                          <td className="px-3 py-3 text-center font-semibold text-[#86868b]">
                            {p.inwardQty ? (
                              <span className="text-[#0071e3] bg-[#0071e3]/10 px-2 py-0.5 rounded-full text-[11px] font-bold">
                                +{p.inwardQty}
                              </span>
                            ) : (
                              <span>-</span>
                            )}
                          </td>

                          {/* Units Sold */}
                          <td className="px-4 py-3 text-center">
                            <span className="inline-block px-2.5 py-0.5 rounded-full font-bold text-xs bg-[#34c759]/10 text-[#34c759]">
                              {p.qty}
                            </span>
                          </td>

                          {/* Net Movement */}
                          <td className="px-3 py-3 text-center">
                            <span className={`text-[11px] font-bold ${
                              (p.netMovement ?? 0) > 0
                                ? 'text-[#0071e3]'
                                : (p.netMovement ?? 0) < 0
                                  ? 'text-[#ff9500]'
                                  : 'text-[#86868b]'
                            }`}>
                              {(p.netMovement ?? 0) > 0 ? `+${p.netMovement}` : p.netMovement ?? 0}
                            </span>
                          </td>

                          {/* Avg Price */}
                          <td className="px-4 py-3 text-right text-[#86868b] font-medium tabular-nums">
                            Rs. {Math.round(p.avgPrice).toLocaleString()}
                          </td>

                          {/* Total Revenue */}
                          <td className="px-5 py-3 text-right font-bold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">
                            Rs. {Math.round(p.revenue).toLocaleString()}
                          </td>

                          {/* Cost */}
                          <td className="px-4 py-3 text-right text-[#86868b] font-medium tabular-nums">
                            Rs. {Math.round(p.cost).toLocaleString()}
                          </td>

                          {/* Gross Profit */}
                          <td className="px-5 py-3 text-right font-bold tabular-nums">
                            <span className={p.profit >= 0 ? 'text-[#34c759]' : 'text-[#ff3b30]'}>
                              Rs. {Math.round(p.profit).toLocaleString()}
                            </span>
                          </td>

                          {/* Margin % */}
                          <td className="px-4 py-3 text-right">
                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                              p.margin >= 25
                                ? 'bg-[#34c759]/10 text-[#34c759]'
                                : p.margin >= 10
                                  ? 'bg-[#ff9500]/10 text-[#ff9500]'
                                  : 'bg-[#ff3b30]/10 text-[#ff3b30]'
                            }`}>
                              {p.margin.toFixed(1)}%
                            </span>
                          </td>

                          {/* In-Stock */}
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              Number(p.stock) > 3
                                ? 'bg-[#34c759]/10 text-[#34c759]'
                                : Number(p.stock) > 0
                                  ? 'bg-[#ff9500]/10 text-[#ff9500]'
                                  : 'bg-black/5 dark:bg-white/10 text-[#86868b]'
                            }`}>
                              {Number(p.stock) > 0 ? `${p.stock} in stock` : 'Out of stock'}
                            </span>
                          </td>
                        </tr>
                      ))}

                      {filteredProducts.length === 0 && (
                        <tr>
                          <td colSpan="13" className="py-12 text-center text-[#86868b] font-medium">
                            No product sales recorded for this period matching your filter.
                          </td>
                        </tr>
                      )}
                    </tbody>

                    {/* Table Totals Footer */}
                    {filteredProducts.length > 0 && (
                      <tfoot className="bg-[#f5f5f7]/90 dark:bg-[#2c2c2e]/90 font-bold text-xs border-t border-black/[0.08] dark:border-white/[0.08]">
                        <tr>
                          <td colSpan="4" className="px-5 py-3 text-[#86868b] uppercase text-[10px] tracking-wider">
                            Period Totals ({filteredProducts.length} Products):
                          </td>
                          <td className="px-3 py-3 text-center text-[#0071e3]">
                            +{filteredProducts.reduce((s, p) => s + (p.inwardQty || 0), 0)} Pcs
                          </td>
                          <td className="px-4 py-3 text-center text-[#34c759]">
                            {filteredProducts.reduce((s, p) => s + p.qty, 0)} Pcs
                          </td>
                          <td className="px-3 py-3 text-center text-[#86868b]">—</td>
                          <td className="px-4 py-3 text-right text-[#86868b]">—</td>
                          <td className="px-5 py-3 text-right text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">
                            Rs. {Math.round(filteredProducts.reduce((s, p) => s + p.revenue, 0)).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right text-[#86868b] tabular-nums">
                            Rs. {Math.round(filteredProducts.reduce((s, p) => s + p.cost, 0)).toLocaleString()}
                          </td>
                          <td className="px-5 py-3 text-right text-[#34c759] tabular-nums">
                            Rs. {Math.round(filteredProducts.reduce((s, p) => s + p.profit, 0)).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right text-[#34c759]">
                            {(() => {
                              const rev = filteredProducts.reduce((s, p) => s + p.revenue, 0)
                              const prof = filteredProducts.reduce((s, p) => s + p.profit, 0)
                              return rev > 0 ? `${((prof / rev) * 100).toFixed(1)}%` : '-'
                            })()}
                          </td>
                          <td className="px-4 py-3 text-center text-[#1d1d1f] dark:text-[#f5f5f7]">
                            {filteredProducts.reduce((s, p) => s + (Number(p.stock) || 0), 0)} Pcs
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB: PRODUCT FLOW & STOCK VELOCITY */}
          {activeTab === 'flow' && (
            <div className="space-y-6">
              {/* Dual-Flow Comparative Cards */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* 1. Bulk Products & Accessories Flow Card */}
                <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl rounded-[24px] p-5 sm:p-6 border border-black/[0.05] dark:border-white/[0.08] shadow-[0_4px_24px_rgba(0,0,0,0.03)] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-[10px] bg-[#0071e3]/10 text-[#0071e3] flex items-center justify-center">
                          <Package size={16} />
                        </div>
                        <div>
                          <h3 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-sm leading-tight">
                            Bulk Products Flow
                          </h3>
                          <span className="text-[11px] text-[#86868b]">Accessories, Cables, Parts</span>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#0071e3]/10 text-[#0071e3]">
                        Fast Flow
                      </span>
                    </div>

                    <div className="space-y-3">
                      {/* Inward Purchases */}
                      <div className="p-3 rounded-[16px] bg-[#f5f5f7] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.04]">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-[#86868b] font-medium flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-[#0071e3]"></span>
                            <span>Inward (Purchased):</span>
                          </span>
                          <span className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">
                            {flowStats.bulkPurchasedUnits} units • Rs. {Math.round(flowStats.bulkPurchasedCost).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-2 text-[10px] text-[#86868b]">
                          <span className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-medium">💵 Cash: Rs. {Math.round(flowStats.bulkPurchasedCash).toLocaleString()}</span>
                          <span className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-medium">🏦 Bank: Rs. {Math.round(flowStats.bulkPurchasedBank).toLocaleString()}</span>
                          {flowStats.bulkPurchasedCredit > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-[#ff9500]/10 text-[#ff9500] font-medium">📒 Credit: Rs. {Math.round(flowStats.bulkPurchasedCredit).toLocaleString()}</span>
                          )}
                        </div>
                      </div>

                      {/* Outward Sales */}
                      <div className="p-3 rounded-[16px] bg-[#f5f5f7] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.04]">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-[#86868b] font-medium flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-[#34c759]"></span>
                            <span>Outward (Sold):</span>
                          </span>
                          <span className="font-bold text-[#34c759] tabular-nums">
                            {flowStats.bulkSoldUnits} units • Rs. {Math.round(flowStats.bulkSoldRevenue).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between items-center mt-2 text-[11px]">
                          <span className="text-[#86868b]">Gross Profit & Margin:</span>
                          <span className="font-bold text-[#34c759]">
                            Rs. {Math.round(flowStats.bulkSoldProfit).toLocaleString()} ({flowStats.bulkSoldMargin.toFixed(1)}%)
                          </span>
                        </div>
                      </div>

                      {/* Net Flow Movement */}
                      <div className="flex justify-between items-center text-xs pt-1 px-1">
                        <span className="text-[#86868b] font-medium">Net Stock Movement:</span>
                        <span className={`font-bold tabular-nums ${
                          (flowStats.bulkPurchasedUnits - flowStats.bulkSoldUnits) >= 0 ? 'text-[#0071e3]' : 'text-[#ff9500]'
                        }`}>
                          {flowStats.bulkPurchasedUnits - flowStats.bulkSoldUnits >= 0 ? `+${flowStats.bulkPurchasedUnits - flowStats.bulkSoldUnits}` : flowStats.bulkPurchasedUnits - flowStats.bulkSoldUnits} Units
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-black/[0.04] dark:border-white/[0.06] flex justify-between items-center text-xs">
                    <span className="text-[#86868b] font-medium">Current Stock Asset:</span>
                    <span className="font-bold text-[#0071e3] tabular-nums">
                      {flowStats.bulkStockUnits} pcs • Rs. {Math.round(flowStats.bulkStockValue).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* 2. Mobile Phones Flow Card */}
                <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl rounded-[24px] p-5 sm:p-6 border border-black/[0.05] dark:border-white/[0.08] shadow-[0_4px_24px_rgba(0,0,0,0.03)] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-[10px] bg-[#af52de]/10 text-[#af52de] flex items-center justify-center">
                          <Smartphone size={16} />
                        </div>
                        <div>
                          <h3 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-sm leading-tight">
                            Mobile Phones Flow
                          </h3>
                          <span className="text-[11px] text-[#86868b]">Serialized Devices (IMEI)</span>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#af52de]/10 text-[#af52de]">
                        High Value
                      </span>
                    </div>

                    <div className="space-y-3">
                      {/* Inward Purchases */}
                      <div className="p-3 rounded-[16px] bg-[#f5f5f7] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.04]">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-[#86868b] font-medium flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-[#af52de]"></span>
                            <span>Inward (Purchased):</span>
                          </span>
                          <span className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">
                            {flowStats.phonePurchasedUnits} phones • Rs. {Math.round(flowStats.phonePurchasedCost).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-2 text-[10px] text-[#86868b]">
                          <span className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-medium">💵 Cash: Rs. {Math.round(flowStats.phonePurchasedCash).toLocaleString()}</span>
                          <span className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-medium">🏦 Bank: Rs. {Math.round(flowStats.phonePurchasedBank).toLocaleString()}</span>
                          {flowStats.phonePurchasedCredit > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-[#ff9500]/10 text-[#ff9500] font-medium">📒 Credit: Rs. {Math.round(flowStats.phonePurchasedCredit).toLocaleString()}</span>
                          )}
                        </div>
                      </div>

                      {/* Outward Sales */}
                      <div className="p-3 rounded-[16px] bg-[#f5f5f7] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.04]">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-[#86868b] font-medium flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-[#34c759]"></span>
                            <span>Outward (Sold):</span>
                          </span>
                          <span className="font-bold text-[#34c759] tabular-nums">
                            {flowStats.phoneSoldUnits} phones • Rs. {Math.round(flowStats.phoneSoldRevenue).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between items-center mt-2 text-[11px]">
                          <span className="text-[#86868b]">Gross Profit & Margin:</span>
                          <span className="font-bold text-[#34c759]">
                            Rs. {Math.round(flowStats.phoneSoldProfit).toLocaleString()} ({flowStats.phoneSoldMargin.toFixed(1)}%)
                          </span>
                        </div>
                      </div>

                      {/* Net Flow Movement */}
                      <div className="flex justify-between items-center text-xs pt-1 px-1">
                        <span className="text-[#86868b] font-medium">Net Stock Movement:</span>
                        <span className={`font-bold tabular-nums ${
                          (flowStats.phonePurchasedUnits - flowStats.phoneSoldUnits) >= 0 ? 'text-[#af52de]' : 'text-[#ff9500]'
                        }`}>
                          {flowStats.phonePurchasedUnits - flowStats.phoneSoldUnits >= 0 ? `+${flowStats.phonePurchasedUnits - flowStats.phoneSoldUnits}` : flowStats.phonePurchasedUnits - flowStats.phoneSoldUnits} Phones
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-black/[0.04] dark:border-white/[0.06] flex justify-between items-center text-xs">
                    <span className="text-[#86868b] font-medium">Current Stock Asset:</span>
                    <span className="font-bold text-[#af52de] tabular-nums">
                      {flowStats.phoneStockUnits} units • Rs. {Math.round(flowStats.phoneStockValue).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* 3. Combined Capital Allocation & Stock Portfolio */}
                <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl rounded-[24px] p-5 sm:p-6 border border-black/[0.05] dark:border-white/[0.08] shadow-[0_4px_24px_rgba(0,0,0,0.03)] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-[10px] bg-[#34c759]/10 text-[#34c759] flex items-center justify-center">
                          <Layers size={16} />
                        </div>
                        <div>
                          <h3 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-sm leading-tight">
                            Inventory Asset Split
                          </h3>
                          <span className="text-[11px] text-[#86868b]">Capital Allocation</span>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#34c759]/10 text-[#34c759]">
                        Valuation
                      </span>
                    </div>

                    <div className="p-3.5 rounded-[18px] bg-[#f5f5f7] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.04] mb-3">
                      <span className="text-[10px] font-semibold text-[#86868b] uppercase tracking-wider block">Total Shop Inventory Assets</span>
                      <span className="text-xl font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7] mt-0.5 block tabular-nums">
                        Rs. {Math.round(flowStats.totalStockValuation).toLocaleString()}
                      </span>
                    </div>

                    {/* Progress Ratio Bar */}
                    <div className="w-full h-2.5 bg-[#e5e5ea] dark:bg-[#2c2c2e] rounded-full overflow-hidden flex my-3">
                      <div
                        className="bg-[#af52de] h-full"
                        style={{
                          width: `${flowStats.totalStockValuation > 0 ? (flowStats.phoneStockValue / flowStats.totalStockValuation) * 100 : 50}%`
                        }}
                        title={`Phones: Rs. ${Math.round(flowStats.phoneStockValue).toLocaleString()}`}
                      />
                      <div
                        className="bg-[#0071e3] h-full"
                        style={{
                          width: `${flowStats.totalStockValuation > 0 ? (flowStats.bulkStockValue / flowStats.totalStockValuation) * 100 : 50}%`
                        }}
                        title={`Bulk: Rs. ${Math.round(flowStats.bulkStockValue).toLocaleString()}`}
                      />
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between items-center text-[#86868b]">
                        <span className="flex items-center gap-1.5 font-medium">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#af52de]"></span>
                          <span>Phones Holding:</span>
                        </span>
                        <span className="font-bold text-[#af52de] tabular-nums">
                          Rs. {Math.round(flowStats.phoneStockValue).toLocaleString()} ({flowStats.totalStockValuation > 0 ? ((flowStats.phoneStockValue / flowStats.totalStockValuation) * 100).toFixed(0) : 0}%)
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-[#86868b]">
                        <span className="flex items-center gap-1.5 font-medium">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#0071e3]"></span>
                          <span>Bulk Products Holding:</span>
                        </span>
                        <span className="font-bold text-[#0071e3] tabular-nums">
                          Rs. {Math.round(flowStats.bulkStockValue).toLocaleString()} ({flowStats.totalStockValuation > 0 ? ((flowStats.bulkStockValue / flowStats.totalStockValuation) * 100).toFixed(0) : 0}%)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-black/[0.04] dark:border-white/[0.06] flex justify-between items-center text-xs">
                    <span className="text-[#86868b] font-medium">Period Total Inward Outflow:</span>
                    <span className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">
                      Rs. {Math.round(flowStats.bulkPurchasedCost + flowStats.phonePurchasedCost).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Product Stock Velocity & Flow Matrix Table */}
              <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl rounded-[24px] border border-black/[0.05] dark:border-white/[0.08] shadow-[0_4px_24px_rgba(0,0,0,0.03)] overflow-hidden">
                <div className="p-4 border-b border-black/[0.04] dark:border-white/[0.06] flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                  <div>
                    <h3 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-sm flex items-center gap-2">
                      <span className="w-2 h-4 bg-[#0071e3] rounded-full"></span>
                      <span>Product Stock Velocity & Inflow/Outflow Matrix</span>
                    </h3>
                    <p className="text-[11px] text-[#86868b] mt-0.5">
                      Units purchased vs sold, net movement delta, and current inventory valuation.
                    </p>
                  </div>

                  {/* Segment Switcher in Flow Tab */}
                  <div className="bg-[#f5f5f7] dark:bg-[#2c2c2e] p-0.5 rounded-full flex items-center border border-black/[0.06] dark:border-white/[0.08]">
                    {[
                      { id: 'all', label: 'All Items' },
                      { id: 'products', label: '📦 Bulk Only' },
                      { id: 'phones', label: '📱 Phones Only' }
                    ].map(seg => (
                      <button
                        key={seg.id}
                        type="button"
                        onClick={() => setCatalogSegment(seg.id)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold transition cursor-pointer ${
                          catalogSegment === seg.id
                            ? 'bg-white dark:bg-[#1c1c1e] text-[#0071e3] shadow-xs'
                            : 'text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
                        }`}
                      >
                        {seg.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#f5f5f7]/90 dark:bg-[#2c2c2e]/90 border-b border-black/[0.04] dark:border-white/[0.06] text-[#86868b] uppercase text-[10px] font-semibold tracking-wider">
                      <tr>
                        <th className="px-4 py-3 w-10">#</th>
                        <th className="px-5 py-3">Product Name</th>
                        <th className="px-3 py-3 text-center">Type</th>
                        <th className="px-4 py-3">Category</th>
                        <th className="px-3 py-3 text-center">Purchased (In)</th>
                        <th className="px-3 py-3 text-center">Sold (Out)</th>
                        <th className="px-3 py-3 text-center">Net Delta</th>
                        <th className="px-4 py-3 text-right">Revenue</th>
                        <th className="px-4 py-3 text-right">Profit</th>
                        <th className="px-3 py-3 text-right">Margin</th>
                        <th className="px-4 py-3 text-center">Stock on Hand</th>
                        <th className="px-4 py-3 text-center">Velocity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                      {filteredProducts.map((p, idx) => {
                        const isHighVelocity = p.qty >= 5
                        const isSteady = p.qty >= 1 && p.qty < 5
                        const isSlow = p.qty === 0 && Number(p.stock) > 0
                        return (
                          <tr key={p.name} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition">
                            <td className="px-4 py-3 text-[#86868b] font-medium">{idx + 1}</td>
                            <td className="px-5 py-3">
                              <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] block">
                                {p.name}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                p.item_type === 'phone'
                                  ? 'bg-[#af52de]/10 text-[#af52de]'
                                  : 'bg-[#0071e3]/10 text-[#0071e3]'
                              }`}>
                                {p.item_type === 'phone' ? '📱 Mobile' : '📦 Bulk'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-[#86868b]">{p.category}</td>
                            <td className="px-3 py-3 text-center font-bold text-[#0071e3]">
                              {p.inwardQty ? `+${p.inwardQty}` : '—'}
                            </td>
                            <td className="px-3 py-3 text-center font-bold text-[#34c759]">
                              {p.qty > 0 ? p.qty : '—'}
                            </td>
                            <td className="px-3 py-3 text-center font-bold">
                              <span className={
                                (p.netMovement ?? 0) > 0
                                  ? 'text-[#0071e3]'
                                  : (p.netMovement ?? 0) < 0
                                    ? 'text-[#ff9500]'
                                    : 'text-[#86868b]'
                              }>
                                {(p.netMovement ?? 0) > 0 ? `+${p.netMovement}` : p.netMovement ?? 0}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">
                              Rs. {Math.round(p.revenue).toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-[#34c759] tabular-nums">
                              Rs. {Math.round(p.profit).toLocaleString()}
                            </td>
                            <td className="px-3 py-3 text-right font-medium">
                              {p.revenue > 0 ? `${p.margin.toFixed(1)}%` : '—'}
                            </td>
                            <td className="px-4 py-3 text-center font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                              {p.stock} pcs
                            </td>
                            <td className="px-4 py-3 text-center">
                              {isHighVelocity ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#34c759]/10 text-[#34c759]">
                                  ⚡ High Velocity
                                </span>
                              ) : isSteady ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#0071e3]/10 text-[#0071e3]">
                                  🟢 Steady
                                </span>
                              ) : isSlow ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#ff9500]/10 text-[#ff9500]">
                                  🟡 Slow Moving
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-black/5 dark:bg-white/10 text-[#86868b]">
                                  ⚪ Out of Stock
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: VISUAL TRENDS & CATEGORY PERFORMANCE */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Sales Trend Chart */}
                <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl rounded-[24px] border border-black/[0.05] dark:border-white/[0.08] shadow-xs p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-sm flex items-center gap-2">
                      <span className="w-2 h-4 bg-[#0071e3] rounded-full"></span>
                      <span>Daily Sales Revenue Velocity</span>
                    </h3>
                    <span className="text-xs text-[#86868b] font-medium">Revenues over time</span>
                  </div>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={salesTrend}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.12)" />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#86868b' }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#86868b' }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#1d1d1f',
                            color: '#fff',
                            borderRadius: '14px',
                            border: '1px solid rgba(255,255,255,0.1)',
                            fontSize: '11px',
                            boxShadow: '0 8px 30px rgba(0,0,0,0.15)'
                          }}
                        />
                        <Line type="monotone" dataKey="amount" stroke="#0071e3" strokeWidth={3} dot={{ r: 3, fill: '#0071e3', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 5 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Category Profit Distribution */}
                <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl rounded-[24px] border border-black/[0.05] dark:border-white/[0.08] shadow-xs p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-sm flex items-center gap-2">
                      <span className="w-2 h-4 bg-[#af52de] rounded-full"></span>
                      <span>Gross Profit by Category</span>
                    </h3>
                    <span className="text-xs text-[#86868b] font-medium">Category contribution</span>
                  </div>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={categoryData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {categoryData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={['#0071e3', '#5856d6', '#af52de', '#ff9500', '#34c759', '#30b0c7'][index % 6]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#1d1d1f',
                            color: '#fff',
                            borderRadius: '14px',
                            border: '1px solid rgba(255,255,255,0.1)',
                            fontSize: '11px'
                          }}
                        />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Top 8 Products BarChart */}
              <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl rounded-[24px] border border-black/[0.05] dark:border-white/[0.08] shadow-xs p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-sm flex items-center gap-2">
                    <span className="w-2 h-4 bg-[#34c759] rounded-full"></span>
                    <span>Top Product Champions (Revenue vs Profit)</span>
                  </h3>
                  <span className="text-xs text-[#86868b] font-medium">Top 8 bestsellers</span>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={filteredProducts.slice(0, 8)}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.12)" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#86868b' }} interval={0} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#86868b' }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1d1d1f',
                          color: '#fff',
                          borderRadius: '14px',
                          border: '1px solid rgba(255,255,255,0.1)',
                          fontSize: '11px'
                        }}
                      />
                      <Bar dataKey="revenue" fill="#0071e3" radius={[5, 5, 0, 0]} name="Revenue (Rs.)" />
                      <Bar dataKey="profit" fill="#34c759" radius={[5, 5, 0, 0]} name="Gross Profit (Rs.)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: FINANCIAL P&L & EXPENSES */}
          {activeTab === 'financials' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Detailed Financial Summary */}
              <div className="lg:col-span-2 bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl rounded-[24px] border border-black/[0.05] dark:border-white/[0.08] shadow-xs p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-base flex items-center gap-2">
                    <span className="w-2 h-5 bg-[#0071e3] rounded-full"></span>
                    <span>Profit & Loss Statement (P&L)</span>
                  </h3>
                  <span className="text-xs text-[#86868b] font-medium">Financial breakdown</span>
                </div>
                <div className="space-y-3.5 text-xs">
                  <div className="flex justify-between items-center pb-2.5 border-b border-black/[0.04] dark:border-white/[0.06]">
                    <span className="text-[#86868b] font-medium">Gross Sales Value</span>
                    <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">Rs. {stats.grossSales.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center pb-2.5 border-b border-black/[0.04] dark:border-white/[0.06]">
                    <span className="text-[#86868b] font-medium">Total Customer Discounts</span>
                    <span className="font-semibold text-[#ff3b30] tabular-nums">- Rs. {stats.totalDiscount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center p-2.5 rounded-[14px] bg-[#0071e3]/5 border border-[#0071e3]/10">
                    <span className="text-[#0071e3] font-semibold">Net Sales Revenue</span>
                    <span className="font-bold text-[#0071e3] tabular-nums">Rs. {(stats.grossSales - stats.totalDiscount).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center pb-2.5 border-b border-black/[0.04] dark:border-white/[0.06]">
                    <span className="text-[#86868b] font-medium">Cost of Goods Sold (COGS)</span>
                    <span className="font-semibold text-[#ff9500] tabular-nums">- Rs. {stats.costOfSales.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center p-2.5 rounded-[14px] bg-[#34c759]/5 border border-[#34c759]/10">
                    <span className="text-[#34c759] font-semibold text-sm">Gross Business Profit</span>
                    <span className="font-bold text-[#34c759] text-sm tabular-nums">Rs. {stats.grossProfit.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center pb-2.5 border-b border-black/[0.04] dark:border-white/[0.06]">
                    <span className="text-[#86868b] font-medium">Operational Shop Expenses</span>
                    <span className="font-semibold text-[#ff3b30] tabular-nums">- Rs. {stats.expenses.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t border-black/[0.08] dark:border-white/[0.08]">
                    <span className="text-base font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Net Business Profit</span>
                    <span className={`text-2xl font-bold tabular-nums ${stats.netProfit >= 0 ? 'text-[#0071e3]' : 'text-[#ff3b30]'}`}>
                      Rs. {stats.netProfit.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Expenses Breakdown */}
              <div className="space-y-6">
                <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-xl rounded-[24px] border border-black/[0.05] dark:border-white/[0.08] shadow-xs p-6">
                  <h3 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] text-sm mb-4">Operating Expenses</h3>
                  <div className="space-y-3">
                    {expenseBreakdown.map(e => (
                      <div key={e.cat} className="flex flex-col gap-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-[#86868b] font-medium">{e.cat}</span>
                          <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">Rs. {e.val.toLocaleString()}</span>
                        </div>
                        <div className="w-full h-1.5 bg-[#e5e5ea] dark:bg-[#2c2c2e] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#ff3b30] rounded-full"
                            style={{ width: `${stats.expenses > 0 ? (e.val / stats.expenses) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    {expenseBreakdown.length === 0 && (
                      <p className="text-center text-[#86868b] py-4 text-xs">No expenses recorded in this period</p>
                    )}
                  </div>
                </div>

                <div className="bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur-xl border border-black/[0.05] dark:border-white/[0.08] rounded-[24px] p-6 shadow-xs">
                  <div className="w-8 h-8 rounded-[10px] bg-[#5856d6]/10 text-[#5856d6] flex items-center justify-center mb-3">
                    <ShoppingBag size={16} />
                  </div>
                  <h3 className="font-bold text-sm text-[#1d1d1f] dark:text-[#f5f5f7] mb-0.5">New Inventory Purchases</h3>
                  <p className="text-xs text-[#86868b] mb-3">Stock purchased in this selected period</p>
                  <p className="text-2xl font-bold text-[#5856d6] tabular-nums">Rs. {stats.purchases.toLocaleString()}</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default Reports
