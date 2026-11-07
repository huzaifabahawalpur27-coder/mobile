import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  RefreshCw,
  Plus,
  Trash2,
  Printer,
  Send,
  Eye,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Search,
  Building2,
  User,
  ShieldAlert
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../services/supabase'
import { getBankAccounts } from '../services/bankService'
import { processPhoneExchange, getExchanges, voidPhoneExchange } from '../services/exchangeService'
import { buildExchangeBillHTML } from '../utils/billTemplates'
import { buildExchangeWhatsAppText } from '../services/whatsappQueueService'

const PHONE_BRANDS = ['Apple', 'Samsung', 'Xiaomi', 'Oppo', 'Vivo', 'Realme', 'OnePlus', 'Google', 'Infinix', 'Tecno', 'Other']
const PHONE_STORAGES = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB']
const PHONE_CONDITIONS = ['Used - Like New', 'Used - Good', 'Used - Fair', 'Damaged / Needs Repair']
const PTA_STATUSES = ['PTA Approved', 'Non-PTA', 'JV / Gevey', 'Software Patch']
const SCREEN_CONDITIONS = ['Flawless (No Scratches)', 'Minor Scratches', 'Replaced / Aftermarket', 'Cracked / Damaged']

export default function Exchange() {
  const { user } = useAuth()

  // Navigation tab
  const [activeTab, setActiveTab] = useState('new') // 'new' | 'history'

  // Master Data state
  const [customers, setCustomers] = useState([])
  const [branches, setBranches] = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
  const [availablePhones, setAvailablePhones] = useState([])
  const [availableProducts, setAvailableProducts] = useState([])
  const [shopSettings, setShopSettings] = useState({})

  // Form State: Counterparty & Branch
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [walkInName, setWalkInName] = useState('')
  const [walkInPhone, setWalkInPhone] = useState('')
  const [selectedBranchId, setSelectedBranchId] = useState('')
  const [generalNotes, setGeneralNotes] = useState('')

  // Quick Add Customer Modal
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')

  // Panel A: Incoming Traded-In Phones
  const [incomingPhones, setIncomingPhones] = useState([
    {
      id: 1,
      brand: 'Apple',
      model: '',
      storage: '128GB',
      color: '',
      condition: 'Used - Good',
      pta_status: 'PTA Approved',
      imei_1: '',
      imei_2: '',
      assessed_value: '',
      notes: '',
      battery_health: '',
      screen_condition: 'Flawless (No Scratches)',
      accessories: ['Box'],
      defects: ''
    }
  ])

  // Panel B: Outgoing Replacement Items
  const [outgoingItems, setOutgoingItems] = useState([])
  const [inventorySearch, setInventorySearch] = useState('')
  const [inventoryFilter, setInventoryFilter] = useState('phones') // 'phones' | 'accessories'

  // Panel C: Settlement & Tender
  const [paymentMethod, setPaymentMethod] = useState('cash') // 'cash' | 'bank' | 'split' | 'credit'
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [splitAllocations, setSplitAllocations] = useState([
    { method: 'cash', amount: '', account_id: '' },
    { method: 'bank', amount: '', account_id: '' }
  ])

  // Process / Modal States
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [completedExchange, setCompletedExchange] = useState(null)
  const [showReceiptModal, setShowReceiptModal] = useState(false)

  // History Tab State
  const [historyList, setHistoryList] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [selectedExchangeForView, setSelectedExchangeForView] = useState(null)
  const [exchangeToVoid, setExchangeToVoid] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)
  const [voidError, setVoidError] = useState('')

  const loadInitialData = useCallback(async () => {
    const sid = user?.shop_id
    if (!sid) return
    try {
      // 1. Fetch Customers
      const { data: custData } = await supabase.from('customers').select('*').eq('shop_id', sid).order('name')
      if (custData) setCustomers(custData)

      // 2. Fetch Branches
      const { data: branchData } = await supabase.from('branches').select('*').eq('shop_id', sid).eq('is_active', true)
      if (branchData) {
        setBranches(branchData)
        const main = branchData.find(b => b.is_main) || branchData[0]
        if (main) setSelectedBranchId(String(main.id))
      }

      // 3. Fetch Accounts
      const accList = await getBankAccounts(sid)
      setBankAccounts(accList || [])
      const defAcc = accList?.find(a => a.is_default) || accList?.[0]
      if (defAcc) setSelectedAccountId(String(defAcc.id))

      // 4. Fetch Available Phones (status = 'in_stock')
      const { data: phoneData } = await supabase
        .from('phones')
        .select('*')
        .eq('shop_id', sid)
        .eq('status', 'in_stock')
        .order('created_at', { ascending: false })
      if (phoneData) setAvailablePhones(phoneData)

      // 5. Fetch Products
      const { data: prodData } = await supabase.from('products').select('*').eq('shop_id', sid).order('name')
      if (prodData) setAvailableProducts(prodData)

      // 6. Shop settings
      const { data: sData } = await supabase.from('shops').select('*').eq('id', sid).maybeSingle()
      if (sData) setShopSettings(sData)
    } catch (err) {
      console.warn('Initial data load warning:', err)
    }
  }, [user?.shop_id])

  // Fetch initial data
  useEffect(() => {
    if (user?.shop_id) {
      loadInitialData()
    }
  }, [user?.shop_id, loadInitialData])

  const fetchExchangeHistory = useCallback(async () => {
    if (!user?.shop_id) return
    setHistoryLoading(true)
    try {
      const list = await getExchanges({ shopId: user.shop_id, limit: 100 })
      setHistoryList(list || [])
    } catch (err) {
      console.warn('History fetch error:', err)
    } finally {
      setHistoryLoading(false)
    }
  }, [user?.shop_id])

  // Load history when tab changes
  useEffect(() => {
    if (activeTab === 'history') {
      fetchExchangeHistory()
    }
  }, [activeTab, fetchExchangeHistory])

  // Incoming Phone Helpers
  const addIncomingPhone = () => {
    setIncomingPhones(prev => [
      ...prev,
      {
        id: Date.now(),
        brand: 'Apple',
        model: '',
        storage: '128GB',
        color: '',
        condition: 'Used - Good',
        pta_status: 'PTA Approved',
        imei_1: '',
        imei_2: '',
        assessed_value: '',
        notes: '',
        battery_health: '',
        screen_condition: 'Flawless (No Scratches)',
        accessories: ['Box'],
        defects: ''
      }
    ])
  }

  const updateIncomingPhone = (id, field, value) => {
    setIncomingPhones(prev =>
      prev.map(p => (p.id === id ? { ...p, [field]: value } : p))
    )
  }

  const removeIncomingPhone = (id) => {
    if (incomingPhones.length === 1) {
      alert('An exchange requires at least one surrendered phone')
      return
    }
    setIncomingPhones(prev => prev.filter(p => p.id !== id))
  }

  // Outgoing Replacement Helpers
  const addPhoneToOutgoing = (phone) => {
    if (outgoingItems.some(i => i.phone_id === phone.id)) {
      alert('This phone is already added to outgoing items')
      return
    }
    setOutgoingItems(prev => [
      ...prev,
      {
        phone_id: phone.id,
        product_id: phone.product_id || null,
        product_name: `${phone.brand} ${phone.model} (${phone.storage || ''} ${phone.color || ''})`,
        brand: phone.brand,
        model: phone.model,
        storage: phone.storage,
        color: phone.color,
        imei_1: phone.imei_1,
        imei_2: phone.imei_2,
        price: Number(phone.sale_price || phone.cost_price || 0),
        quantity: 1,
        is_phone: true
      }
    ])
  }

  const addProductToOutgoing = (prod) => {
    const existing = outgoingItems.find(i => i.product_id === prod.id && !i.phone_id)
    if (existing) {
      setOutgoingItems(prev =>
        prev.map(i =>
          i.product_id === prod.id && !i.phone_id
            ? { ...i, quantity: i.quantity + 1 }
            : i
        )
      )
    } else {
      setOutgoingItems(prev => [
        ...prev,
        {
          product_id: prod.id,
          phone_id: null,
          product_name: prod.name,
          price: Number(prod.price || prod.sale_price || 0),
          quantity: 1,
          is_phone: false
        }
      ])
    }
  }

  const updateOutgoingQty = (idx, qty) => {
    const val = Math.max(1, parseInt(qty) || 1)
    setOutgoingItems(prev =>
      prev.map((item, i) => (i === idx ? { ...item, quantity: val } : item))
    )
  }

  const updateOutgoingPrice = (idx, newPrice) => {
    const val = Math.max(0, parseFloat(newPrice) || 0)
    setOutgoingItems(prev =>
      prev.map((item, i) => (i === idx ? { ...item, price: val } : item))
    )
  }

  const removeOutgoingItem = (idx) => {
    setOutgoingItems(prev => prev.filter((_, i) => i !== idx))
  }

  // Financial Math & Calculations
  const totalTradeInCredit = useMemo(() => {
    return incomingPhones.reduce((sum, p) => sum + (parseFloat(p.assessed_value) || 0), 0)
  }, [incomingPhones])

  const totalSaleAmount = useMemo(() => {
    return outgoingItems.reduce((sum, item) => sum + (parseFloat(item.price) || 0) * (item.quantity || 1), 0)
  }, [outgoingItems])

  const netSettlementDifference = useMemo(() => {
    return totalSaleAmount - totalTradeInCredit
  }, [totalSaleAmount, totalTradeInCredit])

  const absoluteSettlement = useMemo(() => {
    return Math.abs(netSettlementDifference)
  }, [netSettlementDifference])

  const settlementDirection = useMemo(() => {
    if (netSettlementDifference > 0) return 'customer_paid'
    if (netSettlementDifference < 0) return 'shop_payout'
    return 'even'
  }, [netSettlementDifference])

  // Filtered Inventory Search
  const filteredAvailablePhones = useMemo(() => {
    const q = inventorySearch.toLowerCase().trim()
    if (!q) return availablePhones
    return availablePhones.filter(
      p =>
        p.brand?.toLowerCase().includes(q) ||
        p.model?.toLowerCase().includes(q) ||
        p.imei_1?.toLowerCase().includes(q) ||
        p.imei_2?.toLowerCase().includes(q)
    )
  }, [availablePhones, inventorySearch])

  const filteredAvailableProducts = useMemo(() => {
    const q = inventorySearch.toLowerCase().trim()
    if (!q) return availableProducts
    return availableProducts.filter(
      p => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q)
    )
  }, [availableProducts, inventorySearch])

  // Quick Add Customer Handler
  const handleQuickAddCustomer = async (e) => {
    e.preventDefault()
    if (!newCustomerName.trim()) {
      alert('Please enter a customer name')
      return
    }
    try {
      const { data, error } = await supabase
        .from('customers')
        .insert({
          shop_id: user.shop_id,
          name: newCustomerName.trim(),
          phone: newCustomerPhone.trim() || null,
          created_at: new Date().toISOString()
        })
        .select()
        .single()

      if (error) throw error
      if (data) {
        setCustomers(prev => [data, ...prev])
        setSelectedCustomerId(String(data.id))
        setShowAddCustomerModal(false)
        setNewCustomerName('')
        setNewCustomerPhone('')
      }
    } catch (err) {
      alert('Failed to add customer: ' + err.message)
    }
  }

  // Pre-submission validation
  const validateExchange = () => {
    setSubmitError('')

    // 1. Customer check
    if (!selectedCustomerId && !walkInName.trim()) {
      setSubmitError('Please select an existing customer or enter a Walk-in Customer name')
      return false
    }

    // 2. Incoming trade-in validation
    if (incomingPhones.length === 0) {
      setSubmitError('At least one traded-in phone is required')
      return false
    }

    const seenImeis = new Set()
    for (let i = 0; i < incomingPhones.length; i++) {
      const p = incomingPhones[i]
      const cleanImei = String(p.imei_1 || '').trim()
      if (cleanImei.length < 6) {
        setSubmitError(`Trade-in Phone #${i + 1}: Valid IMEI 1 is required (min 6 digits)`)
        return false
      }
      if (seenImeis.has(cleanImei)) {
        setSubmitError(`Duplicate IMEI ${cleanImei} entered in trade-in items`)
        return false
      }
      seenImeis.add(cleanImei)

      if (p.imei_2) {
        const cleanImei2 = String(p.imei_2).trim()
        if (cleanImei2 && seenImeis.has(cleanImei2)) {
          setSubmitError(`Duplicate IMEI 2 ${cleanImei2} entered in trade-in items`)
          return false
        }
        if (cleanImei2) seenImeis.add(cleanImei2)
      }

      const val = parseFloat(p.assessed_value)
      if (isNaN(val) || val < 0) {
        setSubmitError(`Trade-in Phone #${i + 1}: Please enter a valid assessed valuation amount`)
        return false
      }
    }

    // 3. Outgoing items validation
    if (outgoingItems.length === 0) {
      setSubmitError('Please select at least one replacement phone or accessory from inventory')
      return false
    }

    // 4. Settlement tender check
    if (settlementDirection !== 'even') {
      if (!selectedAccountId && paymentMethod !== 'split') {
        setSubmitError('Please select a Bank / Cash Vault account for the settlement transaction')
        return false
      }
    }

    return true
  }

  const handleOpenConfirm = () => {
    if (validateExchange()) {
      setShowConfirmModal(true)
    }
  }

  // Execution: Submit Exchange to Server RPC
  const handleSubmitExchange = async () => {
    setIsSubmitting(true)
    setSubmitError('')

    try {
      const selectedCust = customers.find(c => String(c.id) === String(selectedCustomerId))
      const custName = selectedCust ? selectedCust.name : walkInName.trim()
      const custPhone = selectedCust ? selectedCust.phone : walkInPhone.trim()

      const payload = {
        customerId: selectedCustomerId ? parseInt(selectedCustomerId) : null,
        customerName: custName,
        customerPhone: custPhone,
        branchId: selectedBranchId ? parseInt(selectedBranchId) : null,
        incomingPhones: incomingPhones.map(p => ({
          brand: p.brand,
          model: p.model || 'Phone',
          storage: p.storage,
          color: p.color,
          condition: p.condition,
          pta_status: p.pta_status,
          imei_1: p.imei_1,
          imei_2: p.imei_2,
          assessed_value: parseFloat(p.assessed_value) || 0,
          notes: p.notes,
          inspection_details: {
            battery_health: p.battery_health,
            screen_condition: p.screen_condition,
            accessories: p.accessories,
            defects: p.defects
          }
        })),
        outgoingItems: outgoingItems.map(i => ({
          phone_id: i.phone_id,
          product_id: i.product_id,
          product_name: i.product_name,
          price: i.price,
          quantity: i.quantity
        })),
        saleAmount: totalSaleAmount,
        tradeInCredit: totalTradeInCredit,
        settlementAmount: absoluteSettlement,
        settlementDirection: settlementDirection,
        paymentMethod: paymentMethod,
        paymentDetails: paymentMethod === 'split' ? splitAllocations : null,
        accountId: selectedAccountId ? parseInt(selectedAccountId) : null,
        notes: generalNotes,
        idempotencyKey: crypto.randomUUID ? crypto.randomUUID() : null
      }

      const result = await processPhoneExchange(payload)

      if (result && result.success) {
        setShowConfirmModal(false)

        // Snapshot complete exchange for receipt printing & WhatsApp
        const completedSnapshot = {
          ...result,
          customer_name: custName,
          customer_phone: custPhone,
          sale_amount: totalSaleAmount,
          trade_in_credit: totalTradeInCredit,
          settlement_amount: absoluteSettlement,
          settlement_direction: settlementDirection,
          settlement_payment_method: paymentMethod,
          notes: generalNotes,
          created_at: new Date().toISOString(),
          exchange_items: [
            ...payload.incomingPhones.map(p => ({
              ...p,
              item_direction: 'incoming_trade_in',
              product_name: `${p.brand} ${p.model}`
            })),
            ...payload.outgoingItems.map(i => ({
              ...i,
              item_direction: 'outgoing_sale',
              subtotal: i.price * i.quantity
            }))
          ]
        }

        setCompletedExchange(completedSnapshot)
        setShowReceiptModal(true)

        // Reset Form
        resetExchangeForm()
        // Reload inventory
        loadInitialData()
      } else {
        throw new Error(result?.error || 'Transaction failed')
      }
    } catch (err) {
      console.error('Exchange submission error:', err)
      setSubmitError(err.message || 'Failed to complete exchange transaction')
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetExchangeForm = () => {
    setSelectedCustomerId('')
    setWalkInName('')
    setWalkInPhone('')
    setGeneralNotes('')
    setIncomingPhones([
      {
        id: 1,
        brand: 'Apple',
        model: '',
        storage: '128GB',
        color: '',
        condition: 'Used - Good',
        pta_status: 'PTA Approved',
        imei_1: '',
        imei_2: '',
        assessed_value: '',
        notes: '',
        battery_health: '',
        screen_condition: 'Flawless (No Scratches)',
        accessories: ['Box'],
        defects: ''
      }
    ])
    setOutgoingItems([])
  }

  // Print Exchange Bill
  const handlePrintReceipt = (exchangeRecord = completedExchange) => {
    if (!exchangeRecord) return
    const html = buildExchangeBillHTML(exchangeRecord, shopSettings)
    const printWindow = window.open('', '_blank', 'width=800,height=900')
    if (printWindow) {
      printWindow.document.write(html)
      printWindow.document.close()
    }
  }

  // WhatsApp Dispatch
  const handleSendWhatsApp = (exchangeRecord = completedExchange) => {
    if (!exchangeRecord) return
    const text = buildExchangeWhatsAppText({ exchange: exchangeRecord, shopInfo: shopSettings })
    const targetPhone = exchangeRecord.customer_phone || ''
    const cleanPhone = targetPhone.replace(/[^0-9]/g, '')
    const url = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`
    window.open(url, '_blank')
  }

  // Handle Void
  const handleExecuteVoid = async () => {
    if (!exchangeToVoid) return
    if (!voidReason.trim()) {
      setVoidError('Please specify a reason for voiding this exchange')
      return
    }

    setVoiding(true)
    setVoidError('')

    try {
      const res = await voidPhoneExchange(exchangeToVoid.id, voidReason.trim())
      if (res && res.success) {
        setExchangeToVoid(null)
        setVoidReason('')
        fetchExchangeHistory()
        loadInitialData()
        alert('Exchange successfully voided and inventory/accounts restored!')
      } else {
        throw new Error(res?.error || 'Voiding rejected')
      }
    } catch (err) {
      setVoidError(err.message || 'Failed to void exchange')
    } finally {
      setVoiding(false)
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white tracking-tight flex items-center gap-2">
            <span className="p-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-xl">
              <RefreshCw size={24} />
            </span>
            Phone Trade-in & Exchange
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Intake customer used phone(s), purchase new stock, and settle net difference in one atomic transaction
          </p>
        </div>

        {/* Tab Toggle */}
        <div className="flex items-center gap-1.5 bg-gray-100 dark:bg-slate-800 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('new')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'new'
                ? 'bg-white dark:bg-slate-700 text-purple-700 dark:text-purple-300 shadow-sm'
                : 'text-gray-600 dark:text-gray-300 hover:text-gray-900'
            }`}
          >
            <Plus size={14} /> New Exchange
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'history'
                ? 'bg-white dark:bg-slate-700 text-purple-700 dark:text-purple-300 shadow-sm'
                : 'text-gray-600 dark:text-gray-300 hover:text-gray-900'
            }`}
          >
            📜 Exchange History
          </button>
        </div>
      </div>

      {activeTab === 'new' ? (
        /* ── NEW EXCHANGE WORKFLOW ── */
        <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 space-y-4 pr-1">
          {/* Header Card: Customer & Branch Selection */}
          <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-gray-200 dark:border-slate-800 shadow-xs">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Customer Selector */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                    <User size={13} className="text-purple-600" /> Customer <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowAddCustomerModal(true)}
                    className="text-[11px] font-bold text-purple-600 hover:text-purple-800 dark:text-purple-400"
                  >
                    + New Customer
                  </button>
                </div>
                <select
                  value={selectedCustomerId}
                  onChange={e => {
                    setSelectedCustomerId(e.target.value)
                    if (e.target.value) {
                      setWalkInName('')
                      setWalkInPhone('')
                    }
                  }}
                  className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                >
                  <option value="">-- Walk-in / New Customer --</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.phone ? `(${c.phone})` : ''}
                    </option>
                  ))}
                </select>

                {!selectedCustomerId && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <input
                      type="text"
                      placeholder="Walk-in Customer Name *"
                      value={walkInName}
                      onChange={e => setWalkInName(e.target.value)}
                      className="text-xs p-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                    />
                    <input
                      type="text"
                      placeholder="Phone (e.g. 03001234567)"
                      value={walkInPhone}
                      onChange={e => setWalkInPhone(e.target.value)}
                      className="text-xs p-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                )}
              </div>

              {/* Branch Selector */}
              <div>
                <label className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1">
                  <Building2 size={13} className="text-purple-600" /> Active Branch
                </label>
                <select
                  value={selectedBranchId}
                  onChange={e => setSelectedBranchId(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                >
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name} {b.is_main ? '(Main Branch)' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400 mt-1">
                  Inventory movements and accounting will be posted to this branch.
                </p>
              </div>

              {/* General Notes */}
              <div>
                <label className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 block">
                  Exchange Remarks / Memo
                </label>
                <input
                  type="text"
                  placeholder="e.g. Customer traded iPhone 13 for 15 Pro Max"
                  value={generalNotes}
                  onChange={e => setGeneralNotes(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                />
              </div>
            </div>
          </div>

          {/* DUAL PANELS: LEFT (TRADE-IN) & RIGHT (OUTGOING) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* ── PANEL A: INCOMING TRADE-IN INTAKE ── */}
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-gray-200 dark:border-slate-800 shadow-xs flex flex-col min-h-0">
              <div className="flex justify-between items-center pb-3 border-b border-gray-200 dark:border-slate-800 mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 flex items-center justify-center font-bold text-xs">
                    📥
                  </span>
                  <div>
                    <h2 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-wider">
                      Customer Traded-In Phone(s)
                    </h2>
                    <p className="text-[11px] text-gray-500">Device specs, physical inspection, & valuation</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={addIncomingPhone}
                  className="px-2.5 py-1 bg-red-50 hover:bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/40 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer transition"
                >
                  <Plus size={13} /> Add Phone
                </button>
              </div>

              {/* Trade-in Devices List */}
              <div className="space-y-4 flex-1">
                {incomingPhones.map((phone, index) => (
                  <div
                    key={phone.id}
                    className="p-3 bg-red-50/40 dark:bg-red-950/10 rounded-xl border border-red-100 dark:border-red-900/30 space-y-3"
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black text-red-700 dark:text-red-400 uppercase tracking-wide">
                        Device #{index + 1}
                      </span>
                      {incomingPhones.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeIncomingPhone(phone.id)}
                          className="text-gray-400 hover:text-red-600 transition"
                          title="Remove this phone"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>

                    {/* Brand & Model */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-gray-600 dark:text-gray-400 uppercase">
                          Brand
                        </label>
                        <select
                          value={phone.brand}
                          onChange={e => updateIncomingPhone(phone.id, 'brand', e.target.value)}
                          className="w-full text-xs p-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                        >
                          {PHONE_BRANDS.map(b => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-600 dark:text-gray-400 uppercase">
                          Model Name *
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. iPhone 13 Pro"
                          value={phone.model}
                          onChange={e => updateIncomingPhone(phone.id, 'model', e.target.value)}
                          className="w-full text-xs p-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                        />
                      </div>
                    </div>

                    {/* Storage & Color */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-gray-600 dark:text-gray-400 uppercase">
                          Storage
                        </label>
                        <select
                          value={phone.storage}
                          onChange={e => updateIncomingPhone(phone.id, 'storage', e.target.value)}
                          className="w-full text-xs p-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                        >
                          {PHONE_STORAGES.map(s => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-600 dark:text-gray-400 uppercase">
                          Color
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Sierra Blue"
                          value={phone.color}
                          onChange={e => updateIncomingPhone(phone.id, 'color', e.target.value)}
                          className="w-full text-xs p-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                        />
                      </div>
                    </div>

                    {/* IMEI 1 & IMEI 2 */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-gray-600 dark:text-gray-400 uppercase">
                          IMEI 1 (Required) *
                        </label>
                        <input
                          type="text"
                          maxLength={16}
                          placeholder="15-digit IMEI"
                          value={phone.imei_1}
                          onChange={e => updateIncomingPhone(phone.id, 'imei_1', e.target.value.replace(/\s+/g, ''))}
                          className="w-full text-xs font-mono p-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-600 dark:text-gray-400 uppercase">
                          IMEI 2 (Optional)
                        </label>
                        <input
                          type="text"
                          maxLength={16}
                          placeholder="Secondary IMEI"
                          value={phone.imei_2}
                          onChange={e => updateIncomingPhone(phone.id, 'imei_2', e.target.value.replace(/\s+/g, ''))}
                          className="w-full text-xs font-mono p-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                        />
                      </div>
                    </div>

                    {/* Condition & PTA Status */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-gray-600 dark:text-gray-400 uppercase">
                          Condition
                        </label>
                        <select
                          value={phone.condition}
                          onChange={e => updateIncomingPhone(phone.id, 'condition', e.target.value)}
                          className="w-full text-xs p-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                        >
                          {PHONE_CONDITIONS.map(c => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-600 dark:text-gray-400 uppercase">
                          PTA Status
                        </label>
                        <select
                          value={phone.pta_status}
                          onChange={e => updateIncomingPhone(phone.id, 'pta_status', e.target.value)}
                          className="w-full text-xs p-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                        >
                          {PTA_STATUSES.map(p => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Inspection: Battery Health & Screen */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-gray-600 dark:text-gray-400 uppercase">
                          Battery Health %
                        </label>
                        <input
                          type="number"
                          min="40"
                          max="100"
                          placeholder="e.g. 88"
                          value={phone.battery_health}
                          onChange={e => updateIncomingPhone(phone.id, 'battery_health', e.target.value)}
                          className="w-full text-xs p-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-600 dark:text-gray-400 uppercase">
                          Screen Condition
                        </label>
                        <select
                          value={phone.screen_condition}
                          onChange={e => updateIncomingPhone(phone.id, 'screen_condition', e.target.value)}
                          className="w-full text-xs p-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                        >
                          {SCREEN_CONDITIONS.map(sc => (
                            <option key={sc} value={sc}>
                              {sc}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Valuation (Trade-in Credit) */}
                    <div className="pt-2 border-t border-red-200 dark:border-red-900/30">
                      <label className="text-xs font-black text-red-700 dark:text-red-400 uppercase flex items-center justify-between">
                        <span>Assessed Trade-in Credit (PKR) *</span>
                        {phone.assessed_value && (
                          <span className="font-mono text-xs">
                            Rs. {parseFloat(phone.assessed_value || 0).toLocaleString('en-PK')}
                          </span>
                        )}
                      </label>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={phone.assessed_value}
                        onChange={e => updateIncomingPhone(phone.id, 'assessed_value', e.target.value)}
                        className="w-full text-sm font-bold p-2 mt-1 rounded-lg border-2 border-red-300 dark:border-red-900 bg-white dark:bg-slate-800 text-red-700 dark:text-red-400"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Total Trade-in Credit Footer */}
              <div className="mt-4 pt-3 border-t border-gray-200 dark:border-slate-800 flex justify-between items-center">
                <span className="text-xs font-black uppercase text-gray-600 dark:text-gray-400">
                  Total Trade-in Credit:
                </span>
                <span className="text-lg font-black text-red-600 dark:text-red-400 font-mono">
                  Rs. {totalTradeInCredit.toLocaleString('en-PK')}
                </span>
              </div>
            </div>

            {/* ── PANEL B: OUTGOING REPLACEMENT SELECTION ── */}
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-gray-200 dark:border-slate-800 shadow-xs flex flex-col min-h-0">
              <div className="flex justify-between items-center pb-3 border-b border-gray-200 dark:border-slate-800 mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 flex items-center justify-center font-bold text-xs">
                    📤
                  </span>
                  <div>
                    <h2 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-wider">
                      Outgoing Replacement Items
                    </h2>
                    <p className="text-[11px] text-gray-500">Phones from stock & catalog accessories</p>
                  </div>
                </div>

                <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 p-0.5 rounded-lg text-xs">
                  <button
                    type="button"
                    onClick={() => setInventoryFilter('phones')}
                    className={`px-2 py-0.5 rounded-md font-bold transition ${
                      inventoryFilter === 'phones' ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-xs' : 'text-gray-500'
                    }`}
                  >
                    Phones ({availablePhones.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setInventoryFilter('accessories')}
                    className={`px-2 py-0.5 rounded-md font-bold transition ${
                      inventoryFilter === 'accessories' ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-xs' : 'text-gray-500'
                    }`}
                  >
                    Accessories
                  </button>
                </div>
              </div>

              {/* Quick Stock Search */}
              <div className="relative mb-3">
                <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search in-stock phones by Model, Brand, or IMEI..."
                  value={inventorySearch}
                  onChange={e => setInventorySearch(e.target.value)}
                  className="w-full text-xs pl-8 pr-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                />
              </div>

              {/* Stock Selector Picker (Compact Scroll Area) */}
              <div className="h-44 overflow-y-auto custom-scrollbar border border-gray-200 dark:border-slate-800 rounded-lg p-1.5 space-y-1 mb-4 bg-gray-50/50 dark:bg-slate-950/20">
                {inventoryFilter === 'phones' ? (
                  filteredAvailablePhones.length > 0 ? (
                    filteredAvailablePhones.map(phone => {
                      const isAdded = outgoingItems.some(i => i.phone_id === phone.id)
                      return (
                        <div
                          key={phone.id}
                          onClick={() => !isAdded && addPhoneToOutgoing(phone)}
                          className={`flex items-center justify-between p-2 rounded-lg text-xs transition cursor-pointer ${
                            isAdded
                              ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 opacity-60 cursor-not-allowed'
                              : 'bg-white dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700'
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <div className="font-bold text-gray-900 dark:text-gray-100 truncate">
                              {phone.brand} {phone.model}
                              <span className="text-gray-400 font-normal ml-1">
                                ({phone.storage || ''} {phone.color || ''})
                              </span>
                            </div>
                            <div className="text-[10px] text-gray-500 font-mono flex items-center gap-2">
                              <span>IMEI: {phone.imei_1 ? phone.imei_1.slice(0, 8) + '...' : 'N/A'}</span>
                              <span className="px-1.5 py-0.2 bg-gray-100 dark:bg-slate-700 rounded text-[9px] font-semibold">
                                {phone.condition || 'Used'}
                              </span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-black text-blue-600 dark:text-blue-400 font-mono">
                              Rs. {parseFloat(phone.sale_price || 0).toLocaleString('en-PK')}
                            </div>
                            <button
                              type="button"
                              disabled={isAdded}
                              className={`text-[10px] font-bold px-2 py-0.5 rounded transition ${
                                isAdded ? 'text-gray-400' : 'bg-blue-600 text-white hover:bg-blue-700'
                              }`}
                            >
                              {isAdded ? 'Added' : '+ Select'}
                            </button>
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    <div className="p-4 text-center text-xs text-gray-400">
                      No phones found matching your search.
                    </div>
                  )
                ) : (
                  filteredAvailableProducts.length > 0 ? (
                    filteredAvailableProducts.map(prod => (
                      <div
                        key={prod.id}
                        onClick={() => addProductToOutgoing(prod)}
                        className="flex items-center justify-between p-2 rounded-lg text-xs bg-white dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 transition cursor-pointer"
                      >
                        <div>
                          <div className="font-bold text-gray-900 dark:text-gray-100">{prod.name}</div>
                          <div className="text-[10px] text-gray-500">Stock: {prod.stock_quantity ?? 0} available</div>
                        </div>
                        <div className="text-right">
                          <div className="font-black text-blue-600 dark:text-blue-400 font-mono">
                            Rs. {parseFloat(prod.price || prod.sale_price || 0).toLocaleString('en-PK')}
                          </div>
                          <button
                            type="button"
                            className="text-[10px] font-bold px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                            + Add
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-4 text-center text-xs text-gray-400">No catalog products found.</div>
                  )
                )}
              </div>

              {/* Selected Outgoing Items Basket */}
              <div className="flex-1 space-y-2">
                <div className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                  Selected Items ({outgoingItems.length})
                </div>

                {outgoingItems.length > 0 ? (
                  <div className="space-y-2">
                    {outgoingItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 bg-green-50/40 dark:bg-green-950/10 rounded-xl border border-green-100 dark:border-green-900/30 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-xs text-gray-900 dark:text-gray-100 truncate">
                            {item.product_name}
                          </div>
                          {item.imei_1 && (
                            <div className="text-[10px] text-gray-500 font-mono">IMEI: {item.imei_1}</div>
                          )}
                        </div>

                        {/* Price & Qty Adjuster */}
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-gray-400">Rs.</span>
                            <input
                              type="number"
                              value={item.price}
                              onChange={e => updateOutgoingPrice(idx, e.target.value)}
                              className="w-20 text-xs font-bold p-1 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-right"
                            />
                          </div>

                          {!item.is_phone && (
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={e => updateOutgoingQty(idx, e.target.value)}
                              className="w-12 text-xs font-bold p-1 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-center"
                            />
                          )}

                          <button
                            type="button"
                            onClick={() => removeOutgoingItem(idx)}
                            className="p-1 text-gray-400 hover:text-red-600 transition"
                            title="Remove"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 text-center text-xs text-gray-400 border-2 border-dashed border-gray-200 dark:border-slate-800 rounded-xl">
                    No replacement items selected yet. Choose phones or accessories from stock above.
                  </div>
                )}
              </div>

              {/* Total Outgoing Purchases Footer */}
              <div className="mt-4 pt-3 border-t border-gray-200 dark:border-slate-800 flex justify-between items-center">
                <span className="text-xs font-black uppercase text-gray-600 dark:text-gray-400">
                  Total Outgoing Purchases:
                </span>
                <span className="text-lg font-black text-green-600 dark:text-green-400 font-mono">
                  Rs. {totalSaleAmount.toLocaleString('en-PK')}
                </span>
              </div>
            </div>
          </div>

          {/* ── PANEL C: RECONCILIATION & SETTLEMENT CARD ── */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border-2 border-purple-200 dark:border-purple-900/50 shadow-md">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
              {/* Summary Calculations */}
              <div className="space-y-1.5 border-b md:border-b-0 md:border-r border-gray-200 dark:border-slate-800 pb-4 md:pb-0 md:pr-4">
                <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
                  <span>Outgoing Sale Purchases:</span>
                  <span className="font-bold font-mono">Rs. {totalSaleAmount.toLocaleString('en-PK')}</span>
                </div>
                <div className="flex justify-between text-xs text-red-600 dark:text-red-400">
                  <span>Less: Trade-in Credit:</span>
                  <span className="font-bold font-mono">- Rs. {totalTradeInCredit.toLocaleString('en-PK')}</span>
                </div>
                <div className="pt-2 border-t border-gray-200 dark:border-slate-800 flex justify-between text-sm font-black">
                  <span className="text-gray-900 dark:text-white">Net Settlement:</span>
                  <span className="font-mono text-purple-700 dark:text-purple-400">
                    Rs. {absoluteSettlement.toLocaleString('en-PK')}
                  </span>
                </div>
              </div>

              {/* Big Unmistakable Settlement Indicator */}
              <div className="flex flex-col items-center justify-center p-3 rounded-xl border">
                {settlementDirection === 'customer_paid' && (
                  <div className="text-center">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400 text-xs font-black uppercase tracking-wider mb-1">
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Customer Pays Store
                    </div>
                    <div className="text-2xl font-black text-green-700 dark:text-green-400 font-mono">
                      + Rs. {absoluteSettlement.toLocaleString('en-PK')}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5">Collect this amount from the customer</p>
                  </div>
                )}

                {settlementDirection === 'shop_payout' && (
                  <div className="text-center">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-xs font-black uppercase tracking-wider mb-1">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Store Pays Customer
                    </div>
                    <div className="text-2xl font-black text-red-600 dark:text-red-400 font-mono">
                      - Rs. {absoluteSettlement.toLocaleString('en-PK')}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5">Disburse cash/bank payout to customer</p>
                  </div>
                )}

                {settlementDirection === 'even' && (
                  <div className="text-center">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 text-xs font-black uppercase tracking-wider mb-1">
                      ⚪ Even Exchange
                    </div>
                    <div className="text-2xl font-black text-gray-700 dark:text-gray-300 font-mono">
                      Rs. 0
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5">Trade-in credit equals purchase amount</p>
                  </div>
                )}
              </div>

              {/* Settlement Account & Tender Method */}
              <div>
                {settlementDirection !== 'even' ? (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-700 dark:text-gray-300 block">
                      {settlementDirection === 'customer_paid'
                        ? 'Payment Tender & Account'
                        : 'Payout Source Account'}
                    </label>

                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={paymentMethod}
                        onChange={e => setPaymentMethod(e.target.value)}
                        className="text-xs p-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 font-bold"
                      >
                        <option value="cash">Cash Vault</option>
                        <option value="bank">Bank Account</option>
                        {settlementDirection === 'customer_paid' && (
                          <>
                            <option value="split">Split Payment</option>
                            <option value="credit">Customer Khata (Credit)</option>
                          </>
                        )}
                      </select>

                      {paymentMethod !== 'split' && paymentMethod !== 'credit' && (
                        <select
                          value={selectedAccountId}
                          onChange={e => setSelectedAccountId(e.target.value)}
                          className="text-xs p-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                        >
                          {bankAccounts.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.account_name} ({a.bank_name}) - Rs. {Number(a.current_balance).toLocaleString('en-PK')}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 p-2 bg-gray-50 dark:bg-slate-800 rounded-lg text-center">
                    No cash will move into or out of bank accounts for this even trade.
                  </div>
                )}

                {/* Submit Button */}
                <button
                  type="button"
                  onClick={handleOpenConfirm}
                  disabled={isSubmitting}
                  className="w-full mt-3 py-2.5 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-black text-sm rounded-xl shadow-md transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RefreshCw size={16} /> Process & Complete Exchange
                </button>
              </div>
            </div>

            {submitError && (
              <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-xs rounded-xl border border-red-200 dark:border-red-900 flex items-center gap-2">
                <AlertTriangle size={15} className="shrink-0" />
                <span>{submitError}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── HISTORY WORKFLOW ── */
        <div className="flex-1 overflow-hidden flex flex-col bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4 min-h-0">
          {/* History Search & Filters */}
          <div className="flex justify-between items-center gap-3 mb-4 shrink-0">
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search exchange #, customer, or phone..."
                value={historySearch}
                onChange={e => setHistorySearch(e.target.value)}
                className="w-full text-xs pl-8 pr-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
              />
            </div>

            <button
              type="button"
              onClick={fetchExchangeHistory}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-bold transition flex items-center gap-1.5"
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>

          {/* Exchanges Table */}
          <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
            {historyLoading ? (
              <div className="p-8 text-center text-sm text-gray-400">Loading exchange history...</div>
            ) : historyList.length > 0 ? (
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-gray-300 sticky top-0 uppercase font-bold text-[10px]">
                  <tr>
                    <th className="p-2.5">Exchange #</th>
                    <th className="p-2.5">Date & Time</th>
                    <th className="p-2.5">Customer</th>
                    <th className="p-2.5 text-right">Outgoing Sale</th>
                    <th className="p-2.5 text-right">Trade-in Credit</th>
                    <th className="p-2.5 text-right">Net Settlement</th>
                    <th className="p-2.5 text-center">Status</th>
                    <th className="p-2.5 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {historyList
                    .filter(ex => {
                      const q = historySearch.toLowerCase().trim()
                      if (!q) return true
                      return (
                        ex.exchange_number?.toLowerCase().includes(q) ||
                        ex.customer_name?.toLowerCase().includes(q) ||
                        ex.customer_phone?.toLowerCase().includes(q)
                      )
                    })
                    .map(ex => {
                      const isVoid = ex.status === 'voided'
                      return (
                        <tr
                          key={ex.id}
                          className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition"
                        >
                          <td className="p-2.5 font-bold font-mono text-purple-700 dark:text-purple-400">
                            {ex.exchange_number}
                          </td>
                          <td className="p-2.5 text-gray-500">
                            {new Date(ex.created_at).toLocaleString('en-PK', {
                              dateStyle: 'medium',
                              timeStyle: 'short'
                            })}
                          </td>
                          <td className="p-2.5 font-semibold text-gray-900 dark:text-gray-100">
                            {ex.customer_name || 'Walk-in'}
                            {ex.customer_phone && (
                              <span className="block text-[10px] text-gray-400 font-mono">
                                {ex.customer_phone}
                              </span>
                            )}
                          </td>
                          <td className="p-2.5 text-right font-mono font-bold text-green-600 dark:text-green-400">
                            Rs. {parseFloat(ex.sale_amount || 0).toLocaleString('en-PK')}
                          </td>
                          <td className="p-2.5 text-right font-mono font-bold text-red-600 dark:text-red-400">
                            Rs. {parseFloat(ex.trade_in_credit || 0).toLocaleString('en-PK')}
                          </td>
                          <td className="p-2.5 text-right font-mono font-bold">
                            <span
                              className={
                                ex.settlement_direction === 'customer_paid'
                                  ? 'text-green-600'
                                  : ex.settlement_direction === 'shop_payout'
                                  ? 'text-red-600'
                                  : 'text-gray-500'
                              }
                            >
                              Rs. {parseFloat(ex.settlement_amount || 0).toLocaleString('en-PK')}
                            </span>
                            <span className="block text-[9px] uppercase tracking-wider font-semibold text-gray-400">
                              {ex.settlement_direction === 'customer_paid'
                                ? 'Customer Paid'
                                : ex.settlement_direction === 'shop_payout'
                                ? 'Shop Payout'
                                : 'Even'}
                            </span>
                          </td>
                          <td className="p-2.5 text-center">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                isVoid
                                  ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                                  : 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400'
                              }`}
                            >
                              {ex.status}
                            </span>
                          </td>
                          <td className="p-2.5 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setSelectedExchangeForView(ex)}
                                className="p-1 text-gray-500 hover:text-purple-600 transition"
                                title="View Details"
                              >
                                <Eye size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handlePrintReceipt(ex)}
                                className="p-1 text-gray-500 hover:text-blue-600 transition"
                                title="Reprint Memo"
                              >
                                <Printer size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSendWhatsApp(ex)}
                                className="p-1 text-gray-500 hover:text-green-600 transition"
                                title="WhatsApp Memo"
                              >
                                <Send size={15} />
                              </button>
                              {!isVoid && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExchangeToVoid(ex)
                                    setVoidReason('')
                                    setVoidError('')
                                  }}
                                  className="p-1 text-gray-400 hover:text-red-600 transition"
                                  title="Void Exchange"
                                >
                                  <XCircle size={15} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            ) : (
              <div className="p-8 text-center text-sm text-gray-400">No exchange transactions recorded yet.</div>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL: CONFIRM EXCHANGE COMMIT ── */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-5 border border-gray-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-purple-600 pb-2 border-b border-gray-100 dark:border-slate-800">
              <RefreshCw size={20} />
              <h3 className="font-black text-base text-gray-900 dark:text-white">Confirm Phone Exchange</h3>
            </div>

            <p className="text-xs text-gray-600 dark:text-gray-300">
              Please review the transaction summary below before committing to the database. This will atomically
              update inventory, link sales/purchases, and adjust accounting balances.
            </p>

            <div className="bg-gray-50 dark:bg-slate-800 p-3 rounded-xl space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Traded-in Devices:</span>
                <span className="font-bold text-red-600">
                  {incomingPhones.length} Phone(s) (Credit: Rs. {totalTradeInCredit.toLocaleString('en-PK')})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Outgoing Replacement Items:</span>
                <span className="font-bold text-green-600">
                  {outgoingItems.length} Item(s) (Sale: Rs. {totalSaleAmount.toLocaleString('en-PK')})
                </span>
              </div>
              <div className="pt-2 border-t border-gray-200 dark:border-slate-700 flex justify-between font-bold text-sm">
                <span>Net Settlement:</span>
                <span className="font-mono text-purple-700 dark:text-purple-400">
                  {settlementDirection === 'customer_paid'
                    ? `Customer Pays Rs. ${absoluteSettlement.toLocaleString('en-PK')}`
                    : settlementDirection === 'shop_payout'
                    ? `Shop Pays Rs. ${absoluteSettlement.toLocaleString('en-PK')}`
                    : 'Even Exchange (Rs. 0)'}
                </span>
              </div>
            </div>

            {submitError && (
              <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">
                {submitError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 text-gray-700 dark:text-gray-300 rounded-xl font-bold text-xs cursor-pointer"
              >
                Back / Edit
              </button>
              <button
                type="button"
                onClick={handleSubmitExchange}
                disabled={isSubmitting}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50"
              >
                {isSubmitting ? 'Processing...' : 'Confirm & Save Transaction'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: POST-SUBMISSION RECEIPT & WHATSAPP ── */}
      {showReceiptModal && completedExchange && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 border border-gray-200 dark:border-slate-800 shadow-2xl text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-green-100 text-green-600 mx-auto flex items-center justify-center">
              <CheckCircle2 size={32} />
            </div>

            <h3 className="text-lg font-black text-gray-900 dark:text-white">Exchange Processed!</h3>
            <p className="text-xs text-gray-500">
              Exchange memo <b className="font-mono text-purple-600">{completedExchange.exchange_number}</b> recorded
              successfully.
            </p>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => handlePrintReceipt(completedExchange)}
                className="py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
              >
                <Printer size={15} /> Print Memo
              </button>
              <button
                type="button"
                onClick={() => handleSendWhatsApp(completedExchange)}
                className="py-2.5 px-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
              >
                <Send size={15} /> WhatsApp Bill
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowReceiptModal(false)
                setCompletedExchange(null)
              }}
              className="w-full py-2 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 text-gray-700 dark:text-gray-300 rounded-xl font-bold text-xs cursor-pointer"
            >
              Start Another Exchange
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL: VIEW EXCHANGE DETAILS ── */}
      {selectedExchangeForView && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full p-5 border border-gray-200 dark:border-slate-800 shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar space-y-4">
            <div className="flex justify-between items-center border-b border-gray-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="font-black text-base text-gray-900 dark:text-white">
                  Exchange Audit: {selectedExchangeForView.exchange_number}
                </h3>
                <p className="text-xs text-gray-500">
                  {new Date(selectedExchangeForView.created_at).toLocaleString('en-PK')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedExchangeForView(null)}
                className="text-gray-400 hover:text-gray-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="p-3 bg-gray-50 dark:bg-slate-800 rounded-xl space-y-1">
                <span className="font-bold text-gray-500 block uppercase text-[10px]">Customer Details</span>
                <div className="font-bold text-sm text-gray-900 dark:text-white">
                  {selectedExchangeForView.customer_name || 'Walk-in'}
                </div>
                {selectedExchangeForView.customer_phone && (
                  <div className="font-mono text-gray-500">{selectedExchangeForView.customer_phone}</div>
                )}
              </div>

              <div className="p-3 bg-gray-50 dark:bg-slate-800 rounded-xl space-y-1">
                <span className="font-bold text-gray-500 block uppercase text-[10px]">Linked Invoices</span>
                <div>Sale Invoice: <b>INV-{String(selectedExchangeForView.sale_id || '').slice(-8)}</b></div>
                <div>Trade-in Purchase: <b>PR-{String(selectedExchangeForView.purchase_id || '').slice(-8)}</b></div>
              </div>
            </div>

            {/* Line Items Snapshots */}
            <div className="space-y-3">
              <div>
                <span className="text-xs font-black text-red-600 uppercase">📥 Traded-in Device(s)</span>
                <div className="mt-1 border border-gray-200 dark:border-slate-800 rounded-xl divide-y divide-gray-100 dark:divide-slate-800 text-xs">
                  {(selectedExchangeForView.exchange_items || [])
                    .filter(i => i.item_direction === 'incoming_trade_in')
                    .map(item => (
                      <div key={item.id} className="p-2.5 flex justify-between items-center">
                        <div>
                          <div className="font-bold">
                            {item.brand} {item.model || item.product_name}
                          </div>
                          <div className="text-[10px] text-gray-500 font-mono">
                            IMEI: {item.imei_1} {item.imei_2 ? `· IMEI 2: ${item.imei_2}` : ''} · {item.condition}
                          </div>
                        </div>
                        <div className="font-mono font-bold text-red-600">
                          Rs. {parseFloat(item.assessed_value || 0).toLocaleString('en-PK')}
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              <div>
                <span className="text-xs font-black text-green-600 uppercase">📤 Outgoing Replacement Item(s)</span>
                <div className="mt-1 border border-gray-200 dark:border-slate-800 rounded-xl divide-y divide-gray-100 dark:divide-slate-800 text-xs">
                  {(selectedExchangeForView.exchange_items || [])
                    .filter(i => i.item_direction === 'outgoing_sale')
                    .map(item => (
                      <div key={item.id} className="p-2.5 flex justify-between items-center">
                        <div>
                          <div className="font-bold">{item.product_name}</div>
                          {item.imei_1 && (
                            <div className="text-[10px] text-gray-500 font-mono">IMEI: {item.imei_1}</div>
                          )}
                        </div>
                        <div className="font-mono font-bold text-green-600">
                          Rs. {parseFloat(item.subtotal || item.assessed_value || 0).toLocaleString('en-PK')}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* Reconciliation Totals */}
            <div className="p-3 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900 rounded-xl text-xs space-y-1">
              <div className="flex justify-between">
                <span>Total Outgoing Sale:</span>
                <span className="font-bold font-mono">
                  Rs. {parseFloat(selectedExchangeForView.sale_amount || 0).toLocaleString('en-PK')}
                </span>
              </div>
              <div className="flex justify-between text-red-600">
                <span>Less Trade-in Credit:</span>
                <span className="font-bold font-mono">
                  - Rs. {parseFloat(selectedExchangeForView.trade_in_credit || 0).toLocaleString('en-PK')}
                </span>
              </div>
              <div className="pt-1.5 border-t border-purple-200 dark:border-purple-800 flex justify-between font-black text-sm text-purple-700 dark:text-purple-400">
                <span>Net Settlement ({selectedExchangeForView.settlement_direction}):</span>
                <span className="font-mono">
                  Rs. {parseFloat(selectedExchangeForView.settlement_amount || 0).toLocaleString('en-PK')}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => handlePrintReceipt(selectedExchangeForView)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1"
              >
                <Printer size={13} /> Print
              </button>
              <button
                type="button"
                onClick={() => handleSendWhatsApp(selectedExchangeForView)}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold flex items-center gap-1"
              >
                <Send size={13} /> WhatsApp
              </button>
              <button
                type="button"
                onClick={() => setSelectedExchangeForView(null)}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: VOID / REVERSAL DIALOG ── */}
      {exchangeToVoid && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-5 border border-red-200 dark:border-red-900 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-red-600">
              <ShieldAlert size={22} />
              <h3 className="font-black text-base">Void Exchange {exchangeToVoid.exchange_number}</h3>
            </div>

            <p className="text-xs text-gray-600 dark:text-gray-300">
              Voiding this transaction will restore the outgoing items back to available inventory, mark traded-in
              phones as returned to the customer, and reverse cash/bank settlements.
            </p>

            <div>
              <label className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 block">
                Reason for Reversal / Void *
              </label>
              <input
                type="text"
                placeholder="e.g. Customer changed mind, incorrect IMEI intake"
                value={voidReason}
                onChange={e => setVoidReason(e.target.value)}
                className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
              />
            </div>

            {voidError && (
              <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">
                {voidError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setExchangeToVoid(null)}
                className="px-4 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 text-gray-700 dark:text-gray-300 rounded-xl font-bold text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteVoid}
                disabled={voiding}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-xs flex items-center gap-1 disabled:opacity-50"
              >
                {voiding ? 'Reversing...' : 'Confirm Void & Restore'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: QUICK ADD CUSTOMER ── */}
      {showAddCustomerModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-sm w-full p-5 border border-gray-200 dark:border-slate-800 shadow-2xl space-y-4">
            <h3 className="font-black text-base text-gray-900 dark:text-white">Quick Add Customer</h3>
            <form onSubmit={handleQuickAddCustomer} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 block">
                  Customer Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Imran Ali"
                  value={newCustomerName}
                  onChange={e => setNewCustomerName(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 block">
                  Phone Number
                </label>
                <input
                  type="text"
                  placeholder="03001234567"
                  value={newCustomerPhone}
                  onChange={e => setNewCustomerPhone(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddCustomerModal(false)}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold"
                >
                  Save Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
