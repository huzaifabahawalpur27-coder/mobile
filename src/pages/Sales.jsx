import React, { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { db, addToSyncQueue, moveToTrash } from '../services/db'
import { recordAuditLog } from '../services/auditService'
import PasswordModal from '../components/PasswordModal'
import { printHTML } from '../utils/printUtils'
import { buildBillHTML } from '../utils/billTemplates'
import { getBankAccounts, deductBankBalance } from '../services/bankService'

const normalizeSaleItem = (it, phonesPool = [], productsPool = []) => {
  let snap = null
  if (it.imei_snapshot) {
    if (typeof it.imei_snapshot === 'object') {
      snap = it.imei_snapshot
    } else if (typeof it.imei_snapshot === 'string') {
      try { snap = JSON.parse(it.imei_snapshot) } catch (_) {}
    }
  }
  const ph = it.phones || (phonesPool || []).find(p => p.id === it.phone_id || (it.sale_id && p.sale_id === it.sale_id)) || snap
  const prod = it.products || (productsPool || []).find(p => p.id === it.product_id)

  let name = (it.product_name && it.product_name.trim()) || (prod ? prod.name : null)
  if (!name && ph) {
    const brand = ph.brand && ph.brand !== 'Unknown' ? ph.brand + ' ' : ''
    name = `${brand}${ph.model || 'Smartphone'}`.trim()
  }
  if (!name) name = 'Item'

  const specs = ph ? [ph.storage, ph.color, ph.pta_status ? ph.pta_status.toUpperCase() : null, ph.condition ? ph.condition.toUpperCase() : null].filter(Boolean).join(' • ') : null
  const imei = ph ? (ph.imei_1 || ph.imei || ph.imei1 || (typeof it.imei_snapshot === 'string' && !it.imei_snapshot.startsWith('{') ? it.imei_snapshot : null)) : null
  const imei2 = ph ? (ph.imei_2 || ph.imei2 || null) : null
  const price = it.unit_price ?? (it.price ?? (it.subtotal || 0))
  const qty = it.quantity || 1

  return {
    ...it,
    phones: ph,
    display_name: name,
    specs,
    imei,
    imei2,
    status: ph?.status || null,
    unit_price: price,
    quantity: qty
  }
}

function Sales() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedSale, setSelectedSale] = useState(null)
  const [saleItems, setSaleItems] = useState([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [returning, setReturning] = useState(false)
  const [returnQtys, setReturnQtys] = useState({})
  const [expandedSales, setExpandedSales] = useState(new Set())
  const [search, setSearch] = useState('')
  const [searchDate, setSearchDate] = useState('')
  const [filterType, setFilterType] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('')
  const [refundType, setRefundType] = useState('cash') // 'cash' or 'credit'
  const [selected, setSelected] = useState([])
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [pendingDeleteIds, setPendingDeleteIds] = useState([])

  const [shopSettings, setShopSettings] = useState({})

  useEffect(() => {
    if (user?.shop_id) {
      fetchShopSettings()
      fetchSales()
    }
  }, [user?.shop_id])

  const toggleExpand = (id) => {
    setExpandedSales(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const fetchShopSettings = async () => {
    // Read from shop-scoped localStorage first for instant load
    const sid = user?.shop_id
    const cached = sid ? localStorage.getItem(`shop_settings_${sid}`) : null
    if (cached) {
      try { setShopSettings(JSON.parse(cached)) } catch (_) {}
    }
    try {
      if (!navigator.onLine) throw new Error('Offline')
      const { data } = await supabase.from('shops').select('*').eq('id', user.shop_id).maybeSingle()
      if (data) setShopSettings(prev => ({ ...prev, ...data }))
    } catch (e) {
      console.log('Sales: Using cached shop settings')
    }
  }

  const fetchSales = async () => {
    if (!user?.shop_id) {
      setLoading(false)
      console.error('Sales: Missing user.shop_id!')
      return
    }

    const sid = String(user.shop_id)

    // ── Step 1: Show local IndexedDB data IMMEDIATELY (instant UI) ────────────
    try {
      const [localData, lItems, lPhones, lProducts] = await Promise.all([
        db.sales.toArray(),
        db.sale_items ? db.sale_items.toArray() : [],
        db.phones ? db.phones.toArray() : [],
        db.products ? db.products.toArray() : []
      ])
      const filtered = localData.filter(x => String(x.shop_id) === sid)
      const mapped = filtered.map(s => {
        const items = (s.sale_items && s.sale_items.length > 0)
          ? s.sale_items
          : lItems.filter(i => i.sale_id === s.id)
        return {
          ...s,
          sale_items: items.map(it => normalizeSaleItem(it, lPhones, lProducts))
        }
      })
      const sorted = mapped.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      setSales(sorted)
      if (sorted.length > 0) {
        setLoading(false)
      }
    } catch (localErr) {
      console.warn('Sales: Local DB read failed:', localErr)
    }

    // ── Step 2: Background refresh from Supabase (updates UI silently) ────────
    if (!navigator.onLine) {
      setLoading(false)
      return
    }

    try {
      const fetchPromise = supabase
        .from('sales')
        .select('*, customers(name), sale_items(*, phones(*), products(name))')
        .eq('shop_id', user.shop_id)
        .order('created_at', { ascending: false })

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 4000))
      const { data, error } = await Promise.race([fetchPromise, timeoutPromise])

      if (error) throw error
      if (data) {
        const cleanData = JSON.parse(JSON.stringify(data)).map(s => ({
          ...s,
          sale_items: (s.sale_items || []).map(it => normalizeSaleItem(it))
        }))
        await db.sales.bulkPut(cleanData)
        // Cache sale items into local DB
        const allItems = cleanData.flatMap(s => s.sale_items || [])
        if (allItems.length > 0) {
          await db.sale_items.bulkPut(allItems).catch(() => {})
        }
      }

      const [localData, lItems, lPhones, lProducts] = await Promise.all([
        db.sales.toArray(),
        db.sale_items ? db.sale_items.toArray() : [],
        db.phones ? db.phones.toArray() : [],
        db.products ? db.products.toArray() : []
      ])
      const filtered = localData.filter(x => String(x.shop_id) === sid)
      const mapped = filtered.map(s => {
        const items = (s.sale_items && s.sale_items.length > 0)
          ? s.sale_items
          : lItems.filter(i => i.sale_id === s.id)
        return {
          ...s,
          sale_items: items.map(it => normalizeSaleItem(it, lPhones, lProducts))
        }
      })
      const sorted = mapped.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      setSales(sorted)
    } catch (e) {
      console.warn('Sales: Supabase background refresh failed:', e)
    } finally {
      setLoading(false)
    }
  }

  const openSale = async (sale) => {
    setSelectedSale(sale)
    setReturnQtys({})
    setLoadingItems(true)
    try {
      if (!navigator.onLine) throw new Error('Offline')
      const fetchPromise = supabase
        .from('sale_items')
        .select('*, products(name, stock_quantity), phones(*)')
        .eq('sale_id', sale.id)

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      const { data, error } = await Promise.race([fetchPromise, timeoutPromise])

      if (error) throw error
      let items = []
      if (data) {
        items = JSON.parse(JSON.stringify(data)).map(it => normalizeSaleItem(it))
        await db.sale_items.bulkPut(items)
      } else {
        const localItems = await db.sale_items.where({ sale_id: sale.id }).toArray().catch(() => [])
        const [lPhones, lProducts] = await Promise.all([
          db.phones ? db.phones.toArray() : [],
          db.products ? db.products.toArray() : []
        ])
        items = localItems.map(it => normalizeSaleItem(it, lPhones, lProducts))
      }
      setSaleItems(items)
    } catch (e) {
      console.log('Sale Items: Fetching from local DB (Offline Fallback)')
      const localItems = await db.sale_items.where({ sale_id: sale.id }).toArray().catch(() => [])
      const [lPhones, lProducts] = await Promise.all([
        db.phones ? db.phones.toArray() : [],
        db.products ? db.products.toArray() : []
      ])
      const targetItems = localItems.length === 0
        ? (await db.sale_items.toArray()).filter(i => i.sale_id === sale.id)
        : localItems
      setSaleItems(targetItems.map(it => normalizeSaleItem(it, lPhones, lProducts)))
    }
    setLoadingItems(false)
  }

  // Handle return
  const handleReturn = async () => {
    const itemsToReturn = saleItems.filter(i => returnQtys[i.id] > 0)
    if (itemsToReturn.length === 0) { alert('Return karne ke liye qty enter karo!'); return }

    for (const item of itemsToReturn) {
      const returnQty = parseInt(returnQtys[item.id]) || 0
      const alreadyReturned = item.returned_qty || 0
      const maxReturn = item.quantity - alreadyReturned
      if (returnQty > maxReturn) { alert(`${item.display_name || item.product_name || 'Item'}: max ${maxReturn} return ho sakta hai`); return }
    }

    setReturning(true)
    let totalReturnAmount = 0

    try {
      for (const item of itemsToReturn) {
        const returnQty = parseInt(returnQtys[item.id]) || 0
        const returnAmount = item.unit_price * returnQty
        totalReturnAmount += returnAmount

        // Update returned_qty on sale_item
        await supabase.from('sale_items')
          .update({ returned_qty: (item.returned_qty || 0) + returnQty })
          .eq('id', item.id)

        // Restore stock or phone status
        if (item.phone_id) {
          await supabase.from('phones').update({ status: 'in_stock', sale_id: null, sold_at: null }).eq('id', item.phone_id)
          if (db.phones) {
            await db.phones.update(item.phone_id, { status: 'in_stock', sale_id: null, sold_at: null })
          }
        } else if (item.product_id) {
          const { data: liveProduct } = await supabase.from('products').select('stock_quantity').eq('id', item.product_id).maybeSingle()
          const currentStock = liveProduct?.stock_quantity ?? 0
          const newStock = currentStock + returnQty
          await supabase.from('products')
            .update({ stock_quantity: newStock })
            .eq('id', item.product_id)
          // Keep local DB in sync
          await db.products.update(item.product_id, { stock_quantity: newStock })
        }
      }

      // Update sale record total
      const newSaleTotal = Math.max(0, (selectedSale.total_amount || 0) - totalReturnAmount)
      await supabase.from('sales').update({ total_amount: newSaleTotal }).eq('id', selectedSale.id)

      // Process Refund
      if (refundType === 'credit' && selectedSale.customer_id) {
        const { data: cust } = await supabase.from('customers').select('*').eq('id', selectedSale.customer_id).maybeSingle()
        const currentBal = cust?.outstanding_balance ?? cust?.balance ?? 0
        const newBal = Math.max(0, currentBal - totalReturnAmount)
        const { error: updErr } = await supabase.from('customers').update({ outstanding_balance: newBal, balance: newBal }).eq('id', selectedSale.customer_id)
        if (updErr && updErr.message?.includes('outstanding_balance')) {
          await supabase.from('customers').update({ balance: newBal }).eq('id', selectedSale.customer_id)
        }
        await db.customers.update(selectedSale.customer_id, { outstanding_balance: newBal, balance: newBal })

        // Log payment return in customer_payments
        await supabase.from('customer_payments').insert([{
          shop_id: user.shop_id,
          customer_id: selectedSale.customer_id,
          amount: -totalReturnAmount,
          payment_type: 'return',
          note: `Return from Invoice #${String(selectedSale.id).slice(-6)} (Credited to Balance)`
        }])
        // Log as refund (Cash or Walk-in)
        await supabase.from('customer_payments').insert([{
          shop_id: user.shop_id,
          customer_id: selectedSale.customer_id || null,
          amount: -totalReturnAmount,
          payment_type: 'refund',
          note: `Cash Refund from Invoice #${String(selectedSale.id).slice(-6)}`
        }])

        // Deduct from Cash account in Accounts section
        try {
          const accounts = await getBankAccounts(user.shop_id)
          const cashAcc = accounts.find(a => 
            a.bank_name?.toLowerCase().includes('cash') || 
            a.account_name?.toLowerCase().includes('cash')
          )
          if (cashAcc) {
            await deductBankBalance({
              shopId: user.shop_id,
              accountId: cashAcc.id,
              amount: totalReturnAmount,
              description: `Sale Return Refund (Invoice #${selectedSale.id})`
            })
          }
        } catch (accErr) {
          console.warn('Could not deduct refund from cash account:', accErr)
        }
      }

      // Audit Log
      await recordAuditLog(
        'SALE_RETURN',
        'sales',
        selectedSale.id,
        {
          invoice: selectedSale.id,
          returned_amount: totalReturnAmount,
          items: itemsToReturn.map(it => ({ name: it.display_name || it.product_name, qty: returnQtys[it.id] }))
        },
        user.id,
        user.shop_id
      )

      alert('Return successful! Invoice updated.')
      setReturning(false)
      setReturnQtys({})

      // Re-fetch updated sale + items to reflect new returned_qty in modal
      const { data: updatedSale } = await supabase.from('sales').select('*, customers(name)').eq('id', selectedSale.id).maybeSingle()
      if (updatedSale) setSelectedSale(updatedSale)
      const { data: updatedItems } = await supabase.from('sale_items').select('*, products(name, stock_quantity), phones(*)').eq('sale_id', selectedSale.id)
      if (updatedItems) {
        const cleanItems = JSON.parse(JSON.stringify(updatedItems)).map(it => normalizeSaleItem(it))
        await db.sale_items.bulkPut(cleanItems)
        setSaleItems(cleanItems)
      }
      fetchSales()
    } catch (err) {
      const errMsg = err?.message || String(err)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        // OFFLINE RETURN LOGIC
        for (const item of itemsToReturn) {
          const returnQty = parseInt(returnQtys[item.id]) || 0
          totalReturnAmount += item.unit_price * returnQty

          // 1. Update local sale_item
          const newRetQty = (item.returned_qty || 0) + returnQty
          await db.sale_items.update(item.id, { returned_qty: newRetQty })

          // 2. Queue the update
          await db.sync_queue.add({ table: 'sale_items', action: 'UPDATE', data: { id: item.id, returned_qty: newRetQty }, timestamp: new Date().toISOString() })

          // 3. Update local stock / phone
          if (item.phone_id && db.phones) {
            await db.phones.update(item.phone_id, { status: 'in_stock', sale_id: null, sold_at: null })
            await db.sync_queue.add({ table: 'phones', action: 'UPDATE', data: { id: item.phone_id, status: 'in_stock', sale_id: null, sold_at: null }, timestamp: new Date().toISOString() })
          } else if (item.product_id) {
            const localProd = await db.products.get(item.product_id)
            const newStock = (localProd?.stock_quantity || 0) + returnQty
            await db.products.update(item.product_id, { stock_quantity: newStock })
            await db.sync_queue.add({ table: 'products', action: 'UPDATE', data: { id: item.product_id, stock_quantity: newStock }, timestamp: new Date().toISOString() })
          }
        }

        // Update local Sale total
        const newSaleTotal = Math.max(0, (selectedSale.total_amount || 0) - totalReturnAmount)
        await db.sales.update(selectedSale.id, { total_amount: newSaleTotal })
        await db.sync_queue.add({ table: 'sales', action: 'UPDATE', data: { id: selectedSale.id, total_amount: newSaleTotal }, timestamp: new Date().toISOString() })

        alert('Offline mode: Return processed locally. Stock and Invoice updated! 🔄')
        setReturning(false)
        setReturnQtys({})
        setSelectedSale({ ...selectedSale, total_amount: newSaleTotal })
        // Reflect updated returned_qty in modal items
        const localUpdated = await db.sale_items.where({ sale_id: selectedSale.id }).toArray().catch(() => [])
        const [lPhones, lProducts] = await Promise.all([
          db.phones ? db.phones.toArray() : [],
          db.products ? db.products.toArray() : []
        ])
        if (localUpdated.length > 0) setSaleItems(localUpdated.map(it => normalizeSaleItem(it, lPhones, lProducts)))
        fetchSales()
      } else {
        alert('Error processing return: ' + errMsg)
        setReturning(false)
      }
    }
  }

  const printInvoice = (sale, items) => {
    const sid = user?.shop_id
    const savedSettings = (() => {
      try { return JSON.parse((sid ? localStorage.getItem(`shop_settings_${sid}`) : null) || '{}') } catch (_) { return {} }
    })()
    const freshLogo = (sid ? localStorage.getItem(`shop_logo_${sid}`) : null) || savedSettings.logo_url || shopSettings.logo_url || ''
    const mergedSettings = {
      ...shopSettings,
      ...savedSettings,
      logo_url: freshLogo,
      shop_id: sid,
      print_template: (sid ? localStorage.getItem(`print_template_${sid}`) : null) || savedSettings.print_template || localStorage.getItem('print_template') || '2'
    }
    mergedSettings.name = (sid ? localStorage.getItem(`shop_name_${sid}`) : null) || mergedSettings.name || 'EdgeX POS'

    // Format items matching billTemplates expectations
    const formattedItems = items.map(i => {
      const returnedQty = i.returned_qty || 0
      const netQty = i.quantity - returnedQty
      const baseName = i.display_name || i.product_name || i.products?.name || (i.phones ? `${i.phones.brand && i.phones.brand !== 'Unknown' ? i.phones.brand + ' ' : ''}${i.phones.model || 'Phone'}`.trim() : 'Item')
      const imeiNote = i.imei ? ` [${i.imei}]` : ''
      const returnNote = returnedQty > 0 ? ` (Returned: ${returnedQty})` : ''
      return {
        name: `${baseName}${imeiNote}${returnNote}`,
        qty: netQty,
        price: Number(i.unit_price || i.price || 0),
        sku: i.imei || i.products?.sku || '',
        brand: i.phones?.brand || i.products?.brand || ''
      }
    })

    const subtotal = items.reduce((sum, item) => sum + (Number(item.unit_price || item.price || 0) * (item.quantity - (item.returned_qty || 0))), 0)
    const discount = Number(sale.discount || 0)
    const total = Math.max(0, subtotal - discount)
    const change = sale.payment_details?.change || 0

    // Construct customer object matching billTemplates expectations
    const customer = sale.customers ? {
      name: sale.customers.name,
      phone: sale.customers.phone || '',
      address: sale.customers.address || ''
    } : null

    const payload = {
      sale: {
        id: sale.id,
        created_at: sale.created_at,
        paid_amount: sale.amount_paid,
        created_by: sale.users?.username || 'Staff',
        payment_type: sale.payment_type || sale.payment_method
      },
      customer,
      walkInName: !customer ? (sale.customer_name || 'Walk-in') : null,
      items: formattedItems,
      subtotal,
      totalDiscount: discount,
      total,
      change
    }

    const html = buildBillHTML(payload, sale.sale_type === 'quotation', mergedSettings)
    printHTML(html)
  }

  const renderPaymentBadge = (sale) => {
    const pt = (sale.payment_type || sale.payment_method || 'cash').toLowerCase()
    if (pt === 'cash') {
      return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-700">💵 Cash</span>
    }
    if (pt === 'credit') {
      return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-700">📒 Credit</span>
    }
    if (pt === 'split') {
      return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-700">🔀 Split</span>
    }
    const label = pt.charAt(0).toUpperCase() + pt.slice(1)
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-800">📱 {label}</span>
  }

  const exportToExcel = () => {
    if (!filtered.length) {
      alert('No sales to export')
      return
    }
    const data = filtered.map(s => {
      const items = (s.sale_items || []).map(it => {
        const name = it.display_name || it.product_name || 'Item'
        const imei = it.imei ? ` [IMEI: ${it.imei}]` : ''
        return `${name}${imei} x${it.quantity || 1}`
      }).join(', ') || 'Direct Sale'

      return {
        'Invoice ID': (s.sale_type === 'quotation' ? 'QT-' : '#') + String(s.id).slice(-8),
        'Customer': s.customers?.name || s.customer_name || 'Walk-in',
        'Phone / Items': items,
        'Total Amount': (Number(s.total_amount) - Number(s.discount || 0)).toFixed(0),
        'Type': s.sale_type === 'quotation' ? 'Quotation' : 'Sale',
        'Payment': (s.payment_type || s.payment_method || 'cash').toUpperCase(),
        'Date': new Date(s.created_at).toLocaleDateString('en-PK')
      }
    })
    const ws = XLSX.utils.json_to_sheet(data)
    ws['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 45 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sales')
    XLSX.writeFile(wb, `SalesHistory_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const filtered = sales.filter(s => {
    const q = search.trim().toLowerCase()
    const matchesItems = !q ? true : (s.sale_items || []).some(it => {
      const name = (it.display_name || it.product_name || '').toLowerCase()
      const imei1 = (it.imei || '').toLowerCase()
      const imei2 = (it.imei2 || '').toLowerCase()
      const specs = (it.specs || '').toLowerCase()
      return name.includes(q) || imei1.includes(q) || imei2.includes(q) || specs.includes(q)
    })
    const matchSearch = !q ? true : (
      (s.customers?.name || s.customer_name || 'walk-in').toLowerCase().includes(q) ||
      String(s.id).toLowerCase().includes(q) ||
      matchesItems
    )
    const matchType = typeFilter !== 'all' ? s.sale_type === typeFilter : true
    const sPay = (s.payment_type || s.payment_method || 'cash').toLowerCase()
    const matchPayment = paymentFilter !== 'all' ? (
      paymentFilter === 'cash' ? sPay === 'cash' :
      paymentFilter === 'credit' ? sPay === 'credit' :
      paymentFilter === 'split' ? sPay === 'split' :
      paymentFilter === 'online' ? (sPay !== 'cash' && sPay !== 'credit' && sPay !== 'split' && sPay !== 'quotation') :
      sPay === paymentFilter
    ) : true
    const matchDate = dateFilter ? s.created_at?.startsWith(dateFilter) : true
    return matchSearch && matchType && matchPayment && matchDate
  })

  const requestDelete = (ids) => {
    setPendingDeleteIds(ids)
    setShowPasswordModal(true)
  }

  const executeDelete = async () => {
    setShowPasswordModal(false)
    const ids = pendingDeleteIds
    setPendingDeleteIds([])

    let successCount = 0
    let failCount = 0
    const successfulIds = []

    for (const id of ids) {
      const item = sales.find(s => s.id === id)
      if (!item) continue
      try {
        if (navigator.onLine) {
          // Cascade: delete sale_items first, then sale
          await supabase.from('sale_items').delete().eq('sale_id', id)
          const { error } = await supabase.from('sales').delete().eq('id', id)
          if (error) {
            console.error('Delete failed:', error)
            failCount++
            continue
          }
        } else {
          // Offline: queue both deletions
          const localItems = await db.sale_items.where({ sale_id: id }).toArray().catch(() => [])
          for (const it of localItems) {
            await db.sale_items.delete(it.id)
            await addToSyncQueue('sale_items', 'DELETE', { id: it.id })
          }
          await addToSyncQueue('sales', 'DELETE', { id })
        }
        // Remove from local IndexedDB
        await db.sale_items.where({ sale_id: id }).delete().catch(() => {})

        await moveToTrash('sales', id, item, user.id, user.shop_id)
        await db.sales.delete(id)
        successfulIds.push(id)
        successCount++
      } catch (err) {
        console.error('Delete error:', err)
        failCount++
      }
    }

    setSales(prev => prev.filter(s => !successfulIds.includes(s.id)))
    setSelected([])

    if (failCount > 0) {
      alert(`⚠️ Partially completed.\n✅ Deleted: ${successCount}\n❌ Failed: ${failCount}\n\n👉 Yeh sales mein payments ya ledger entries linked hain.\n\nSahi order:\n1. Pehle Sale Items delete karein (Trash Bin > Sale Items filter)\n2. Phir yeh sales delete ho jayengi`)
    } else if (successCount > 0) {
      alert(`🗑️ ${successCount} sale(s) moved to Trash!`)
    }
    fetchSales()
  }

  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleSelectAll = () => {
    if (selected.length === filtered.length) setSelected([])
    else setSelected(filtered.map(x => x.id))
  }

  return (
    <>
      <div>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <h1 className="text-2xl font-bold text-gray-800">📜 Sales History</h1>
          <div className="flex gap-2 flex-wrap items-center">
            {filtered.length > 0 && (
              <button onClick={exportToExcel} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition font-bold text-sm shadow-xs flex items-center gap-1.5 cursor-pointer">
                📥 Export Excel
              </button>
            )}
            {selected.length > 0 && (
              <button onClick={() => requestDelete(selected)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl transition font-bold text-sm">
                🗑️ Delete Selected ({selected.length})
              </button>
            )}
          </div>
        </div>
        {/* Filters */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center flex-wrap">
          <div className="flex gap-4 w-full sm:w-auto">
            <input
              type="text"
              placeholder="Search invoice, customer, model, IMEI..."
              className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2 w-full sm:w-auto overflow-x-auto pb-1 items-center">
            <select className="px-4 py-2 border rounded-lg outline-none flex-shrink-0" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="all">All Types</option>
              <option value="quotation">Quotations Only</option>
              <option value="sale">Sales Only</option>
            </select>
            <select className="px-4 py-2 border rounded-lg outline-none flex-shrink-0 bg-white text-sm" value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)}>
              <option value="all">All Payments</option>
              <option value="cash">💵 Cash Only</option>
              <option value="online">📱 Online / Bank</option>
              <option value="credit">📒 Credit Only</option>
              <option value="split">🔀 Split Payment</option>
            </select>
            <input
              type="date"
              className="px-4 py-2 border rounded-lg outline-none w-[140px] flex-shrink-0"
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading sales...</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-lg">No sales found</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            {/* Mobile View */}
            <div className="divide-y divide-gray-100 md:hidden">
              {filtered.map(sale => {
                const isExpanded = expandedSales.has(sale.id)
                const items = sale.sale_items || []
                const firstItem = items[0]
                const firstPhoneName = firstItem ? (firstItem.display_name || firstItem.product_name || 'Item') : null

                return (
                  <div key={sale.id} className={`p-4 ${selected.includes(sale.id) ? 'bg-blue-50' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-xs font-bold text-gray-500">
                            {sale.sale_type === 'quotation' ? 'QT-' : '#'}{String(sale.id).slice(-8)}
                          </p>
                          <span className={`px-2 py-0.2 rounded-full text-[10px] font-medium ${sale.sale_type === 'quotation' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>
                            {sale.sale_type === 'quotation' ? '📄 Quotation' : '🧾 Sale'}
                          </span>
                        </div>
                        <p className="mt-1 truncate font-bold text-gray-900">
                          {sale.customers?.name || sale.customer_name || 'Walk-in'}
                        </p>

                        {/* Phone / Item display */}
                        {items.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-gray-800 text-xs">
                              📱 {firstPhoneName}
                            </span>
                            {items.length > 1 && (
                              <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-1.5 py-0.2 rounded-full">
                                +{items.length - 1} more
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleExpand(sale.id)}
                              className="text-[11px] font-bold text-blue-600 hover:text-blue-800 underline inline-flex items-center gap-0.5 ml-1 cursor-pointer"
                            >
                              <span>{isExpanded ? 'Hide Details' : 'Details'}</span>
                              <span className={`text-[9px] transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                            </button>
                          </div>
                        ) : null}

                        <p className="mt-1 text-xs text-gray-400">{new Date(sale.created_at).toLocaleDateString('en-PK')}</p>
                      </div>
                      <input type="checkbox" checked={selected.includes(sale.id)} onChange={() => toggleSelect(sale.id)} className="mt-1 h-4 w-4 rounded" />
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-lg font-black text-gray-900">
                          Rs. {(Number(sale.total_amount) - Number(sale.discount || 0)).toFixed(0)}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1.5 items-center">
                          {renderPaymentBadge(sale)}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => openSale(sale)} className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-bold text-blue-600 cursor-pointer">View</button>
                        <button onClick={() => requestDelete([sale.id])} className="rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600 cursor-pointer">Delete</button>
                      </div>
                    </div>

                    {/* Mobile Expandable Phone Details Accordion */}
                    {isExpanded && items.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-blue-100 bg-blue-50/50 -mx-4 -mb-4 p-3.5 rounded-b-xl space-y-2">
                        <div className="flex items-center justify-between text-xs font-bold text-blue-900 border-b border-blue-200/60 pb-1.5">
                          <span>📱 Items in Sale ({items.length})</span>
                          <span className="font-mono text-[10px] text-gray-500">#{String(sale.id).slice(-8)}</span>
                        </div>
                        <div className="space-y-2">
                          {items.map((it, iidx) => {
                            const name = it.display_name || it.product_name || 'Item'
                            const specs = it.specs
                            const imei = it.imei
                            const imei2 = it.imei2
                            const rate = it.unit_price || it.price || 0
                            const qty = it.quantity || 1
                            const returnedQty = it.returned_qty || 0
                            const netQty = qty - returnedQty
                            const fullyReturned = netQty <= 0

                            return (
                              <div key={iidx} className={`p-2.5 rounded-lg border text-xs space-y-1 shadow-2xs ${fullyReturned ? 'bg-red-50/60 border-red-200' : 'bg-white border-blue-100/80'}`}>
                                <div className="flex items-start justify-between gap-1">
                                  <p className="font-bold text-gray-900">{name}</p>
                                  {fullyReturned ? (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded-full font-bold uppercase shrink-0 bg-red-100 text-red-700">
                                      Returned
                                    </span>
                                  ) : (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded-full font-bold uppercase shrink-0 bg-green-100 text-green-700">
                                      Sold
                                    </span>
                                  )}
                                </div>
                                {specs && <p className="text-[11px] text-gray-500">{specs}</p>}
                                {(imei || imei2) && (
                                  <div className="flex flex-wrap items-center gap-1">
                                    {imei && (
                                      <span className="font-mono text-[10px] bg-blue-50 text-blue-800 border border-blue-200/60 px-1.5 py-0.2 rounded">
                                        IMEI: {imei}
                                      </span>
                                    )}
                                    {imei2 && (
                                      <span className="font-mono text-[10px] bg-gray-50 text-gray-600 border border-gray-200 px-1 py-0.2 rounded">
                                        IMEI 2: {imei2}
                                      </span>
                                    )}
                                  </div>
                                )}
                                <div className="flex justify-between items-center pt-1 border-t border-gray-100 text-[11px]">
                                  <span className="text-gray-500">
                                    Qty: {netQty} {returnedQty > 0 && <span className="text-red-500 font-bold">(-{returnedQty})</span>}
                                  </span>
                                  <span className="font-bold text-gray-900">Rs. {Number(rate).toLocaleString()}</span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Desktop Table View */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 w-10"><input type="checkbox" checked={selected.length === filtered.length && filtered.length > 0} onChange={toggleSelectAll} className="w-4 h-4 rounded cursor-pointer" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Invoice ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Phone / Items</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Total</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Type / Payment</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filtered.map(sale => {
                    const isExpanded = expandedSales.has(sale.id)
                    const items = sale.sale_items || []
                    const firstItem = items[0]
                    const firstPhoneName = firstItem ? (firstItem.display_name || firstItem.product_name || 'Item') : null

                    return (
                      <React.Fragment key={sale.id}>
                        <tr className={`hover:bg-gray-50 ${selected.includes(sale.id) ? 'bg-blue-50' : ''}`}>
                          <td className="px-4 py-3"><input type="checkbox" checked={selected.includes(sale.id)} onChange={() => toggleSelect(sale.id)} className="w-4 h-4 rounded cursor-pointer" /></td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-600 font-bold whitespace-nowrap">
                            {sale.sale_type === 'quotation' ? 'QT-' : '#'}{String(sale.id).slice(-8)}
                          </td>
                          <td className="px-4 py-3 text-gray-800 whitespace-nowrap">
                            {sale.customers?.name || sale.customer_name || <span className="text-gray-400 italic">Walk-in</span>}
                          </td>
                          <td className="px-4 py-3">
                            {items.length > 0 ? (
                              <div className="flex flex-col gap-1 max-w-xs">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold text-gray-900 text-xs">
                                    {firstPhoneName}
                                  </span>
                                  {items.length > 1 && (
                                    <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-1.5 py-0.2 rounded-full shrink-0">
                                      +{items.length - 1} more
                                    </span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(sale.id)}
                                  className={`inline-flex items-center gap-1 text-[11px] font-bold transition w-fit cursor-pointer ${
                                    isExpanded ? 'text-blue-700 underline' : 'text-blue-600 hover:text-blue-800'
                                  }`}
                                  title="Click to view full phone details, specs, and IMEI"
                                >
                                  <span>{isExpanded ? 'Hide Details' : 'Details'}</span>
                                  <span className={`text-[9px] transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                                </button>
                              </div>
                            ) : (
                              <span className="text-gray-400 text-xs italic">Direct Sale</span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">
                            Rs. {(Number(sale.total_amount) - Number(sale.discount || 0)).toFixed(0)}
                            {sale.discount > 0 && <span className="text-xs text-gray-400 ml-1">(disc: {sale.discount})</span>}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex flex-col gap-1 items-start">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium w-fit ${sale.sale_type === 'quotation' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>
                                {sale.sale_type === 'quotation' ? '📄 Quotation' : '🧾 Sale'}
                              </span>
                              {renderPaymentBadge(sale)}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-sm whitespace-nowrap">{new Date(sale.created_at).toLocaleDateString('en-PK')}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex gap-2">
                              <button onClick={() => openSale(sale)}
                                className="text-blue-500 hover:text-blue-700 text-sm font-medium cursor-pointer">View</button>
                              <button onClick={() => requestDelete([sale.id])}
                                className="text-red-500 hover:text-red-700 text-sm font-medium cursor-pointer">Delete</button>
                            </div>
                          </td>
                        </tr>

                        {/* Desktop Expandable Phone Details Accordion */}
                        {isExpanded && (
                          <tr className="bg-gradient-to-r from-blue-50/70 via-indigo-50/40 to-blue-50/70 border-b border-blue-200/80">
                            <td colSpan="8" className="px-6 py-4">
                              <div className="flex flex-col gap-3">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-200/60 pb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-black uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
                                      📱 Phones / Items in {sale.sale_type === 'quotation' ? 'QT-' : '#'}{String(sale.id).slice(-8)}
                                    </span>
                                    <span className="text-xs bg-white text-blue-800 px-2 py-0.5 rounded-full border border-blue-200 font-bold shadow-2xs">
                                      {items.length} item(s)
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 text-xs">
                                    <span className="text-gray-500 font-medium">Customer:</span>
                                    <span className="font-bold text-gray-800">{sale.customers?.name || sale.customer_name || 'Walk-in'}</span>
                                    <span className="text-gray-300">|</span>
                                    <span className="text-gray-500 font-medium">Payment:</span>
                                    {renderPaymentBadge(sale)}
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                  {items.map((it, iidx) => {
                                    const name = it.display_name || it.product_name || 'Item'
                                    const specs = it.specs
                                    const imei = it.imei
                                    const imei2 = it.imei2
                                    const rate = it.unit_price || it.price || 0
                                    const qty = it.quantity || 1
                                    const returnedQty = it.returned_qty || 0
                                    const netQty = qty - returnedQty
                                    const fullyReturned = netQty <= 0

                                    return (
                                      <div key={iidx} className={`rounded-xl p-3 border shadow-2xs hover:shadow-xs transition flex flex-col justify-between gap-2 ${
                                        fullyReturned ? 'bg-red-50/50 border-red-200' : 'bg-white border-blue-100'
                                      }`}>
                                        <div>
                                          <div className="flex items-start justify-between gap-2">
                                            <h4 className="font-bold text-gray-900 text-xs sm:text-sm">{name}</h4>
                                            {fullyReturned ? (
                                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 bg-red-100 text-red-700">
                                                Returned
                                              </span>
                                            ) : (
                                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 bg-green-100 text-green-700">
                                                Sold
                                              </span>
                                            )}
                                          </div>
                                          {specs && (
                                            <p className="text-xs text-gray-500 font-medium mt-1">
                                              {specs}
                                            </p>
                                          )}
                                          {(imei || imei2) && (
                                            <div className="mt-2 flex flex-wrap gap-1 items-center">
                                              {imei && (
                                                <span className="font-mono text-[10px] bg-blue-50 text-blue-800 border border-blue-200/60 px-1.5 py-0.5 rounded">
                                                  IMEI: {imei}
                                                </span>
                                              )}
                                              {imei2 && (
                                                <span className="font-mono text-[10px] bg-gray-50 text-gray-600 border border-gray-200 px-1.5 py-0.5 rounded">
                                                  IMEI 2: {imei2}
                                                </span>
                                              )}
                                            </div>
                                          )}
                                        </div>

                                        <div className="flex items-center justify-between border-t border-gray-100 pt-2 mt-1 text-xs">
                                          <span className="text-gray-500">
                                            Qty: <span className="font-semibold text-gray-800">{netQty}</span>
                                            {returnedQty > 0 && <span className="text-red-500 font-bold ml-1">(-{returnedQty})</span>}
                                          </span>
                                          <span className="font-black text-gray-900">
                                            Rs. {Number(rate).toLocaleString()}
                                          </span>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
        }

        {/* Sale Detail Modal */}
        {
          selectedSale && (
            <div className="fixed inset-0 bg-black bg-opacity-40 flex items-start sm:items-center justify-center z-50 overflow-y-auto py-4 px-2 sm:px-4">
              <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-2xl max-h-[90dvh] overflow-y-auto">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-gray-800">
                      {selectedSale.sale_type === 'quotation' ? 'Quotation QT-' : 'Invoice #'}
                      {String(selectedSale.id).slice(-8)}
                    </h2>
                    <p className="text-sm text-gray-500">
                      {new Date(selectedSale.created_at).toLocaleString('en-PK')} |
                      {selectedSale.customers?.name || selectedSale.customer_name || ' Walk-in'} |
                      <span className={selectedSale.payment_type === 'cash' ? ' text-green-600' : ' text-orange-600'}>
                        {' '}{selectedSale.payment_type?.toUpperCase()}
                      </span>
                    </p>
                  </div>
                  <button onClick={() => setSelectedSale(null)} className="text-gray-400 hover:text-gray-600 text-xl cursor-pointer">×</button>
                </div>

                {loadingItems ? <p className="text-gray-500 text-center py-8">Loading...</p> : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full mb-4 text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs text-gray-500 whitespace-nowrap">Product / Phone</th>
                            <th className="px-3 py-2 text-right text-xs text-gray-500 whitespace-nowrap">Orig. Qty</th>
                            <th className="px-3 py-2 text-right text-xs text-red-400 whitespace-nowrap">Returned</th>
                            <th className="px-3 py-2 text-right text-xs text-green-600 whitespace-nowrap">Net Qty</th>
                            <th className="px-3 py-2 text-right text-xs text-gray-500 whitespace-nowrap">Rate</th>
                            <th className="px-3 py-2 text-right text-xs text-gray-500 whitespace-nowrap">Net Amount</th>
                            <th className="px-3 py-2 text-center text-xs text-gray-500 whitespace-nowrap">Return Qty</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {saleItems.map(item => {
                            const returnedQty = item.returned_qty || 0
                            const netQty = item.quantity - returnedQty
                            const netAmount = netQty * Number(item.unit_price)
                            const maxReturn = netQty
                            const fullyReturned = netQty <= 0
                            return (
                              <tr key={item.id} className={fullyReturned ? 'bg-red-50/40 opacity-60' : ''}>
                                <td className="px-3 py-2 text-gray-800">
                                  <div className="font-bold text-gray-900">
                                    {item.display_name || item.product_name || 'Item'}
                                    {fullyReturned && <span className="ml-2 text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold uppercase">Fully Returned</span>}
                                  </div>
                                  {item.specs && <p className="text-xs text-gray-500 mt-0.5">{item.specs}</p>}
                                  {(item.imei || item.imei2) && (
                                    <div className="flex flex-wrap items-center gap-1 mt-1">
                                      {item.imei && (
                                        <span className="font-mono text-[10px] bg-blue-50 text-blue-800 border border-blue-200/60 px-1.5 py-0.2 rounded">
                                          IMEI: {item.imei}
                                        </span>
                                      )}
                                      {item.imei2 && (
                                        <span className="font-mono text-[10px] bg-gray-50 text-gray-600 border border-gray-200 px-1 py-0.2 rounded">
                                          IMEI 2: {item.imei2}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right text-gray-400 whitespace-nowrap">{item.quantity}</td>
                                <td className="px-3 py-2 text-right text-red-500 font-medium whitespace-nowrap">
                                  {returnedQty > 0 ? `- ${returnedQty}` : '—'}
                                </td>
                                <td className="px-3 py-2 text-right font-bold text-gray-800 whitespace-nowrap">{netQty}</td>
                                <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">Rs. {Number(item.unit_price).toFixed(0)}</td>
                                <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                                  Rs. {netAmount.toFixed(0)}
                                  {returnedQty > 0 && (
                                    <div className="text-[10px] text-gray-400 font-normal">
                                      orig: Rs. {(item.quantity * Number(item.unit_price)).toFixed(0)}
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-center whitespace-nowrap">
                                  {maxReturn > 0 ? (
                                    <input type="number" min="0" max={maxReturn}
                                      value={returnQtys[item.id] || ''}
                                      onChange={e => setReturnQtys(prev => ({ ...prev, [item.id]: e.target.value }))}
                                      className="w-16 border rounded px-2 py-1 text-center text-sm" placeholder="0" />
                                  ) : <span className="text-xs text-gray-400">Done</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:justify-between sm:items-center">
                      <div className="text-sm text-gray-600">
                        <p>Total: <b>Rs. {(Number(selectedSale.total_amount) - Number(selectedSale.discount || 0)).toFixed(0)}</b></p>
                        {selectedSale.discount > 0 && <p className="text-xs text-gray-400">Discount: Rs. {selectedSale.discount}</p>}
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                        {selectedSale.sale_type !== 'quotation' && (
                          <div className="flex flex-wrap items-center gap-3 bg-gray-50 border px-3 py-1.5 rounded-lg sm:mr-2">
                            <span className="text-[10px] font-bold text-gray-400 uppercase">Refund Type:</span>
                            <label className="flex items-center gap-1 text-sm cursor-pointer">
                              <input type="radio" checked={refundType === 'cash'} onChange={() => setRefundType('cash')} className="w-4 h-4 text-blue-600" />
                              💵 Cash
                            </label>
                            {selectedSale.customer_id && (
                              <label className="flex items-center gap-1 text-sm cursor-pointer">
                                <input type="radio" checked={refundType === 'credit'} onChange={() => setRefundType('credit')} className="w-4 h-4 text-orange-600" />
                                📒 Ledger
                              </label>
                            )}
                          </div>
                        )}
                        {selectedSale.sale_type === 'quotation' && (
                          <button onClick={() => navigate(`/pos?convertQuote=${selectedSale.id}`)}
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm transition font-bold cursor-pointer">
                            🛒 Convert to Sale
                          </button>
                        )}
                        <button onClick={() => printInvoice(selectedSale, saleItems)}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition cursor-pointer">
                          🖨️ Print {selectedSale.sale_type === 'quotation' ? 'Quotation' : 'Invoice'}
                        </button>
                        {selectedSale.sale_type !== 'quotation' && (
                          <button onClick={handleReturn} disabled={returning}
                            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm transition disabled:opacity-50 cursor-pointer">
                            {returning ? 'Processing...' : '↩️ Process Return'}
                          </button>
                        )}
                        <button onClick={() => setSelectedSale(null)}
                          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition cursor-pointer">
                          Close
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )
        }
      </div>

      {showPasswordModal && (
        <PasswordModal
          title="Delete Sale(s)"
          message={`${pendingDeleteIds.length} sale(s) will be moved to Trash`}
          onConfirm={executeDelete}
          onCancel={() => { setShowPasswordModal(false); setPendingDeleteIds([]) }}
        />
      )}
    </>
  )
}

export default Sales
