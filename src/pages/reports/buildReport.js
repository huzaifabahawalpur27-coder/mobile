// Report figures, worked out from the rows read for one period. Pure: no React, no
// database. Reports.jsx reads the rows (online or from this device) and renders the result.

import { localDay, lineCostParts, lineUnitCost, soldLineRevenue } from '../../utils/profit.js'

// A sale counts in reports unless it is a quotation (or other non-sale type) or voided.
// Sales saved by database functions may have no sale_type; they are sales.
// Item cost and profit follow the shared rule in src/utils/profit.js.
export const isCountedSale = (sale) =>
  (sale?.sale_type == null || sale.sale_type === '' || sale.sale_type === 'sale') && sale?.status !== 'voided'

export function buildReport({ sales, items, expenses, purchases, liveProducts, catList, phones, startDate, endDate, costAdjustments = [], activeBatches = [] }) {
    // 1. Build Lookups for Product Names, Costs and Inventory Stock
    const phoneMap = (phones || []).reduce((acc, p) => {
      const pName = `${p.brand || ''} ${p.model || ''}${p.storage ? ` ${p.storage}` : ''}`.trim()
      const baseCost = Number(p.cost_price || 0)
      const directCost = Number(p.additional_costs || 0)
      acc[p.id] = {
        name: pName || 'Mobile Phone',
        baseCost,
        directCost,
        cost: baseCost + directCost,
        price: Number(p.sale_price || 0),
        status: p.status,
        purchaseDate: p.purchase_date || null,
        soldAt: p.sold_at || null
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
      if (p.name) acc[p.name] = Number(p.cost_price || 0)
      if (p.id) acc[p.id] = Number(p.cost_price || 0)
      return acc
    }, {})



    // Group in-stock phones by Product Name (e.g. "iPhone 13 128GB" -> 4 in stock)
    ;(phones || []).filter(p => p.status === 'in_stock').forEach(p => {
      const pName = `${p.brand || ''} ${p.model || ''}${p.storage ? ` ${p.storage}` : ''}`.trim() || 'Mobile Phone'
      stockMap[pName] = (stockMap[pName] || 0) + 1
    })

    // 2. INWARD FLOW (PURCHASES) BREAKDOWN
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
      const pAmount = Number(p.net_amount) > 0 ? Number(p.net_amount) : Math.max(0, Number(p.total_amount || 0) - Number(p.discount || 0))

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
        if (payType === 'split' && Array.isArray(p.payment_details)) {
          let paidSum = 0
          for (const tender of p.payment_details) {
            const tMethod = String(tender.method || tender.provider || '').toLowerCase()
            const tAmt = Number(tender.amount || 0)
            if (tMethod === 'cash') {
              bulkPurchasedCash += tAmt
              paidSum += tAmt
            } else if (tMethod !== 'credit') {
              bulkPurchasedBank += tAmt
              paidSum += tAmt
            }
          }
          if (pAmount > paidSum) {
            bulkPurchasedCredit += (pAmount - paidSum)
          }
        } else if (payType === 'cash') {
          bulkPurchasedCash += pAmount
        } else if (['bank', 'online'].includes(payType)) {
          bulkPurchasedBank += pAmount
        } else {
          bulkPurchasedCredit += pAmount
        }
      } else {
        // Phone purchase
        phonePurchasedUnits += 1
        phonePurchasedCost += pAmount
        if (payType === 'split' && Array.isArray(p.payment_details)) {
          let paidSum = 0
          for (const tender of p.payment_details) {
            const tMethod = String(tender.method || tender.provider || '').toLowerCase()
            const tAmt = Number(tender.amount || 0)
            if (tMethod === 'cash') {
              phonePurchasedCash += tAmt
              paidSum += tAmt
            } else if (tMethod !== 'credit') {
              phonePurchasedBank += tAmt
              paidSum += tAmt
            }
          }
          if (pAmount > paidSum) {
            phonePurchasedCredit += (pAmount - paidSum)
          }
        } else if (payType === 'cash') {
          phonePurchasedCash += pAmount
        } else if (['bank', 'online'].includes(payType)) {
          phonePurchasedBank += pAmount
        } else if (payType === 'trade_in' || p.is_trade_in) {
          // Trade-in phone purchase: Settled via exchange credit against outgoing sale (No cash/credit debt)
        } else {
          phonePurchasedCredit += pAmount
        }
      }
    })

    // 3. OUTWARD FLOW (SALES) & PRODUCT AGGREGATION
    let totalUnitsSold = 0
    let bulkSoldUnits = 0
    let bulkSoldRevenue = 0
    let bulkSoldCost = 0
    let bulkSoldProfit = 0

    let phoneSoldUnits = 0
    let phoneSoldRevenue = 0
    let phoneSoldCost = 0
    let phoneSoldProfit = 0

    const prodMap = {}
    const soldLines = [] // every sold line, for the Sold items tab

    const saleMap = (sales || []).reduce((acc, s) => {
      acc[s.id] = s
      return acc
    }, {})

    // Pre-calculate invoice subtotals to accurately prorate order-level discounts
    const saleSubtotalMap = {}
    items.forEach(i => {
      const qty = Number(i.quantity || i.qty || 1) - Number(i.returned_qty || 0)
      if (qty <= 0) return
      const unitPrice = Number(
        (Number(i.unit_price) > 0 ? i.unit_price : null) ??
        (Number(i.price) > 0 ? i.price : null) ??
        (i.phone_id && phoneMap[i.phone_id] ? phoneMap[i.phone_id].price : 0) ?? 0
      )
      let lineRev = soldLineRevenue(i, qty, unitPrice)
      if (i.sale_id) {
        saleSubtotalMap[i.sale_id] = (saleSubtotalMap[i.sale_id] || 0) + lineRev
      }
    })

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

      name = name.replace(/\s*[([]?\s*IMEI[:\s]+[0-9/,\s]+[)\]]?/gi, '').trim() || 'Uncategorized Product'

      const isPhone = Boolean(i.phone_id || snap || i.item_type === 'phone' || (i.products?.categories?.name === 'Mobile Phones'))
      const phoneInfo = i.phone_id ? phoneMap[i.phone_id] : null
      const { base: baseCost, extras: directCost, source: costSource } = lineCostParts(i, snap, phoneInfo,
        (i.product_id ? productCostMap[i.product_id] : null) ?? (productCostMap[name] || 0),
        i.sales?.created_at || saleMap[i.sale_id]?.created_at || i.created_at)
      const totalUnitCost = baseCost + directCost
      const costPrice = totalUnitCost
      const unitPrice = Number(
        (Number(i.unit_price) > 0 ? i.unit_price : null) ??
        (Number(i.price) > 0 ? i.price : null) ??
        (phoneInfo ? phoneInfo.price : 0) ?? 0
      )
      let lineRev = soldLineRevenue(i, qty, unitPrice)
      const parentSale = i.sale_id ? saleMap[i.sale_id] : null
      const saleDiscount = Number(parentSale?.discount || 0)
      const saleSubtotal = i.sale_id ? (saleSubtotalMap[i.sale_id] || 0) : 0
      const itemDiscount = (saleDiscount > 0 && saleSubtotal > 0)
        ? (lineRev / saleSubtotal) * saleDiscount
        : 0
      const netLineRev = Math.max(0, lineRev - itemDiscount)
      const lineCost = qty * totalUnitCost
      const lineProfit = netLineRev - lineCost
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
          inventory_mode: i.products?.inventory_mode || (liveProducts.find(lp => lp.name === name)?.inventory_mode) || null,
          qty: 0,
          revenue: 0,
          grossRevenue: 0,
          discount: 0,
          cost: 0,
          baseCost: 0,
          directCost: 0,
          profit: 0,
          stock: stockMap[name] ?? 0,
          inwardQty: inwardByProductName[name] || 0,
          unitCost: costPrice
        }
      }

      prodMap[name].qty += qty
      prodMap[name].revenue += netLineRev
      prodMap[name].grossRevenue += lineRev
      prodMap[name].discount += itemDiscount
      prodMap[name].cost += lineCost
      prodMap[name].baseCost = (prodMap[name].baseCost || 0) + (qty * baseCost)
      prodMap[name].directCost = (prodMap[name].directCost || 0) + (qty * directCost)
      prodMap[name].profit += lineProfit
      if (categoryName !== 'General') prodMap[name].category = categoryName

      soldLines.push({
        key: i.id ?? `${i.sale_id}-${name}-${soldLines.length}`,
        date: i.sales?.created_at || parentSale?.created_at || i.created_at || null,
        saleId: i.sale_id,
        invoice: parentSale?.invoice_number || (parentSale?.invoice_token ? `INV-${parentSale.invoice_token}` : (i.sale_id ? `#${i.sale_id}` : '')),
        customer: parentSale?.customer_name || 'Walk-in customer',
        name,
        imei: snap ? [snap.imei_1, snap.imei_2].filter(Boolean).join(' / ') : '',
        isPhone,
        category: categoryName,
        qty,
        unitPrice: qty > 0 ? lineRev / qty : 0,
        discount: itemDiscount,
        revenue: netLineRev,
        unitCost: totalUnitCost,
        costSource,
        phoneId: i.phone_id || null,
        productId: i.product_id || null,
        purchaseCost: qty * baseCost,
        extraCost: qty * directCost,
        cost: lineCost,
        profit: lineProfit
      })
    })
    soldLines.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    const soldDayMap = new Map()
    for (const l of soldLines) {
      const d = l.date ? new Date(l.date) : null
      const key = d ? localDay(d) : 'unknown'
      if (!soldDayMap.has(key)) {
        soldDayMap.set(key, {
          key,
          label: d ? d.toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }) : 'Date not recorded',
          lines: [], qty: 0, revenue: 0, discount: 0, purchaseCost: 0, extraCost: 0, cost: 0, profit: 0
        })
      }
      const day = soldDayMap.get(key)
      day.lines.push(l)
      for (const f of ['qty', 'revenue', 'discount', 'purchaseCost', 'extraCost', 'cost', 'profit']) day[f] += l[f]
    }
    const soldDays = [...soldDayMap.values()]

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
          inventory_mode: p.inventory_mode,
          qty: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
          stock: Number(p.stock_quantity || 0),
          inwardQty: inwardByProductName[pName] || 0,
          unitCost: Number(p.cost_price || 0),
          catalogPrice: Number(p.sale_price || 0)
        }
      }
    })

    const compiledProducts = Object.values(prodMap).map(p => {
      const margin = p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0
      const avgPrice = p.qty > 0 ? p.revenue / p.qty : (p.catalogPrice || 0)
      const avgCost = p.qty > 0 ? p.cost / p.qty : p.unitCost
      const netMovement = Number(p.inwardQty || 0) - Number(p.qty || 0)
      const directCost = p.directCost || 0
      const baseCost = p.baseCost || 0
      return {
        ...p,
        margin,
        avgPrice,
        avgCost,
        netMovement,
        directCost,
        baseCost
      }
    })

    // 4. Overall Financials (Fully Consistent & Accurate COGS & Profit)
    const totalItemsRevenue = phoneSoldRevenue + bulkSoldRevenue
    const grossSales = totalItemsRevenue > 0
      ? totalItemsRevenue
      : sales.reduce((sum, s) => sum + Number(s.total_amount || s.net_amount || 0), 0)
    const totalDiscount = sales.reduce((sum, s) => sum + Number(s.discount || 0), 0)
    const netSalesValue = Math.max(0, grossSales - totalDiscount)
    const costOfSales = phoneSoldCost + bulkSoldCost
    const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0)
    const totalPurchases = purchases.reduce((sum, p) => sum + Number(p.total_amount || 0), 0)
    const totalCostAdjustments = (costAdjustments || []).reduce((sum, a) => sum + Number(a.cogs_impact || 0), 0)
    const grossProfit = netSalesValue - costOfSales - totalCostAdjustments
    const netProfit = grossProfit - totalExpenses

    // 5. Stock Valuations
    const batchesByProd = (activeBatches || []).reduce((acc, b) => {
      const pid = String(b.product_id)
      if (!acc[pid]) acc[pid] = { units: 0, value: 0 }
      const rem = Number(b.qty_remaining || 0)
      const cost = Number(b.current_unit_cost || 0)
      acc[pid].units += rem
      acc[pid].value += (rem * cost)
      return acc
    }, {})

    const bulkStockUnits = (liveProducts || []).reduce((sum, p) => sum + Math.max(0, Number(p.stock_quantity || 0)), 0)
    const bulkStockValue = (liveProducts || []).reduce((sum, p) => {
      const pid = String(p.id)
      if (p.inventory_mode === 'batch_tracked' && batchesByProd[pid]) {
        return sum + batchesByProd[pid].value
      }
      return sum + (Number(p.cost_price || 0) * Math.max(0, Number(p.stock_quantity || 0)))
    }, 0)
    const inStockPhones = (phones || []).filter(p => p.status === 'in_stock')
    const phoneStockUnits = inStockPhones.length
    const phoneStockValue = inStockPhones.reduce((sum, p) => sum + Number(p.cost_price || 0) + Number(p.additional_costs || 0), 0)
    const totalStockValuation = bulkStockValue + phoneStockValue

    const bulkSoldMargin = bulkSoldRevenue > 0 ? (bulkSoldProfit / bulkSoldRevenue) * 100 : 0
    const phoneSoldMargin = phoneSoldRevenue > 0 ? (phoneSoldProfit / phoneSoldRevenue) * 100 : 0

    const flowStats = ({
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


    const totalDirectCosts = Object.values(prodMap).reduce((s, p) => s + (p.directCost || 0), 0)

    const stats = ({
      grossSales,
      costOfSales,
      costAdjustments: totalCostAdjustments,
      grossProfit,
      expenses: totalExpenses,
      netProfit,
      totalDiscount,
      purchases: totalPurchases,
      totalDirectCosts,
      totalUnitsSold,
      netSales: netSalesValue,
      salesCount: sales.length,
      // still owed by customers on this period's sales (credit not yet paid); profit counts
      // a sale when it is made, paid or not
      creditDue: sales.reduce((sum, x) => {
        if (x.paid_amount == null) return sum
        const net = Number(x.net_amount ?? (Number(x.total_amount || 0) - Number(x.discount || 0)))
        return sum + Math.max(0, net - Number(x.paid_amount || 0))
      }, 0),
      // cost of goods split into what was paid for the goods and the extra costs on them
      purchaseCostOfSales: costOfSales - totalDirectCosts
    })

    // 6. Expense Breakdown
    const expMap = {}
    expenses.forEach(e => {
      const cat = e.category || 'Other'
      expMap[cat] = (expMap[cat] || 0) + Number(e.amount || 0)
    })
    const expenseBreakdown = (Object.entries(expMap).map(([cat, val]) => ({ cat, val })).sort((a, b) => b.val - a.val))

    // 7. Sales Trend
    const trendMap = {}
    sales.forEach(s => {
      const date = new Date(s.created_at).toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })
      trendMap[date] = (trendMap[date] || 0) + Number(s.total_amount || 0)
    })
    const salesTrend = (Object.entries(trendMap).map(([date, amount]) => ({ date, amount })))

    // 8. Category Profit Distribution
    const catMap = {}
    compiledProducts.forEach(p => {
      catMap[p.category] = (catMap[p.category] || 0) + Math.max(0, p.profit)
    })
    const categoryData = (Object.entries(catMap).map(([name, value]) => ({ name, value })).filter(c => c.value > 0))

    // 9. Day-by-Day Breakdown (Weekly & Period Daily Matrix)
    const getLocalDateKey = (isoStr) => {
      if (!isoStr) return ''
      const d = new Date(isoStr)
      if (isNaN(d.getTime())) return ''
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }

    // One row per day of the period. A long period (All, a wide custom range) lists only
    // the days with a sale, expense or purchase, instead of every calendar day.
    const emptyDay = (d) => ({
      dateKey: getLocalDateKey(d),
      dateObj: d,
      dayName: d.toLocaleDateString('en-PK', { weekday: 'short' }),
      fullDate: d.toLocaleDateString('en-PK', { weekday: 'short', month: 'short', day: 'numeric' }),
      ordersCount: 0,
      phonesSold: 0,
      phonesRevenue: 0,
      phonesCost: 0,
      bulkSold: 0,
      bulkRevenue: 0,
      bulkCost: 0,
      totalUnits: 0,
      grossSales: 0,
      discount: 0,
      netSales: 0,
      cogs: 0,
      grossProfit: 0,
      margin: 0,
      expenses: 0,
      netProfit: 0,
      cashSales: 0,
      onlineSales: 0,
      creditSales: 0,
      purchases: 0
    })
    const dailyDays = []
    const firstDay = new Date(startDate)
    firstDay.setHours(0, 0, 0, 0)
    const lastDay = new Date(endDate)
    lastDay.setHours(0, 0, 0, 0)
    const spanDays = Math.round((lastDay - firstDay) / 86400000) + 1
    if (spanDays <= 62) {
      for (const cur = new Date(firstDay); cur <= lastDay; cur.setDate(cur.getDate() + 1)) {
        dailyDays.push(emptyDay(new Date(cur)))
      }
    } else {
      const activeKeys = new Set([...sales, ...expenses, ...purchases].map(r => getLocalDateKey(r.created_at)).filter(Boolean))
      ;[...activeKeys].sort().forEach(k => {
        const [y, m, d] = k.split('-').map(Number)
        dailyDays.push(emptyDay(new Date(y, m - 1, d)))
      })
    }

    const dayMap = dailyDays.reduce((acc, d) => {
      acc[d.dateKey] = d
      return acc
    }, {})

    // Map sales to daily entries
    sales.forEach(s => {
      const k = getLocalDateKey(s.created_at)
      const day = dayMap[k]
      if (day) {
        day.ordersCount += 1
        day.discount += Number(s.discount || 0)
        const netAmt = Number(s.total_amount || 0) - Number(s.discount || 0)
        const pType = String(s.payment_type || 'cash').toLowerCase()
        if (pType === 'cash') day.cashSales += netAmt
        else if (pType === 'credit') day.creditSales += netAmt
        else day.onlineSales += netAmt
      }
    })

    // Map line items to daily entries
    const saleDateMap = sales.reduce((acc, s) => {
      acc[s.id] = s.created_at
      return acc
    }, {})

    items.forEach(i => {
      const qty = Number(i.quantity || i.qty || 1) - Number(i.returned_qty || 0)
      if (qty <= 0) return
      const itemDate = i.sales?.created_at || saleDateMap[i.sale_id] || i.created_at
      const k = getLocalDateKey(itemDate)
      const day = dayMap[k]
      if (!day) return

      let snap = null
      if (i.imei_snapshot) {
        if (typeof i.imei_snapshot === 'object') snap = i.imei_snapshot
        else if (typeof i.imei_snapshot === 'string') {
          try { snap = JSON.parse(i.imei_snapshot) } catch { /* invalid json ignored */ }
        }
      }

      let name = ''
      if (i.product_name && i.product_name.trim()) name = i.product_name.trim()
      else if (i.products?.name) name = i.products.name.trim()
      else if (i.phone_id && phoneMap[i.phone_id]?.name) name = phoneMap[i.phone_id].name
      else if (snap && (snap.brand || snap.model)) {
        name = `${snap.brand || ''} ${snap.model || ''}${snap.storage ? ` ${snap.storage}` : ''}`.trim()
      } else if (i.brand && i.model) name = `${i.brand} ${i.model}`.trim()
      name = name.replace(/\s*[([]?\s*IMEI[:\s]+[0-9/,\s]+[)\]]?/gi, '').trim() || 'Uncategorized Product'

      const isPhone = Boolean(i.phone_id || snap || i.item_type === 'phone' || (i.products?.categories?.name === 'Mobile Phones'))

      const unitPrice = Number(
        (Number(i.unit_price) > 0 ? i.unit_price : null) ??
        (Number(i.price) > 0 ? i.price : null) ??
        (i.phone_id ? phoneMap[i.phone_id]?.price : 0) ?? 0
      )
      const costPrice = lineUnitCost(i, snap, i.phone_id ? phoneMap[i.phone_id] : null,
        (i.product_id ? productCostMap[i.product_id] : null) ?? (productCostMap[name] || 0), itemDate)

      let lineRev = soldLineRevenue(i, qty, unitPrice)
      const lineCost = qty * costPrice

      if (isPhone) {
        day.phonesSold += qty
        day.phonesRevenue += lineRev
        day.phonesCost += lineCost
      } else {
        day.bulkSold += qty
        day.bulkRevenue += lineRev
        day.bulkCost += lineCost
      }
    })

    // Map expenses to daily entries
    expenses.forEach(e => {
      const k = getLocalDateKey(e.created_at)
      if (dayMap[k]) {
        dayMap[k].expenses += Number(e.amount || 0)
      }
    })

    // Map purchases to daily entries
    purchases.forEach(p => {
      const k = getLocalDateKey(p.created_at)
      if (dayMap[k]) {
        dayMap[k].purchases += Number(p.total_amount || 0)
      }
    })

    // Finalize daily totals
    dailyDays.forEach(d => {
      const itemsRev = d.phonesRevenue + d.bulkRevenue
      if (itemsRev > 0) {
        d.grossSales = itemsRev
      } else {
        const salesOnDay = sales.filter(s => getLocalDateKey(s.created_at) === d.dateKey)
        d.grossSales = salesOnDay.reduce((sum, s) => sum + Number(s.total_amount || 0), 0)
      }
      d.netSales = Math.max(0, d.grossSales - d.discount)
      d.totalUnits = d.phonesSold + d.bulkSold
      d.cogs = d.phonesCost + d.bulkCost
      d.grossProfit = d.netSales - d.cogs
      d.margin = d.netSales > 0 ? (d.grossProfit / d.netSales) * 100 : 0
      d.netProfit = d.grossProfit - d.expenses
    })


    // 10. Transaction Ledger — every individual sale, expense and purchase in range
    const txns = []
    ;(sales || []).forEach(s => {
      txns.push({
        key: `sale-${s.id}`,
        date: s.created_at,
        type: 'Sale',
        dir: 'in',
        label: s.customer_name ? `Sale · ${s.customer_name}` : 'Sale',
        ref: s.invoice_number || s.invoice_no || s.id,
        method: String(s.payment_type || 'cash'),
        amount: Math.max(0, Number(s.net_amount ?? (Number(s.total_amount || 0) - Number(s.discount || 0))))
      })
    })
    ;(expenses || []).forEach(e => {
      const note = e.note || e.description || ''
      txns.push({
        key: `exp-${e.id}`,
        date: e.created_at,
        type: 'Expense',
        dir: 'out',
        label: (e.category || 'Expense') + (note ? ` · ${note}` : ''),
        ref: e.id,
        method: '',
        amount: Number(e.amount || 0)
      })
    })
    ;(purchases || []).forEach(p => {
      txns.push({
        key: `pur-${p.id}`,
        date: p.created_at,
        type: 'Purchase',
        dir: 'out',
        label: p.supplier_name || p.supplier?.name || p.vendor_name || 'Stock purchase',
        ref: p.invoice_number || p.id,
        method: String(p.payment_type || 'cash'),
        amount: Number(p.net_amount) > 0 ? Number(p.net_amount) : Number(p.total_amount || 0)
      })
    })
    txns.sort((a, b) => new Date(b.date) - new Date(a.date))

    return { stats, flowStats, productList: compiledProducts, soldLines, soldDays, expenseBreakdown, salesTrend, categoryData, dailyBreakdown: dailyDays, transactions: txns }
}
