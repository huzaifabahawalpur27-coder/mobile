import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, CalendarDays, Search, ListChecks, Trash2, X } from 'lucide-react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db, addToSyncQueue, moveToTrash } from '../services/db'
import { fetchAll } from '../services/fetchAll'
import { recordAuditLog } from '../services/auditService'
import PasswordModal from '../components/PasswordModal'
import { Button } from '../components/ui'
import { printHTML } from '../utils/printUtils'
import { buildBillHTML } from '../utils/billTemplates'
import { getBankAccounts, reverseSaleFromAccounts } from '../services/bankService'
import { computeReturn, isCountedSale, saleBalanceEffect } from '../utils/moneyMath'
import { applyMoneyOp, accountForMode } from '../services/moneyOps'
import { returnSaleItemBatches } from '../services/batchService'
import { adjustProductStock, adjustCustomerBalance, releasePhoneFromSale } from '../services/atomicOps'
import { notify } from '../utils/toast'
import { normalizeInvoiceToken, fetchServerInvoiceToken } from '../services/whatsappQueueService'
import { getPeriod, RANGES } from './reports/period'
import { rs, pct, plural } from './reports/format'
import { Choice } from './reports/ui'
import { normalizeSaleItem, recoverSaleItems, saleFigures, invoiceLabel, paymentLabel, customerName, isQuotation } from './sales/saleItems'
import SalesList from './sales/SalesList'
import SaleDetail from './sales/SaleDetail'

const selectCls = 'min-h-[40px] px-3 rounded-full bg-white dark:bg-[#1c1c1e] border border-black/[0.08] dark:border-white/[0.1] text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-[#0071e3]'

const matchesPayment = (s, f) => {
  if (f === 'all') return true
  const p = String(s.payment_type || s.payment_method || 'cash').toLowerCase()
  if (f === 'online') return !['cash', 'credit', 'split', 'quotation'].includes(p)
  return p === f
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
  const [search, setSearch] = useState('')
  const [range, setRange] = useState('week')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [typeFilter, setTypeFilter] = useState('sale')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [refundType, setRefundType] = useState('cash') // 'cash' or 'credit'
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState([])
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [pendingDeleteIds, setPendingDeleteIds] = useState([])
  const [shopSettings, setShopSettings] = useState({})

  const period = useMemo(() => getPeriod(range, customStart, customEnd), [range, customStart, customEnd])

  useEffect(() => {
    if (user?.shop_id) fetchShopSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.shop_id])

  useEffect(() => {
    if (user?.shop_id) fetchSales()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.shop_id, period])

  const fetchShopSettings = async () => {
    // Read from shop-scoped localStorage first for instant load
    const sid = user?.shop_id
    const cached = sid ? localStorage.getItem(`shop_settings_${sid}`) : null
    if (cached) {
      try { setShopSettings(JSON.parse(cached)) } catch { /* ignore a bad cache */ }
    }
    try {
      if (!navigator.onLine) throw new Error('Offline')
      const { data } = await supabase.from('shops').select('*').eq('id', user.shop_id).maybeSingle()
      if (data) setShopSettings(prev => ({ ...prev, ...data }))
    } catch {
      console.log('Sales: Using cached shop settings')
    }
  }

  // The sales of the chosen period: first from this device (instant), then from the server
  // page by page, so no sale is left out however many there are
  const fetchSales = async () => {
    if (!user?.shop_id) { setLoading(false); return }
    const sid = String(user.shop_id)
    const { start, end } = period
    const inPeriod = (s) => { const t = new Date(s.created_at); return t >= start && t <= end }
    setLoading(true)

    const fromDevice = async (remotePhones = []) => {
      const [localData, lItems, lPhones, lProducts] = await Promise.all([
        db.sales.toArray(),
        db.sale_items ? db.sale_items.toArray() : [],
        db.phones ? db.phones.toArray() : [],
        db.products ? db.products.toArray() : []
      ])
      // the server's copy of a phone first (it has any corrected cost), then this device's
      const phones = [...remotePhones, ...lPhones]
      return localData
        .filter(x => String(x.shop_id) === sid && inPeriod(x))
        .map(s => {
          let items = (s.sale_items && s.sale_items.length > 0) ? s.sale_items : lItems.filter(i => String(i.sale_id) === String(s.id))
          items = recoverSaleItems(s, items, phones)
          return { ...s, sale_items: items.map(it => normalizeSaleItem(it, phones, lProducts, s.created_at)) }
        })
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    }

    try {
      const local = await fromDevice()
      setSales(local)
      if (local.length > 0) setLoading(false)
    } catch (localErr) {
      console.warn('Sales: Local DB read failed:', localErr)
    }

    if (!navigator.onLine) { setLoading(false); return }

    try {
      const work = Promise.all([
        fetchAll(() => supabase.from('sales')
          .select('*, customers(name, phone), sale_items(*, phones(*), products(name, cost_price))')
          .eq('shop_id', user.shop_id)
          .gte('created_at', start.toISOString())
          .lte('created_at', end.toISOString()), { required: true }),
        // all columns: purchase_date and sold_at exist only on some databases
        fetchAll(() => supabase.from('phones').select('*').eq('shop_id', user.shop_id).not('sale_id', 'is', null))
      ])
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
      const [salesRes, phonesRes] = await Promise.race([work, timeout])
      const remotePhones = phonesRes?.data || []
      if (salesRes.data) {
        const cleanData = JSON.parse(JSON.stringify(salesRes.data)).map(s => ({
          ...s,
          sale_items: recoverSaleItems(s, s.sale_items || [], remotePhones).map(it => normalizeSaleItem(it, remotePhones, [], s.created_at))
        }))
        await db.sales.bulkPut(cleanData)
        const allItems = cleanData.flatMap(s => s.sale_items || [])
        if (allItems.length > 0) await db.sale_items.bulkPut(allItems).catch(() => {})
      }
      setSales(await fromDevice(remotePhones))
    } catch (err) {
      console.warn('Sales: Supabase fetch failed, continuing with local DB:', err)
    } finally {
      setLoading(false)
    }
  }

  const openSale = async (sale) => {
    setSelectedSale(sale)
    setLoadingItems(true)
    setReturnQtys({})
    setRefundType('cash')
    try {
      let items = []
      const [lPhones, lProducts] = await Promise.all([
        db.phones ? db.phones.toArray() : [],
        db.products ? db.products.toArray() : []
      ])
      if (navigator.onLine) {
        const { data } = await supabase.from('sale_items').select('*, products(name, cost_price), phones(*)').eq('sale_id', sale.id)
        if (data && data.length > 0) {
          items = data.map(it => normalizeSaleItem(it, lPhones, lProducts, sale.created_at))
        } else {
          // No lines saved: rebuild them from the phones linked to the sale
          const { data: linkedPhones } = await supabase.from('phones').select('*').eq('sale_id', sale.id)
          items = recoverSaleItems(sale, [], linkedPhones || []).map(it => normalizeSaleItem(it, linkedPhones || [], lProducts, sale.created_at))
        }
      }
      if (items.length === 0) {
        if (sale.sale_items && sale.sale_items.length > 0) {
          items = sale.sale_items.map(it => normalizeSaleItem(it, lPhones, lProducts, sale.created_at))
        } else {
          const allLocalItems = db.sale_items ? await db.sale_items.toArray() : []
          const localItems = recoverSaleItems(sale, allLocalItems.filter(i => String(i.sale_id) === String(sale.id)), lPhones)
          items = localItems.map(it => normalizeSaleItem(it, lPhones, lProducts, sale.created_at))
        }
      }
      setSaleItems(items)
    } catch (e) {
      console.warn('Sale Items: Fetching fallback error:', e)
      if (sale.sale_items && sale.sale_items.length > 0) setSaleItems(sale.sale_items)
    } finally {
      setLoadingItems(false)
    }
  }

  // Handle return
  const handleReturn = async () => {
    const itemsToReturn = saleItems.filter(i => returnQtys[i.id] > 0)
    if (itemsToReturn.length === 0) { notify('Enter the quantity to return.'); return }

    for (const item of itemsToReturn) {
      const returnQty = parseInt(returnQtys[item.id]) || 0
      const alreadyReturned = item.returned_qty || 0
      const maxReturn = item.quantity - alreadyReturned
      if (returnQty > maxReturn) { notify(`${item.display_name || item.product_name || 'Item'}: only ${maxReturn} can be returned`); return }
    }

    setReturning(true)
    const online = navigator.onLine
    const qtyOf = (item) => parseInt(returnQtys[item.id]) || 0
    const totalReturnAmount = itemsToReturn.reduce((sum, item) => sum + Number(item.unit_price || 0) * qtyOf(item), 0)

    try {
      // Discount given back in proportion; cash handed back never exceeds what was paid
      // on this invoice, the rest comes off the customer's balance
      const ret = computeReturn({ record: selectedSale, grossReturn: totalReturnAmount, toBalance: refundType === 'credit' })
      const cashRefundAmount = ret.cashRefund
      const creditRefundAmount = selectedSale.customer_id ? ret.balanceRefund : 0
      const invoiceTag = String(selectedSale.id).slice(-6)

      // Cash handed back leaves the cash account
      let cashAcc = null
      if (cashRefundAmount > 0) {
        try { cashAcc = accountForMode(await getBankAccounts(user.shop_id), 'cash') } catch (_) { /* no accounts set up */ }
      }

      // Notes on the customer's ledger (they do not move the balance themselves)
      const notes = []
      if (selectedSale.customer_id && creditRefundAmount > 0) {
        notes.push({
          customer_id: selectedSale.customer_id,
          sale_id: selectedSale.id,
          amount: -creditRefundAmount,
          payment_type: 'return',
          note: `Return from Invoice #${invoiceTag} (Net: Rs. ${creditRefundAmount.toLocaleString()} Credited to Balance)`
        })
      }
      if (selectedSale.customer_id && cashRefundAmount > 0) {
        notes.push({
          customer_id: selectedSale.customer_id,
          sale_id: selectedSale.id,
          amount: -cashRefundAmount,
          payment_type: 'refund',
          note: `Cash Refund from Invoice #${invoiceTag} (Net: Rs. ${cashRefundAmount.toLocaleString()})`
        })
      }

      // Returned quantities, invoice totals, stock, customer balance and the cash refund
      // are saved together: all of it, or none of it
      const res = await applyMoneyOp({
        shop_id: user.shop_id,
        updates: [
          ...itemsToReturn.map(item => ({ table: 'sale_items', id: item.id, set: { returned_qty: (Number(item.returned_qty) || 0) + qtyOf(item) } })),
          { table: 'sales', id: selectedSale.id, set: ret.update }
        ],
        inserts: notes.map(n => ({ table: 'customer_payments', row: n })),
        stock: itemsToReturn.filter(item => !item.phone_id && item.product_id).map(item => ({ product_id: item.product_id, delta: qtyOf(item) })),
        customer: creditRefundAmount > 0 ? { id: selectedSale.customer_id, delta: -creditRefundAmount } : null,
        accounts: cashAcc ? [{
          account_id: cashAcc.id,
          delta: -cashRefundAmount,
          reference_type: 'SALE_RETURN',
          reference_id: String(selectedSale.id),
          description: `Sale Return Cash Refund (Invoice #${selectedSale.id})`
        }] : []
      })
      if (!res.ok) throw new Error(res.error || 'Return was not saved')

      // Phones back in stock and FIFO batches restored (each checks its own state)
      for (const item of itemsToReturn) {
        if (item.phone_id) {
          if (online && !res.queued) {
            // Only if the phone still belongs to this sale (not bought back / sold again since)
            const phoneRes = await releasePhoneFromSale(item.phone_id, selectedSale)
            if (phoneRes.skipped) console.warn('Return: phone left unchanged -', phoneRes.skipped)
            else if (!phoneRes.ok) console.error('Return: phone not updated -', phoneRes.error)
          } else if (db.phones) {
            const patch = { status: 'in_stock', sale_id: null, sold_at: null }
            await db.phones.update(item.phone_id, patch).catch(() => {})
            await addToSyncQueue('phones', 'UPDATE', { id: item.phone_id, ...patch })
          }
        } else if (item.product_id && online && !res.queued) {
          try {
            await returnSaleItemBatches({
              saleItemId: item.id,
              returnQty: qtyOf(item),
              fallbackCost: item.cost_price || item.unit_price || 0
            })
          } catch (batchErr) {
            console.warn('[FIFO Return] Batch reversal error:', batchErr)
          }
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
      ).catch?.(() => {})

      if (res.queued) notify('Offline mode: Return processed locally. Stock and Invoice updated! 🔄')
      else if (res.problems?.length) notify(`Return saved, but please check:\n${res.problems.join('\n')}`)
      else notify('Return successful! Invoice updated.')
      setReturnQtys({})

      // Show the updated invoice and lines
      let refreshed = false
      if (online && !res.queued) {
        const { data: updatedSale } = await supabase.from('sales').select('*, customers(name)').eq('id', selectedSale.id).maybeSingle()
        if (updatedSale) setSelectedSale(updatedSale)
        const { data: updatedItems } = await supabase.from('sale_items').select('*, products(name, stock_quantity), phones(*)').eq('sale_id', selectedSale.id)
        if (updatedItems) {
          const cleanItems = JSON.parse(JSON.stringify(updatedItems)).map(it => normalizeSaleItem(it, [], [], selectedSale.created_at))
          await db.sale_items.bulkPut(cleanItems)
          setSaleItems(cleanItems)
          refreshed = true
        }
      }
      if (!refreshed) {
        setSelectedSale({ ...selectedSale, ...ret.update })
        const localUpdated = await db.sale_items.where({ sale_id: selectedSale.id }).toArray().catch(() => [])
        const [lPhones, lProducts] = await Promise.all([
          db.phones ? db.phones.toArray() : [],
          db.products ? db.products.toArray() : []
        ])
        if (localUpdated.length > 0) setSaleItems(localUpdated.map(it => normalizeSaleItem(it, lPhones, lProducts, selectedSale.created_at)))
      }
      fetchSales()
    } catch (err) {
      notify('Error processing return: ' + (err?.message || String(err)))
    } finally {
      setReturning(false)
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

  // The QR-code bill (the same page the customer's link opens), printed from its own tab.
  // A sale without an online bill code (an old sale, or one not yet synced) prints the
  // shop receipt instead.
  const printQrInvoice = async (sale, items) => {
    if (isQuotation(sale)) { printInvoice(sale, items); return }
    // open the tab now: a browser blocks a tab opened after waiting for the server
    const tab = window.open('', '_blank')
    let token = normalizeInvoiceToken(sale.invoice_token) || normalizeInvoiceToken(sale.invoice_number)
    if (!token && navigator.onLine) token = await fetchServerInvoiceToken('sales', sale.id)
    if (!token) {
      tab?.close()
      notify('This sale has no online bill yet (it may still be waiting to sync), so the shop receipt is printed instead.', 'warning')
      printInvoice(sale, items)
      return
    }
    const url = `/invoice/${encodeURIComponent(`INV-${token}`)}?print=1`
    if (tab) tab.location.href = url
    else window.location.assign(url)
  }

  // Excel of the sales shown, with profit worked out the same way as Reports
  const exportToExcel = async () => {
    if (!filtered.length) { notify('No sales to export'); return }
    try {
      const XLSX = await import('xlsx')
      const data = rows.map(({ sale: s, fig }) => ({
        'Invoice': invoiceLabel(s),
        'Date': new Date(s.created_at).toLocaleDateString('en-PK'),
        'Time': new Date(s.created_at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }),
        'Customer': customerName(s),
        'Items': (s.sale_items || []).map(it => `${it.display_name}${it.imei ? ` [IMEI: ${it.imei}]` : ''} x${it.quantity || 1}`).join(', '),
        'Type': isQuotation(s) ? 'Quotation' : 'Sale',
        'Payment': isQuotation(s) ? '' : paymentLabel(s),
        'Total (Rs.)': Math.round(fig.net),
        'Paid (Rs.)': isQuotation(s) ? '' : Math.round(fig.paid),
        'Due (Rs.)': isQuotation(s) ? '' : Math.round(fig.due),
        'Cost (Rs.)': isQuotation(s) || !fig.hasLines ? '' : Math.round(fig.cost),
        'Profit (Rs.)': isQuotation(s) || !fig.hasLines ? '' : Math.round(fig.profit)
      }))
      const ws = XLSX.utils.json_to_sheet(data)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Sales')
      XLSX.writeFile(wb, `Sales_${period.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (err) {
      notify(`Could not make the Excel file: ${err.message}`, 'error')
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sales.filter(s => {
      if (typeFilter === 'sale' && !isCountedSale(s)) return false
      if (typeFilter === 'quotation' && !isQuotation(s)) return false
      if (!matchesPayment(s, paymentFilter)) return false
      if (!q) return true
      if (customerName(s).toLowerCase().includes(q) || invoiceLabel(s).toLowerCase().includes(q) || String(s.id).includes(q)) return true
      return (s.sale_items || []).some(it =>
        `${it.display_name || ''} ${it.imei || ''} ${it.imei2 || ''} ${it.specs || ''}`.toLowerCase().includes(q))
    })
  }, [sales, search, typeFilter, paymentFilter])

  const rows = useMemo(() => filtered.map(sale => ({ sale, fig: saleFigures(sale) })), [filtered])

  // Totals for the sales shown (quotations are not sales)
  const totals = useMemo(() => {
    const counted = rows.filter(r => isCountedSale(r.sale))
    const withLines = counted.filter(r => r.fig.hasLines)
    return {
      count: counted.length,
      units: counted.reduce((s, r) => s + r.fig.units, 0),
      net: counted.reduce((s, r) => s + r.fig.net, 0),
      paid: counted.reduce((s, r) => s + r.fig.paid, 0),
      due: counted.reduce((s, r) => s + r.fig.due, 0),
      revenue: withLines.reduce((s, r) => s + r.fig.revenue, 0),
      profit: withLines.reduce((s, r) => s + r.fig.profit, 0),
      noLines: counted.length - withLines.length,
      issues: counted.reduce((s, r) => s + r.fig.issues, 0)
    }
  }, [rows])

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
        // Rollback inventory and ledger before deleting
        try {
          const { data: saleItems } = await supabase.from('sale_items').select('*').eq('sale_id', id)
          // A quotation (or a voided sale) never took stock, so there is nothing to put back
          if (isCountedSale(item) && saleItems && saleItems.length > 0) {
            for (const si of saleItems) {
              // Restore phone status to in_stock
              if (si.phone_id) {
                // Only if the phone still belongs to this sale (not bought back / sold again since)
                const phoneRes = await releasePhoneFromSale(si.phone_id, item)
                if (phoneRes.skipped) console.warn('Delete sale: phone left unchanged -', phoneRes.skipped)
            else if (!phoneRes.ok) console.error('Delete sale: phone not updated -', phoneRes.error)
              }
              // Restore product stock quantity
              if (si.product_id) {
                const restockQty = (Number(si.quantity) || 0) - (Number(si.returned_qty) || 0)
                const stockRes = await adjustProductStock(si.product_id, restockQty)
                if (!stockRes.ok) console.warn('Could not restore stock for deleted sale item:', si.product_id, stockRes.error)
              }
            }
          }
          if (isCountedSale(item)) {
            // Take off the customer's balance exactly what this sale put on it (bill minus
            // paid), whatever the payment type: a part-paid cash sale adds to it too
            if (item.customer_id) {
              const balRes = await adjustCustomerBalance(item.customer_id, -saleBalanceEffect(item))
              if (!balRes.ok) console.warn('Could not reverse customer balance for deleted sale:', balRes.error)
            }
            // Take the money received back out of the accounts it went into (each tender
            // of a split, and cash received on a credit sale, on its own account)
            try {
              await reverseSaleFromAccounts({
                shopId: user.shop_id,
                sale: item,
                description: `Sale Deletion Reversal (Invoice #${id})`
              })
            } catch (accErr) {
              console.warn('Could not reverse account balance for deleted sale:', accErr)
            }
          }
        } catch (rollbackErr) {
          console.warn('Rollback warning for sale', id, rollbackErr)
        }

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
    setSelecting(false)

    if (failCount > 0) {
      notify(`Only part was deleted: ${successCount} deleted, ${failCount} not deleted.\n\nThese sales still have payments or ledger entries linked to them.\n\nDelete in this order:\n1. Sale items (Trash Bin > Sale Items filter)\n2. Then these sales`)
    } else if (successCount > 0) {
      notify(`${successCount} ${successCount === 1 ? 'sale' : 'sales'} moved to Trash.`)
    }
    fetchSales()
  }

  const toggleSelect = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const toggleSelectAll = () => {
    const ids = rows.map(r => r.sale.id)
    setSelected(prev => (ids.every(id => prev.includes(id)) ? [] : ids))
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto pb-12">
      {/* Title, the dates covered, period and actions */}
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">Sales</h1>
          <p className="mt-1 text-sm text-[#5f6368] dark:text-gray-400 flex items-center gap-1.5">
            <CalendarDays size={15} aria-hidden="true" className="shrink-0" />
            <span><b className="font-semibold text-[#1d1d1f] dark:text-gray-200">{period.name}</b> · {period.dates}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Choice label="Period" value={range} onChange={setRange} options={RANGES} />
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={exportToExcel} disabled={!filtered.length}>
              <Download size={14} aria-hidden="true" /> Excel
            </Button>
            <Button variant="secondary" size="sm" aria-pressed={selecting} onClick={() => { setSelecting(v => !v); setSelected([]) }}>
              {selecting ? <><X size={14} aria-hidden="true" /> Done</> : <><ListChecks size={14} aria-hidden="true" /> Select</>}
            </Button>
            {selecting && selected.length > 0 && (
              <Button variant="danger" size="sm" onClick={() => requestDelete(selected)}>
                <Trash2 size={14} aria-hidden="true" /> Delete {selected.length}
              </Button>
            )}
          </div>
        </div>
      </header>

      {range === 'custom' && (
        <div className="flex flex-wrap items-end gap-3 bg-white dark:bg-[#1c1c1e] rounded-[20px] border border-black/[0.06] dark:border-white/[0.08] p-3.5">
          <label className="text-xs font-semibold text-[#5f6368] dark:text-gray-400">
            From
            <input type="date" value={customStart} max={customEnd || undefined} onChange={e => setCustomStart(e.target.value)}
              className="block mt-1 min-h-[40px] px-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-black/[0.06] dark:border-white/[0.08] text-sm text-[#1d1d1f] dark:text-[#f5f5f7]" />
          </label>
          <label className="text-xs font-semibold text-[#5f6368] dark:text-gray-400">
            To
            <input type="date" value={customEnd} min={customStart || undefined} onChange={e => setCustomEnd(e.target.value)}
              className="block mt-1 min-h-[40px] px-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-black/[0.06] dark:border-white/[0.08] text-sm text-[#1d1d1f] dark:text-[#f5f5f7]" />
          </label>
        </div>
      )}

      {/* Totals for what is shown */}
      <dl className="grid grid-cols-2 sm:grid-cols-5 gap-px rounded-[20px] overflow-hidden border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.06] dark:bg-white/[0.08]">
        {[
          { label: 'Sales', value: totals.count, sub: plural(totals.units, 'item') + ' sold' },
          { label: 'Total', value: rs(totals.net) },
          { label: 'Paid', value: rs(totals.paid) },
          { label: 'Still due', value: rs(totals.due), tone: totals.due > 0 ? 'warn' : '' },
          { label: 'Profit', value: rs(totals.profit), sub: `${pct(totals.profit, totals.revenue)} of sales`, tone: totals.profit < 0 ? 'bad' : 'good' }
        ].map(t => (
          <div key={t.label} className="bg-white dark:bg-[#1c1c1e] px-4 py-3 last:col-span-2 sm:last:col-span-1">
            <dt className="text-xs font-semibold text-[#5f6368] dark:text-gray-400">{t.label}</dt>
            <dd className={`text-lg font-bold tabular-nums ${t.tone === 'good' ? 'text-[#248a3d] dark:text-[#34d399]' : t.tone === 'bad' ? 'text-[#d70015] dark:text-[#ff6b6b]' : t.tone === 'warn' ? 'text-[#a15c00] dark:text-[#fbbf24]' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'}`}>{t.value}</dd>
            {t.sub && <dd className="text-xs text-[#5f6368] dark:text-gray-400">{t.sub}</dd>}
          </div>
        ))}
      </dl>
      {(totals.issues > 0 || totals.noLines > 0) && (
        <p className="text-xs text-[#a15c00] dark:text-[#fbbf24] px-1">
          {totals.issues > 0 && <>{plural(totals.issues, 'item')} {totals.issues === 1 ? 'has' : 'have'} a missing, guessed or too-high cost, so profit may be off. Open the sale, or see Reports › Sold items › “need checking”. </>}
          {totals.noLines > 0 && <>{plural(totals.noLines, 'sale')} {totals.noLines === 1 ? 'has' : 'have'} no items saved and {totals.noLines === 1 ? 'is' : 'are'} left out of the profit.</>}
        </p>
      )}

      {/* Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-2">
        <label className="relative flex-1 min-w-0">
          <span className="sr-only">Search sales</span>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6e6e73]" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Invoice, customer, model or IMEI"
            className="w-full min-h-[40px] pl-9 pr-3 rounded-full bg-white dark:bg-[#1c1c1e] border border-black/[0.08] dark:border-white/[0.1] text-sm text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-[#0071e3]"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Choice label="Show" value={typeFilter} onChange={setTypeFilter} options={[
            { id: 'sale', label: 'Sales' }, { id: 'quotation', label: 'Quotations' }, { id: 'all', label: 'Both' }
          ]} />
          <select aria-label="Payment" value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)} className={selectCls}>
            <option value="all">Any payment</option>
            <option value="cash">Cash</option>
            <option value="online">Bank or wallet</option>
            <option value="credit">Credit</option>
            <option value="split">Split</option>
          </select>
        </div>
      </div>
      {search.trim() && range !== 'all' && (
        <p className="text-xs text-[#5f6368] dark:text-gray-400 px-1">Searching {period.name.toLowerCase()} only. Choose “All time” to search every sale.</p>
      )}

      {loading && sales.length === 0 ? (
        <div className="space-y-2 animate-pulse" aria-label="Loading sales">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-16 rounded-2xl bg-[#e5e5ea]/60 dark:bg-[#2c2c2e]/60" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-[20px] border border-black/[0.06] dark:border-white/[0.08] bg-white dark:bg-[#1c1c1e] py-12 text-center">
          <p className="text-sm text-[#5f6368] dark:text-gray-400">
            {sales.length ? 'No sales match these filters.' : `No sales in ${period.name.toLowerCase()}.`}
          </p>
        </div>
      ) : (
        <div className={loading ? 'opacity-70 transition-opacity' : ''} aria-busy={loading || undefined}>
          <SalesList rows={rows} selecting={selecting} selected={selected} onToggle={toggleSelect} onToggleAll={toggleSelectAll} onOpen={openSale} />
        </div>
      )}

      {selectedSale && (
        <SaleDetail
          sale={selectedSale}
          items={saleItems}
          loading={loadingItems}
          returnQtys={returnQtys}
          setReturnQtys={setReturnQtys}
          refundType={refundType}
          setRefundType={setRefundType}
          returning={returning}
          onReturn={handleReturn}
          onPrint={() => printQrInvoice(selectedSale, saleItems)}
          onPrintReceipt={() => printInvoice(selectedSale, saleItems)}
          onConvert={() => navigate('/pos?convertQuote=' + selectedSale.id)}
          onDelete={() => { const id = selectedSale.id; setSelectedSale(null); requestDelete([id]) }}
          onClose={() => setSelectedSale(null)}
        />
      )}

      {showPasswordModal && (
        <PasswordModal
          title={pendingDeleteIds.length === 1 ? 'Delete sale' : 'Delete sales'}
          message={`${plural(pendingDeleteIds.length, 'sale')} will be moved to Trash. Stock, the customer's balance and the accounts are put back as before the sale.`}
          onConfirm={executeDelete}
          onCancel={() => { setShowPasswordModal(false); setPendingDeleteIds([]) }}
        />
      )}
    </div>
  )
}

export default Sales
