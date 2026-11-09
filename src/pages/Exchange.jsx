import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
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
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Sparkles
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../services/supabase'
import { getBankAccounts } from '../services/bankService'
import { processPhoneExchange, getExchanges, voidPhoneExchange } from '../services/exchangeService'
import { buildExchangeBillHTML } from '../utils/billTemplates'
import {
  buildExchangeWhatsAppText,
  enqueueWhatsAppMessage,
  cleanPakistanPhone,
  normalizeInvoiceToken
} from '../services/whatsappQueueService'
import { IPHONE_MODELS } from '../utils/iphonePresets'

const PHONE_BRANDS = ['Apple', 'Samsung', 'Xiaomi', 'Oppo', 'Vivo', 'Realme', 'OnePlus', 'Google', 'Infinix', 'Tecno', 'Other']
const PHONE_STORAGES = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB']
const PHONE_CONDITIONS = ['Used - Like New', 'Used - Good', 'Used - Fair', 'Damaged / Needs Repair']
const PTA_STATUSES = ['PTA Approved', 'Non-PTA', 'JV / Gevey', 'Software Patch']
const SCREEN_CONDITIONS = ['Flawless (No Scratches)', 'Minor Scratches', 'Replaced / Aftermarket', 'Cracked / Damaged']

const COMMON_ANDROID_MODELS = [
  { brand: 'Samsung', name: 'Galaxy S24 Ultra', defaultStorage: '256GB' },
  { brand: 'Samsung', name: 'Galaxy S24 Plus', defaultStorage: '256GB' },
  { brand: 'Samsung', name: 'Galaxy S24', defaultStorage: '128GB' },
  { brand: 'Samsung', name: 'Galaxy S23 Ultra', defaultStorage: '256GB' },
  { brand: 'Samsung', name: 'Galaxy S23', defaultStorage: '128GB' },
  { brand: 'Samsung', name: 'Galaxy S22 Ultra', defaultStorage: '128GB' },
  { brand: 'Samsung', name: 'Galaxy A55 5G', defaultStorage: '128GB' },
  { brand: 'Samsung', name: 'Galaxy A35 5G', defaultStorage: '128GB' },
  { brand: 'Samsung', name: 'Galaxy A15', defaultStorage: '128GB' },
  { brand: 'Xiaomi', name: 'Redmi Note 13 Pro Plus', defaultStorage: '256GB' },
  { brand: 'Xiaomi', name: 'Redmi Note 13 Pro', defaultStorage: '128GB' },
  { brand: 'Xiaomi', name: 'Redmi Note 13', defaultStorage: '128GB' },
  { brand: 'Xiaomi', name: 'Redmi 13C', defaultStorage: '128GB' },
  { brand: 'Xiaomi', name: '14 Ultra', defaultStorage: '512GB' },
  { brand: 'Google', name: 'Pixel 8 Pro', defaultStorage: '128GB' },
  { brand: 'Google', name: 'Pixel 8', defaultStorage: '128GB' },
  { brand: 'Google', name: 'Pixel 7 Pro', defaultStorage: '128GB' },
  { brand: 'Google', name: 'Pixel 7', defaultStorage: '128GB' },
  { brand: 'Google', name: 'Pixel 6 Pro', defaultStorage: '128GB' },
  { brand: 'OnePlus', name: '12', defaultStorage: '256GB' },
  { brand: 'OnePlus', name: '11', defaultStorage: '128GB' },
  { brand: 'Vivo', name: 'V30 Pro', defaultStorage: '256GB' },
  { brand: 'Vivo', name: 'V30', defaultStorage: '128GB' },
  { brand: 'Vivo', name: 'Y28', defaultStorage: '128GB' },
  { brand: 'Oppo', name: 'Reno 11', defaultStorage: '256GB' },
  { brand: 'Infinix', name: 'Note 40 Pro', defaultStorage: '256GB' },
  { brand: 'Infinix', name: 'Hot 40 Pro', defaultStorage: '128GB' },
  { brand: 'Tecno', name: 'Camon 30', defaultStorage: '256GB' },
  { brand: 'Tecno', name: 'Spark 20', defaultStorage: '128GB' }
]

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
  const [knownPhoneModels, setKnownPhoneModels] = useState([])
  const [activeAutocompletePhoneId, setActiveAutocompletePhoneId] = useState(null)

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

  // Panel A: Incoming Old Phone(s)
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
      defects: '',
      expanded: false
    }
  ])

  // Panel B: Outgoing New Phone / Replacement Items
  const [outgoingItems, setOutgoingItems] = useState([])
  const [inventorySearch, setInventorySearch] = useState('')
  const [inventoryFilter, setInventoryFilter] = useState('phones') // 'phones' | 'accessories'

  // Panel C: Settlement & Tender
  const [paymentMethod, setPaymentMethod] = useState('cash') // 'cash' | 'bank' | 'split' | 'credit'
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [showSplitModal, setShowSplitModal] = useState(false)
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
  const [outboxPromptPhone, setOutboxPromptPhone] = useState('')
  const [outboxSuccessMsg, setOutboxSuccessMsg] = useState('')

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

      // 6. Shop settings & warranty terms & exchange template
      const { data: sData } = await supabase.from('shops').select('*').eq('id', sid).maybeSingle()
      const savedWarranty = localStorage.getItem(`shop_warranty_${sid}`)
      const localShopSettings = (() => {
        try {
          return JSON.parse(localStorage.getItem(`shop_settings_${sid}`) || '{}')
        } catch (_) {
          return {}
        }
      })()
      const savedExchangeTemplate = localStorage.getItem(`shop_wa_exchange_${sid}`) || localShopSettings?.wa_exchange_template
      if (sData) {
        setShopSettings({
          ...localShopSettings,
          ...sData,
          warranty_terms: savedWarranty || sData.warranty_terms,
          wa_exchange_template: savedExchangeTemplate || sData.wa_exchange_template
        })
      } else if (savedWarranty || savedExchangeTemplate || Object.keys(localShopSettings).length > 0) {
        setShopSettings({
          ...localShopSettings,
          warranty_terms: savedWarranty,
          wa_exchange_template: savedExchangeTemplate
        })
      }

      // 7. Extract known phone models from DB (all past & current phones)
      const { data: allPastPhones } = await supabase
        .from('phones')
        .select('brand, model, storage')
        .eq('shop_id', sid)
        .limit(300)

      const fromDb = (allPastPhones || [])
        .filter(p => p.model && p.model.trim())
        .map(p => ({
          brand: p.brand || 'Other',
          name: p.model.trim(),
          defaultStorage: p.storage || '128GB'
        }))

      const iphoneList = IPHONE_MODELS.map(m => ({
        brand: 'Apple',
        name: m.name,
        defaultStorage: m.defaultStorage || '128GB',
        shorthand: m.shorthand || []
      }))

      // Merge and deduplicate models
      const modelMap = new Map()
      ;[...fromDb, ...iphoneList, ...COMMON_ANDROID_MODELS].forEach(item => {
        const key = `${item.brand}__${item.name}`.toLowerCase()
        if (!modelMap.has(key)) {
          modelMap.set(key, item)
        }
      })
      setKnownPhoneModels(Array.from(modelMap.values()))
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
        defects: '',
        expanded: false
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
      alert('An exchange requires at least one customer phone')
      return
    }
    setIncomingPhones(prev => prev.filter(p => p.id !== id))
  }

  // Model Autocomplete Selection
  const selectModelSuggestion = (phoneId, suggestion) => {
    updateIncomingPhone(phoneId, 'model', suggestion.name)
    if (suggestion.brand) {
      updateIncomingPhone(phoneId, 'brand', suggestion.brand)
    }
    if (suggestion.defaultStorage) {
      updateIncomingPhone(phoneId, 'storage', suggestion.defaultStorage)
    }
    setActiveAutocompletePhoneId(null)
  }

  const getFilteredSuggestions = (query, currentBrand) => {
    if (!query || query.trim().length === 0) return []
    const q = query.toLowerCase().trim()
    return knownPhoneModels
      .filter(m => {
        const matchName = m.name.toLowerCase().includes(q)
        const matchShorthand = Array.isArray(m.shorthand) && m.shorthand.some(sh => sh.toLowerCase().includes(q))
        const matchBrand = currentBrand && currentBrand !== 'Other' ? m.brand.toLowerCase() === currentBrand.toLowerCase() : true
        return (matchName || matchShorthand) && matchBrand
      })
      .slice(0, 8)
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

  // Account classification helpers
  const cashAccount = useMemo(() => {
    return bankAccounts.find(a => a.is_default || a.account_name?.toLowerCase().includes('cash') || a.bank_name?.toLowerCase().includes('cash')) || bankAccounts[0]
  }, [bankAccounts])

  const bankOnlyAccounts = useMemo(() => {
    const list = bankAccounts.filter(a => a.id !== cashAccount?.id && !a.account_name?.toLowerCase().includes('cash'))
    return list.length > 0 ? list : bankAccounts
  }, [bankAccounts, cashAccount])

  // Split payment allocations helpers
  const totalSplitAllocated = useMemo(() => {
    return (splitAllocations || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0)
  }, [splitAllocations])

  const splitRemaining = useMemo(() => {
    return absoluteSettlement - totalSplitAllocated
  }, [absoluteSettlement, totalSplitAllocated])

  const openSplitModal = () => {
    const cId = cashAccount?.id ? String(cashAccount.id) : ''
    const bId = bankOnlyAccounts[0]?.id ? String(bankOnlyAccounts[0].id) : (bankAccounts[0]?.id ? String(bankAccounts[0].id) : '')
    const half = Math.floor(absoluteSettlement / 2)
    const remainder = absoluteSettlement - half

    if (!splitAllocations || splitAllocations.length === 0 || !splitAllocations.some(a => Number(a.amount) > 0)) {
      setSplitAllocations([
        { method: 'cash', amount: half > 0 ? String(half) : '', account_id: cId },
        { method: 'bank', amount: remainder > 0 ? String(remainder) : '', account_id: bId }
      ])
    }
    setShowSplitModal(true)
  }

  const updateSplitLine = (idx, field, value) => {
    setSplitAllocations(prev => {
      const copy = [...prev]
      copy[idx] = { ...copy[idx], [field]: value }
      if (field === 'method') {
        if (value === 'cash') {
          copy[idx].account_id = cashAccount?.id ? String(cashAccount.id) : ''
        } else if (value === 'bank' && (!copy[idx].account_id || copy[idx].account_id === String(cashAccount?.id))) {
          copy[idx].account_id = bankOnlyAccounts[0]?.id ? String(bankOnlyAccounts[0].id) : (bankAccounts[0]?.id ? String(bankAccounts[0].id) : '')
        }
      }
      return copy
    })
  }

  const addSplitLine = () => {
    const defaultAcc = bankOnlyAccounts[0]?.id ? String(bankOnlyAccounts[0].id) : (bankAccounts[0]?.id ? String(bankAccounts[0].id) : '')
    setSplitAllocations(prev => [
      ...prev,
      { method: 'bank', amount: '', account_id: defaultAcc }
    ])
  }

  const removeSplitLine = (idx) => {
    if (splitAllocations.length <= 1) return
    setSplitAllocations(prev => prev.filter((_, i) => i !== idx))
  }

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
      setSubmitError('At least one old phone is required')
      return false
    }

    const seenImeis = new Set()
    for (let i = 0; i < incomingPhones.length; i++) {
      const p = incomingPhones[i]
      const cleanImei = String(p.imei_1 || '').trim()
      if (cleanImei.length < 6) {
        setSubmitError(`Old Phone #${i + 1}: Valid IMEI 1 is required (min 6 digits)`)
        return false
      }
      if (seenImeis.has(cleanImei)) {
        setSubmitError(`Duplicate IMEI ${cleanImei} entered in old phones`)
        return false
      }
      seenImeis.add(cleanImei)

      if (p.imei_2) {
        const cleanImei2 = String(p.imei_2).trim()
        if (cleanImei2 && seenImeis.has(cleanImei2)) {
          setSubmitError(`Duplicate IMEI 2 ${cleanImei2} entered`)
          return false
        }
        if (cleanImei2) seenImeis.add(cleanImei2)
      }

      const val = parseFloat(p.assessed_value)
      if (isNaN(val) || val < 0) {
        setSubmitError(`Old Phone #${i + 1}: Please enter the old phone value amount`)
        return false
      }
    }

    // 3. Outgoing items validation
    if (outgoingItems.length === 0) {
      setSubmitError('Please select at least one replacement phone or accessory from store stock')
      return false
    }

    // 4. Settlement tender check
    if (settlementDirection === 'customer_paid') {
      if (paymentMethod === 'split') {
        const validLines = splitAllocations.filter(a => (parseFloat(a.amount) || 0) > 0)
        if (validLines.length === 0) {
          setSubmitError('Please configure split payments (amounts are required)')
          return false
        }
        const totalAllocated = validLines.reduce((s, a) => s + parseFloat(a.amount), 0)
        if (Math.abs(totalAllocated - absoluteSettlement) > 0.5) {
          setSubmitError(`Split payments sum (Rs. ${totalAllocated.toLocaleString('en-PK')}) must equal net settlement (Rs. ${absoluteSettlement.toLocaleString('en-PK')})`)
          return false
        }
        for (let i = 0; i < validLines.length; i++) {
          if (!validLines[i].account_id) {
            setSubmitError(`Split Payment #${i + 1}: Please select a valid bank/cash account`)
            return false
          }
        }
      } else if (paymentMethod === 'bank') {
        if (!selectedAccountId) {
          setSubmitError('Please select a Bank Account for the settlement transaction')
          return false
        }
      } else if (paymentMethod === 'cash') {
        if (!selectedAccountId && cashAccount) {
          setSelectedAccountId(String(cashAccount.id))
        }
      }
    } else if (settlementDirection === 'shop_payout') {
      if (!selectedAccountId && paymentMethod === 'cash' && cashAccount) {
        setSelectedAccountId(String(cashAccount.id))
      } else if (!selectedAccountId) {
        setSubmitError('Please select an account to pay the customer from')
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
        paymentDetails: paymentMethod === 'split'
          ? splitAllocations.filter(a => parseFloat(a.amount) > 0).map(a => ({
              method: a.method,
              amount: parseFloat(a.amount),
              account_id: parseInt(a.account_id)
            }))
          : null,
        accountId: paymentMethod === 'cash'
          ? (cashAccount?.id || (selectedAccountId ? parseInt(selectedAccountId) : null))
          : (selectedAccountId ? parseInt(selectedAccountId) : (cashAccount?.id || null)),
        notes: generalNotes,
        idempotencyKey: crypto.randomUUID ? crypto.randomUUID() : null
      }

      const result = await processPhoneExchange(payload)

      if (result && result.success) {
        setShowConfirmModal(false)

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
          customer: selectedCust || (custName ? { name: custName, phone: custPhone } : null),
          customer_balance: selectedCust ? (selectedCust.outstanding_balance ?? selectedCust.balance ?? 0) : 0,
          exchange_items: [
            ...incomingPhones.map(p => ({
              ...p,
              item_direction: 'incoming_trade_in',
              product_name: `${p.brand} ${p.model}`.trim(),
              assessed_value: parseFloat(p.assessed_value) || 0,
              subtotal: parseFloat(p.assessed_value) || 0
            })),
            ...outgoingItems.map(i => ({
              ...i,
              item_direction: 'outgoing_sale',
              subtotal: (parseFloat(i.price) || 0) * (i.quantity || 1)
            }))
          ]
        }

        // Auto-enqueue WhatsApp Invoice Outbox
        let autoQueued = false
        if (custPhone) {
          try {
            const sid = user?.shop_id || 1
            const savedWarranty = sid ? localStorage.getItem(`shop_warranty_${sid}`) : null
            const localSettings = (() => {
              try { return JSON.parse(localStorage.getItem(`shop_settings_${sid}`) || '{}') } catch (_) { return {} }
            })()
            const savedExchangeTpl = (sid ? localStorage.getItem(`shop_wa_exchange_${sid}`) : null) || localSettings?.wa_exchange_template
            const shopInfo = {
              ...localSettings,
              ...shopSettings,
              id: sid,
              shop_id: sid,
              name: shopSettings?.name || (sid ? localStorage.getItem(`shop_name_${sid}`) : null) || 'EdgeX Mobile Store',
              phone: shopSettings?.phone || '',
              warranty_terms: savedWarranty || shopSettings?.warranty_terms,
              wa_exchange_template: savedExchangeTpl || shopSettings?.wa_exchange_template
            }
            const exchangeToken = normalizeInvoiceToken(result.invoice_token)
            const exchangeRef = exchangeToken ? `EXC-${exchangeToken}` : (result.exchange_number || null)
            const msgText = buildExchangeWhatsAppText({
              exchange: { ...completedSnapshot, invoice_token: exchangeToken, shop_id: sid },
              customer: completedSnapshot.customer,
              shopInfo
            })

            const qRes = await enqueueWhatsAppMessage({
              shop_id: sid,
              recipient_name: custName || 'Valued Customer',
              recipient_phone: custPhone,
              message_type: 'phone_exchange_receipt',
              reference_id: exchangeRef,
              reference_data: {
                exchange_id: result.exchange_id || result.id,
                exchange_number: exchangeRef,
                invoice_token: exchangeToken,
                sale_id: result.sale_id,
                purchase_id: result.purchase_id,
                sale_amount: totalSaleAmount,
                trade_in_credit: totalTradeInCredit,
                settlement_amount: absoluteSettlement,
                settlement_direction: settlementDirection,
                items_count: (incomingPhones.length + outgoingItems.length),
                has_phone: true,
                is_exchange: true
              },
              message_text: msgText,
              created_by: user?.id
            })
            if (qRes && qRes.success) {
              autoQueued = true
            }
          } catch (waErr) {
            console.warn('Auto enqueue whatsapp exchange receipt error:', waErr)
          }
        }

        completedSnapshot.is_queued = autoQueued
        setCompletedExchange(completedSnapshot)
        setOutboxPromptPhone('')
        setOutboxSuccessMsg(autoQueued ? 'Enqueued to WhatsApp Outbox! 📲' : '')
        setShowReceiptModal(true)
        resetExchangeForm()
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
    setPaymentMethod('cash')
    setSplitAllocations([
      { method: 'cash', amount: '', account_id: '' },
      { method: 'bank', amount: '', account_id: '' }
    ])
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
        defects: '',
        expanded: false
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
  const handleSendWhatsApp = async (exchangeRecord = completedExchange) => {
    if (!exchangeRecord) return
    const sid = user?.shop_id || 1
    const savedWarranty = sid ? localStorage.getItem(`shop_warranty_${sid}`) : null
    const localSettings = (() => {
      try { return JSON.parse(localStorage.getItem(`shop_settings_${sid}`) || '{}') } catch (_) { return {} }
    })()
    const savedExchangeTpl = (sid ? localStorage.getItem(`shop_wa_exchange_${sid}`) : null) || localSettings?.wa_exchange_template
    const shopInfo = {
      ...localSettings,
      ...shopSettings,
      id: sid,
      shop_id: sid,
      name: shopSettings?.name || (sid ? localStorage.getItem(`shop_name_${sid}`) : null) || 'EdgeX Mobile Store',
      phone: shopSettings?.phone || '',
      warranty_terms: savedWarranty || shopSettings?.warranty_terms,
      wa_exchange_template: savedExchangeTpl || shopSettings?.wa_exchange_template
    }
    const text = buildExchangeWhatsAppText({
      exchange: { ...exchangeRecord, shop_id: sid },
      customer: exchangeRecord.customer,
      shopInfo
    })

    let targetPhone = exchangeRecord.customer_phone || exchangeRecord.customer?.phone || ''
    if (!targetPhone) {
      const input = window.prompt('کسٹمر کا واٹس ایپ نمبر درج کریں (Enter customer WhatsApp mobile number):', '')
      if (!input || !input.trim()) return
      targetPhone = input.trim()
    }

    const cleanedPhone = cleanPakistanPhone(targetPhone) || targetPhone.replace(/[^0-9]/g, '')

    // Enqueue into outbox if not queued yet
    try {
        const exToken = normalizeInvoiceToken(exchangeRecord.invoice_token)
        const exRef = exToken ? `EXC-${exToken}` : (exchangeRecord.exchange_number || null)
        await enqueueWhatsAppMessage({
          shop_id: sid,
          recipient_name: exchangeRecord.customer_name || exchangeRecord.customer?.name || 'Valued Customer',
          recipient_phone: cleanedPhone,
          message_type: 'phone_exchange_receipt',
          reference_id: exRef,
          reference_data: {
            exchange_id: exchangeRecord.id,
            exchange_number: exRef,
            invoice_token: exToken,
            sale_id: exchangeRecord.sale_id,
            purchase_id: exchangeRecord.purchase_id,
            sale_amount: exchangeRecord.sale_amount,
            trade_in_credit: exchangeRecord.trade_in_credit,
            settlement_amount: exchangeRecord.settlement_amount,
            settlement_direction: exchangeRecord.settlement_direction,
            items_count: (exchangeRecord.exchange_items || []).length,
            has_phone: true,
            is_exchange: true
          },
          message_text: text,
          created_by: user?.id
        })
    } catch (enqueueErr) {
      console.debug('WhatsApp enqueue notice:', enqueueErr)
    }

    const url = cleanedPhone
      ? `https://wa.me/${cleanedPhone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`
    window.open(url, '_blank')
  }

  // Manual Add to WhatsApp Outbox from Completion Modal
  const handleManualEnqueueCompleted = async () => {
    if (!completedExchange) return
    const phone = outboxPromptPhone.trim()
    const cleaned = cleanPakistanPhone(phone)
    if (!cleaned) {
      alert('Please enter a valid Pakistani mobile number (e.g. 03001234567)')
      return
    }

    try {
      const sid = user?.shop_id || 1
      const savedWarranty = sid ? localStorage.getItem(`shop_warranty_${sid}`) : null
      const localSettings = (() => {
        try { return JSON.parse(localStorage.getItem(`shop_settings_${sid}`) || '{}') } catch (_) { return {} }
      })()
      const savedExchangeTpl = (sid ? localStorage.getItem(`shop_wa_exchange_${sid}`) : null) || localSettings?.wa_exchange_template
      const shopInfo = {
        ...localSettings,
        ...shopSettings,
        id: sid,
        shop_id: sid,
        name: shopSettings?.name || (sid ? localStorage.getItem(`shop_name_${sid}`) : null) || 'EdgeX Mobile Store',
        phone: shopSettings?.phone || '',
        warranty_terms: savedWarranty || shopSettings?.warranty_terms,
        wa_exchange_template: savedExchangeTpl || shopSettings?.wa_exchange_template
      }
      const updatedExchange = {
        ...completedExchange,
        customer_phone: cleaned,
        shop_id: sid
      }
      const msgText = buildExchangeWhatsAppText({
        exchange: updatedExchange,
        customer: updatedExchange.customer,
        shopInfo
      })

      const exToken = normalizeInvoiceToken(updatedExchange.invoice_token)
      const exRef = exToken ? `EXC-${exToken}` : (updatedExchange.exchange_number || null)
      const res = await enqueueWhatsAppMessage({
        shop_id: sid,
        recipient_name: updatedExchange.customer_name || 'Valued Customer',
        recipient_phone: cleaned,
        message_type: 'phone_exchange_receipt',
        reference_id: exRef,
        reference_data: {
          exchange_id: updatedExchange.id,
          exchange_number: exRef,
          invoice_token: exToken,
          sale_id: updatedExchange.sale_id,
          purchase_id: updatedExchange.purchase_id,
          sale_amount: updatedExchange.sale_amount,
          trade_in_credit: updatedExchange.trade_in_credit,
          settlement_amount: updatedExchange.settlement_amount,
          settlement_direction: updatedExchange.settlement_direction,
          items_count: (updatedExchange.exchange_items || []).length,
          has_phone: true,
          is_exchange: true
        },
        message_text: msgText,
        created_by: user?.id
      })

      if (res && res.success) {
        setCompletedExchange(updatedExchange)
        setOutboxPromptPhone('')
        setOutboxSuccessMsg('Added to WhatsApp Outbox! 📲')
        setTimeout(() => setOutboxSuccessMsg(''), 4000)
      } else {
        alert(res?.reason || res?.error || 'Failed to add to outbox')
      }
    } catch (err) {
      console.error('Manual enqueue error:', err)
      alert('Error enqueuing message: ' + (err?.message || String(err)))
    }
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
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-[#f5f5f7] dark:bg-black text-[#1d1d1f] dark:text-[#f5f5f7]">
      {/* ── TOP COMPACT HEADER BAR (SHRINK-0) ── */}
      <div className="shrink-0 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 p-2.5 px-4 flex flex-wrap items-center justify-between gap-3 shadow-2xs z-20">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 rounded-xl flex items-center justify-center">
            <RefreshCw size={18} />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight truncate">
              Phone Trade-in & Exchange
            </h1>
            <p className="text-[10px] text-gray-400 truncate">
              Customer Old Phone intake & New Phone sale in 1 step
            </p>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 p-0.5 rounded-lg text-xs ml-2">
            <button
              onClick={() => setActiveTab('new')}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                activeTab === 'new'
                  ? 'bg-white dark:bg-slate-700 text-purple-700 dark:text-purple-300 shadow-2xs'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400'
              }`}
            >
              <Plus size={12} /> New Exchange
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-white dark:bg-slate-700 text-purple-700 dark:text-purple-300 shadow-2xs'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400'
              }`}
            >
              📜 History
            </button>
          </div>
        </div>

        {/* Top Controls: Branch Picker (if multiple) */}
        {activeTab === 'new' && branches.length > 1 && (
          <div className="flex items-center gap-1.5 bg-gray-50 dark:bg-slate-800 p-1 px-2.5 rounded-lg border border-gray-200 dark:border-slate-700 text-xs">
            <Building2 size={13} className="text-purple-600 shrink-0" />
            <span className="text-[10px] text-gray-500 font-bold uppercase">Branch:</span>
            <select
              value={selectedBranchId}
              onChange={e => setSelectedBranchId(e.target.value)}
              className="bg-transparent border-none text-xs font-bold focus:outline-hidden text-gray-800 dark:text-gray-200 cursor-pointer"
            >
              {branches.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {activeTab === 'new' ? (
        /* ── WORKSPACE AREA (NO SCROLL MAIN SCREEN) ── */
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* ══════════════════════════════════════════════════════════
              PROMINENT CUSTOMER BAR AT TOP OF WORKSPACE
              Highlighted with glowing purple border so it is never overlooked!
          ══════════════════════════════════════════════════════════ */}
          <div className="shrink-0 mx-3 mt-2.5 p-2 px-3 bg-gradient-to-r from-purple-50 via-white to-purple-50/80 dark:from-purple-950/40 dark:via-slate-900 dark:to-purple-950/30 border-2 border-purple-400 dark:border-purple-600 rounded-xl shadow-xs flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-purple-600 text-white flex items-center justify-center font-bold shadow-xs shrink-0">
                <User size={15} />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-black uppercase text-purple-950 dark:text-purple-300 tracking-wider flex items-center gap-1">
                  Customer Details (گاہک کا نام و فون) <span className="text-red-500 font-bold">*</span>
                </div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400">Select existing customer or type walk-in name</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Existing Customer Selector */}
              <select
                value={selectedCustomerId}
                onChange={e => {
                  setSelectedCustomerId(e.target.value)
                  if (e.target.value) {
                    setWalkInName('')
                    setWalkInPhone('')
                  }
                }}
                className="text-xs font-bold py-1.5 px-2 bg-white dark:bg-slate-800 border-2 border-purple-300 dark:border-purple-700 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="">-- Walk-in / New Customer --</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.phone ? `(${c.phone})` : ''}
                  </option>
                ))}
              </select>

              {/* Walk-in Inputs (Visible when Walk-in is active) */}
              {!selectedCustomerId && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="Customer Name * (گاہک کا نام)"
                    value={walkInName}
                    onChange={e => setWalkInName(e.target.value)}
                    className="text-xs font-bold py-1.5 px-2.5 w-48 bg-white dark:bg-slate-800 border-2 border-purple-500 dark:border-purple-400 rounded-lg text-purple-950 dark:text-purple-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-600 shadow-2xs"
                  />
                  <input
                    type="tel"
                    placeholder="Phone (فون نمبر)"
                    value={walkInPhone}
                    onChange={e => setWalkInPhone(e.target.value)}
                    className="text-xs py-1.5 px-2 w-32 bg-white dark:bg-slate-800 border border-purple-300 dark:border-slate-700 rounded-lg text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowAddCustomerModal(true)}
                className="text-xs font-bold px-2.5 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg shadow-2xs transition flex items-center gap-1 cursor-pointer"
                title="Add New Customer to Directory"
              >
                <Plus size={12} /> Add
              </button>
            </div>
          </div>
          {/* DUAL WORKSPACE PANELS (50/50 GRID) */}
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-3 p-3 overflow-hidden">
            {/* ══════════════════════════════════════════════════════════
                PANEL A: CUSTOMER'S OLD PHONE (آنے والا پرانا فون)
            ══════════════════════════════════════════════════════════ */}
            <div className="flex flex-col h-full min-h-0 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 shadow-2xs overflow-hidden">
              {/* Header */}
              <div className="p-2.5 px-3 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center shrink-0 bg-gray-50/70 dark:bg-slate-800/40">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-md bg-red-100 dark:bg-red-950/40 text-red-600 flex items-center justify-center font-black text-xs">
                    📥
                  </span>
                  <div>
                    <h2 className="text-xs font-black uppercase text-gray-900 dark:text-white tracking-wider">
                      Customer's Old Phone (گاہک کا پرانا فون)
                    </h2>
                    <p className="text-[10px] text-gray-400">Incoming device specs & value</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={addIncomingPhone}
                  className="px-2 py-0.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/40 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer transition"
                >
                  <Plus size={12} /> Add Phone
                </button>
              </div>

              {/* Scrollable list of Old Phones */}
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-2.5">
                {incomingPhones.map((phone, index) => {
                  const suggestions = getFilteredSuggestions(phone.model, phone.brand)
                  const showDropdown = activeAutocompletePhoneId === phone.id && suggestions.length > 0

                  return (
                    <div
                      key={phone.id}
                      className="p-2.5 bg-red-50/30 dark:bg-red-950/10 rounded-xl border border-red-100 dark:border-red-900/30 space-y-2 relative"
                    >
                      {/* Top Row: Device Header + Remove */}
                      <div className="flex justify-between items-center">
                        <span className="text-[11px] font-black text-red-700 dark:text-red-400 uppercase tracking-wide">
                          Old Phone #{index + 1}
                        </span>
                        {incomingPhones.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeIncomingPhone(phone.id)}
                            className="text-gray-400 hover:text-red-600 transition"
                            title="Remove"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>

                      {/* Line 1: Brand & Model (with instant autocomplete) */}
                      <div className="grid grid-cols-12 gap-2">
                        <div className="col-span-4">
                          <label className="text-[10px] font-bold text-gray-500 uppercase block mb-0.5">
                            Brand
                          </label>
                          <select
                            value={phone.brand}
                            onChange={e => updateIncomingPhone(phone.id, 'brand', e.target.value)}
                            className="w-full text-xs p-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 font-semibold"
                          >
                            {PHONE_BRANDS.map(b => (
                              <option key={b} value={b}>
                                {b}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="col-span-8 relative">
                          <label className="text-[10px] font-bold text-gray-500 uppercase flex justify-between items-center mb-0.5">
                            <span>Phone Name / Model *</span>
                            <span className="text-[9px] text-purple-600 dark:text-purple-400 flex items-center gap-0.5 font-normal">
                              <Sparkles size={10} /> Type to autocomplete
                            </span>
                          </label>
                          <input
                            type="text"
                            placeholder="Type phone name (e.g. 13 Pro, S23 Ultra, Note 13)..."
                            value={phone.model}
                            onFocus={() => setActiveAutocompletePhoneId(phone.id)}
                            onChange={e => {
                              updateIncomingPhone(phone.id, 'model', e.target.value)
                              setActiveAutocompletePhoneId(phone.id)
                            }}
                            className="w-full text-xs p-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 font-bold focus:border-purple-500"
                          />

                          {/* Autocomplete Suggestions Popover */}
                          {showDropdown && (
                            <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-900 rounded-xl shadow-xl z-50 max-h-44 overflow-y-auto custom-scrollbar divide-y divide-gray-100 dark:divide-slate-700">
                              {suggestions.map((sug, sIdx) => (
                                <div
                                  key={sIdx}
                                  onMouseDown={e => {
                                    e.preventDefault()
                                    selectModelSuggestion(phone.id, sug)
                                  }}
                                  className="p-2 hover:bg-purple-50 dark:hover:bg-purple-950/40 text-xs cursor-pointer flex justify-between items-center transition"
                                >
                                  <div>
                                    <span className="font-black text-gray-900 dark:text-white mr-1.5">
                                      {sug.name}
                                    </span>
                                    <span className="text-[10px] px-1.5 py-0.2 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 rounded font-bold">
                                      {sug.brand}
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-gray-400 font-mono">
                                    {sug.defaultStorage || ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Line 2: Storage, Color, PTA Status */}
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-gray-500 uppercase block mb-0.5">
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
                          <label className="text-[10px] font-bold text-gray-500 uppercase block mb-0.5">
                            Color
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Black"
                            value={phone.color}
                            onChange={e => updateIncomingPhone(phone.id, 'color', e.target.value)}
                            className="w-full text-xs p-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] font-bold text-gray-500 uppercase block mb-0.5">
                            PTA Status
                          </label>
                          <select
                            value={phone.pta_status}
                            onChange={e => updateIncomingPhone(phone.id, 'pta_status', e.target.value)}
                            className="w-full text-xs p-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 font-semibold"
                          >
                            {PTA_STATUSES.map(p => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Line 3: IMEI 1 & Old Phone Value */}
                      <div className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-6">
                          <label className="text-[10px] font-bold text-gray-500 uppercase block mb-0.5">
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

                        <div className="col-span-6">
                          <label className="text-[10px] font-black text-red-700 dark:text-red-400 uppercase flex justify-between items-center mb-0.5">
                            <span>Old Phone Value (PKR) *</span>
                            {phone.assessed_value && (
                              <span className="font-mono text-[10px]">
                                Rs. {parseFloat(phone.assessed_value || 0).toLocaleString('en-PK')}
                              </span>
                            )}
                          </label>
                          <input
                            type="number"
                            placeholder="0.00"
                            value={phone.assessed_value}
                            onChange={e => updateIncomingPhone(phone.id, 'assessed_value', e.target.value)}
                            className="w-full text-xs font-black p-1.5 rounded-lg border-2 border-red-300 dark:border-red-900 bg-white dark:bg-slate-800 text-red-700 dark:text-red-400"
                          />
                        </div>
                      </div>

                      {/* Collapsible Inspection Details Toggle */}
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => updateIncomingPhone(phone.id, 'expanded', !phone.expanded)}
                          className="text-[10px] font-bold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 flex items-center gap-1 cursor-pointer"
                        >
                          {phone.expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                          <span>{phone.expanded ? 'Hide Extra Details' : '+ Extra Details (Battery %, Screen, IMEI 2, Notes)'}</span>
                        </button>

                        {phone.expanded && (
                          <div className="mt-2 pt-2 border-t border-red-100 dark:border-red-900/30 grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <label className="text-[10px] text-gray-500 block">Battery Health %</label>
                              <input
                                type="number"
                                placeholder="e.g. 88"
                                value={phone.battery_health}
                                onChange={e => updateIncomingPhone(phone.id, 'battery_health', e.target.value)}
                                className="w-full text-xs p-1 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-500 block">Screen Condition</label>
                              <select
                                value={phone.screen_condition}
                                onChange={e => updateIncomingPhone(phone.id, 'screen_condition', e.target.value)}
                                className="w-full text-xs p-1 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                              >
                                {SCREEN_CONDITIONS.map(sc => (
                                  <option key={sc} value={sc}>
                                    {sc}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-500 block">IMEI 2 (Optional)</label>
                              <input
                                type="text"
                                placeholder="Secondary IMEI"
                                value={phone.imei_2}
                                onChange={e => updateIncomingPhone(phone.id, 'imei_2', e.target.value.replace(/\s+/g, ''))}
                                className="w-full text-xs font-mono p-1 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-500 block">Defects / Notes</label>
                              <input
                                type="text"
                                placeholder="e.g. minor dent on corner"
                                value={phone.notes}
                                onChange={e => updateIncomingPhone(phone.id, 'notes', e.target.value)}
                                className="w-full text-xs p-1 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Total Old Phone Value Footer */}
              <div className="p-2.5 px-3 border-t border-gray-100 dark:border-slate-800 flex justify-between items-center shrink-0 bg-gray-50/70 dark:bg-slate-800/40">
                <span className="text-xs font-bold text-gray-500">Total Old Phone Value:</span>
                <span className="text-sm font-black text-red-600 dark:text-red-400 font-mono">
                  Rs. {totalTradeInCredit.toLocaleString('en-PK')}
                </span>
              </div>
            </div>

            {/* ══════════════════════════════════════════════════════════
                PANEL B: PHONE / ITEM (دکان کا فون / سامان)
            ══════════════════════════════════════════════════════════ */}
            <div className="flex flex-col h-full min-h-0 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 shadow-2xs overflow-hidden">
              {/* Header */}
              <div className="p-2.5 px-3 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center shrink-0 bg-gray-50/70 dark:bg-slate-800/40">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-md bg-green-100 dark:bg-green-950/40 text-green-600 flex items-center justify-center font-black text-xs">
                    📤
                  </span>
                  <div>
                    <h2 className="text-xs font-black uppercase text-gray-900 dark:text-white tracking-wider">
                      Phone / Item (دکان کا فون / سامان)
                    </h2>
                    <p className="text-[10px] text-gray-400">Available shop phones & accessories</p>
                  </div>
                </div>

                <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 p-0.5 rounded-lg text-xs">
                  <button
                    type="button"
                    onClick={() => setInventoryFilter('phones')}
                    className={`px-2 py-0.5 rounded-md font-bold transition cursor-pointer ${
                      inventoryFilter === 'phones'
                        ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-2xs'
                        : 'text-gray-500'
                    }`}
                  >
                    Phones ({availablePhones.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setInventoryFilter('accessories')}
                    className={`px-2 py-0.5 rounded-md font-bold transition cursor-pointer ${
                      inventoryFilter === 'accessories'
                        ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-2xs'
                        : 'text-gray-500'
                    }`}
                  >
                    Accessories
                  </button>
                </div>
              </div>

              {/* Stock Search Input (shrink-0) */}
              <div className="p-2.5 pb-1 shrink-0">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search shop stock by Model, Brand, or IMEI..."
                    value={inventorySearch}
                    onChange={e => setInventorySearch(e.target.value)}
                    className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                  />
                </div>
              </div>

              {/* Quick Available Stock Selector (Compact height, scrolls internally) */}
              <div className="p-2.5 pt-0 shrink-0">
                <div className="h-28 overflow-y-auto custom-scrollbar border border-gray-200 dark:border-slate-800 rounded-lg p-1 space-y-1 bg-gray-50/50 dark:bg-slate-950/20">
                  {inventoryFilter === 'phones' ? (
                    filteredAvailablePhones.length > 0 ? (
                      filteredAvailablePhones.map(phone => {
                        const isAdded = outgoingItems.some(i => i.phone_id === phone.id)
                        return (
                          <div
                            key={phone.id}
                            onClick={() => !isAdded && addPhoneToOutgoing(phone)}
                            className={`flex items-center justify-between p-1.5 rounded-md text-xs transition cursor-pointer ${
                              isAdded
                                ? 'bg-blue-50 dark:bg-blue-950/30 opacity-60 cursor-not-allowed'
                                : 'bg-white dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700'
                            }`}
                          >
                            <div className="min-w-0 pr-2">
                              <span className="font-bold text-gray-900 dark:text-gray-100 truncate mr-1">
                                {phone.brand} {phone.model}
                              </span>
                              <span className="text-[10px] text-gray-400">
                                ({phone.storage || ''} {phone.color || ''})
                              </span>
                              <span className="text-[9px] text-gray-500 font-mono ml-2">
                                {phone.imei_1 ? phone.imei_1.slice(0, 6) + '...' : ''}
                              </span>
                            </div>
                            <div className="text-right shrink-0 flex items-center gap-2">
                              <span className="font-black text-blue-600 dark:text-blue-400 font-mono text-xs">
                                Rs. {parseFloat(phone.sale_price || 0).toLocaleString('en-PK')}
                              </span>
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                                  isAdded ? 'text-gray-400' : 'bg-blue-600 text-white'
                                }`}
                              >
                                {isAdded ? 'Added' : '+ Add'}
                              </span>
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <div className="p-3 text-center text-xs text-gray-400">No phones match search.</div>
                    )
                  ) : (
                    filteredAvailableProducts.length > 0 ? (
                      filteredAvailableProducts.map(prod => (
                        <div
                          key={prod.id}
                          onClick={() => addProductToOutgoing(prod)}
                          className="flex items-center justify-between p-1.5 rounded-md text-xs bg-white dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 transition cursor-pointer"
                        >
                          <div>
                            <span className="font-bold text-gray-900 dark:text-gray-100 mr-1">{prod.name}</span>
                            <span className="text-[10px] text-gray-400">Qty: {prod.stock_quantity ?? 0}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-blue-600 dark:text-blue-400 font-mono text-xs">
                              Rs. {parseFloat(prod.price || prod.sale_price || 0).toLocaleString('en-PK')}
                            </span>
                            <span className="text-[10px] font-bold px-1.5 py-0.2 bg-blue-600 text-white rounded">
                              + Add
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-3 text-center text-xs text-gray-400">No products found.</div>
                    )
                  )}
                </div>
              </div>

              {/* Selected Items Basket (Takes remaining height, scrolls internally) */}
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2.5 pt-0 space-y-1.5">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block mb-1">
                  Selected Items ({outgoingItems.length})
                </span>

                {outgoingItems.length > 0 ? (
                  outgoingItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-2 bg-green-50/30 dark:bg-green-950/10 rounded-lg border border-green-100 dark:border-green-900/30 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-xs text-gray-900 dark:text-gray-100 truncate">
                          {item.product_name}
                        </div>
                        {item.imei_1 && (
                          <div className="text-[10px] text-gray-400 font-mono">IMEI: {item.imei_1}</div>
                        )}
                      </div>

                      {/* Price & Quantity Adjuster */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className="flex items-center gap-0.5">
                          <span className="text-[10px] text-gray-400">Rs.</span>
                          <input
                            type="number"
                            value={item.price}
                            onChange={e => updateOutgoingPrice(idx, e.target.value)}
                            className="w-18 text-xs font-bold p-1 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-right"
                          />
                        </div>

                        {!item.is_phone && (
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={e => updateOutgoingQty(idx, e.target.value)}
                            className="w-10 text-xs font-bold p-1 rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-center"
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
                  ))
                ) : (
                  <div className="p-4 text-center text-xs text-gray-400 border border-dashed border-gray-200 dark:border-slate-800 rounded-lg">
                    Select phones or accessories from stock above.
                  </div>
                )}
              </div>

              {/* Total New Phone Price Footer */}
              <div className="p-2.5 px-3 border-t border-gray-100 dark:border-slate-800 flex justify-between items-center shrink-0 bg-gray-50/70 dark:bg-slate-800/40">
                <span className="text-xs font-bold text-gray-500">Total New Phone Price:</span>
                <span className="text-sm font-black text-green-600 dark:text-green-400 font-mono">
                  Rs. {totalSaleAmount.toLocaleString('en-PK')}
                </span>
              </div>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════
              BOTTOM PINNED RECONCILIATION & SETTLEMENT BAR (SHRINK-0)
              NEVER HIDDEN, ALWAYS VISIBLE WITHOUT SCROLLING!
          ══════════════════════════════════════════════════════════ */}
          <div className="shrink-0 bg-white dark:bg-slate-900 border-t-2 border-purple-300 dark:border-purple-800 shadow-2xl p-2.5 px-4 z-30">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
              {/* Column 1: Reconciliation Breakdown */}
              <div className="text-xs space-y-0.5 border-b md:border-b-0 md:border-r border-gray-200 dark:border-slate-800 pb-2 md:pb-0 md:pr-3">
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>New Phone Price:</span>
                  <span className="font-bold font-mono">Rs. {totalSaleAmount.toLocaleString('en-PK')}</span>
                </div>
                <div className="flex justify-between text-red-600 dark:text-red-400">
                  <span>Less: Old Phone Value:</span>
                  <span className="font-bold font-mono">- Rs. {totalTradeInCredit.toLocaleString('en-PK')}</span>
                </div>
                <div className="flex justify-between font-black text-sm pt-0.5 border-t border-gray-200 dark:border-slate-700">
                  <span className="text-gray-900 dark:text-white">Net Difference:</span>
                  <span className="font-mono text-purple-700 dark:text-purple-400">
                    Rs. {absoluteSettlement.toLocaleString('en-PK')}
                  </span>
                </div>
              </div>

              {/* Column 2: Big Directional Indicator Badge */}
              <div className="flex flex-col items-center justify-center p-2 rounded-xl border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/50">
                {settlementDirection === 'customer_paid' && (
                  <div className="text-center">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400 text-xs font-black uppercase">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> CUSTOMER PAYS
                    </div>
                    <div className="text-xl font-black text-green-700 dark:text-green-400 font-mono mt-0.5">
                      + Rs. {absoluteSettlement.toLocaleString('en-PK')}
                    </div>
                    <p className="text-[10px] text-gray-500">Collect this amount from customer</p>
                  </div>
                )}

                {settlementDirection === 'shop_payout' && (
                  <div className="text-center">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-xs font-black uppercase">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> SHOP PAYS CUSTOMER
                    </div>
                    <div className="text-xl font-black text-red-600 dark:text-red-400 font-mono mt-0.5">
                      - Rs. {absoluteSettlement.toLocaleString('en-PK')}
                    </div>
                    <p className="text-[10px] text-gray-500">Pay cash/bank to customer</p>
                  </div>
                )}

                {settlementDirection === 'even' && (
                  <div className="text-center">
                    <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 text-xs font-black uppercase">
                      ⚪ EQUAL EXCHANGE
                    </div>
                    <div className="text-xl font-black text-gray-700 dark:text-gray-300 font-mono mt-0.5">
                      Rs. 0
                    </div>
                    <p className="text-[10px] text-gray-500">Old phone equals new phone price</p>
                  </div>
                )}
              </div>

              {/* Column 3: Payment Tender, Memo & Complete Button */}
              <div className="space-y-1.5">
                {/* Tender Selection Row */}
                <div className="flex items-center gap-2">
                  {/* Primary Method Selector */}
                  <select
                    value={paymentMethod}
                    onChange={e => {
                      const m = e.target.value
                      setPaymentMethod(m)
                      if (m === 'cash' && cashAccount) {
                        setSelectedAccountId(String(cashAccount.id))
                      } else if (m === 'bank') {
                        const defaultBank = bankOnlyAccounts[0]?.id ? String(bankOnlyAccounts[0].id) : (bankAccounts[0]?.id ? String(bankAccounts[0].id) : '')
                        setSelectedAccountId(defaultBank)
                      } else if (m === 'split') {
                        openSplitModal()
                      }
                    }}
                    className={`text-xs p-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 font-bold ${
                      paymentMethod === 'bank' || paymentMethod === 'split' ? 'w-1/2' : 'w-full'
                    }`}
                  >
                    <option value="cash">💵 Cash Vault</option>
                    <option value="bank">🏦 Bank Account</option>
                    {settlementDirection === 'customer_paid' && (
                      <>
                        <option value="split">🔀 Split Payment</option>
                        <option value="credit">📒 Customer Khata (Udhaar)</option>
                      </>
                    )}
                  </select>

                  {/* ONLY show Bank Account selector when Bank is chosen */}
                  {paymentMethod === 'bank' && (
                    <select
                      value={selectedAccountId}
                      onChange={e => setSelectedAccountId(e.target.value)}
                      className="w-1/2 text-xs p-1.5 rounded-lg border border-purple-300 dark:border-purple-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 font-semibold"
                    >
                      {bankOnlyAccounts.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.bank_name || a.account_name} ({a.account_name})
                        </option>
                      ))}
                    </select>
                  )}

                  {/* When Split Payment is chosen, show a button to configure split */}
                  {paymentMethod === 'split' && (
                    <button
                      type="button"
                      onClick={openSplitModal}
                      className="w-1/2 text-xs font-bold py-1.5 px-2 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700 rounded-lg flex items-center justify-between hover:bg-purple-200 transition cursor-pointer"
                    >
                      <span className="truncate">
                        {splitAllocations.filter(a => Number(a.amount) > 0).length > 0
                          ? `Split (${splitAllocations.filter(a => Number(a.amount) > 0).length} methods)`
                          : 'Configure Split'}
                      </span>
                      <span className="text-[10px] underline ml-1">Edit</span>
                    </button>
                  )}
                </div>

                {/* Memo / Remarks Option inside the form */}
                <input
                  type="text"
                  placeholder="Memo / Remarks (اختیاری ریمارکس)..."
                  value={generalNotes}
                  onChange={e => setGeneralNotes(e.target.value)}
                  className="w-full text-xs p-1.5 px-2.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
                />

                <button
                  type="button"
                  onClick={handleOpenConfirm}
                  disabled={isSubmitting}
                  className="w-full py-2 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-black text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw size={14} /> Process & Complete Exchange
                </button>
              </div>
            </div>

            {submitError && (
              <div className="mt-2 p-2 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-xs rounded-lg border border-red-200 dark:border-red-900 flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{submitError}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── HISTORY WORKFLOW ── */
        <div className="flex-1 overflow-hidden flex flex-col bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4 m-3 min-h-0">
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
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
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
                    <th className="p-2.5 text-right">New Phone Sale</th>
                    <th className="p-2.5 text-right">Old Phone Value</th>
                    <th className="p-2.5 text-right">Net Difference</th>
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
                                className="p-1 text-gray-500 hover:text-purple-600 transition cursor-pointer"
                                title="View Details"
                              >
                                <Eye size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handlePrintReceipt(ex)}
                                className="p-1 text-gray-500 hover:text-blue-600 transition cursor-pointer"
                                title="Reprint Memo"
                              >
                                <Printer size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSendWhatsApp(ex)}
                                className="p-1 text-gray-500 hover:text-green-600 transition cursor-pointer"
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
                                  className="p-1 text-gray-400 hover:text-red-600 transition cursor-pointer"
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
              Please review the transaction summary below before committing. This will atomically update inventory,
              link sales/purchases, and adjust accounting balances.
            </p>

            <div className="bg-gray-50 dark:bg-slate-800 p-3 rounded-xl space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Customer Old Phone(s):</span>
                <span className="font-bold text-red-600">
                  {incomingPhones.length} Phone(s) (Value: Rs. {totalTradeInCredit.toLocaleString('en-PK')})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">New Phone / Item(s):</span>
                <span className="font-bold text-green-600">
                  {outgoingItems.length} Item(s) (Price: Rs. {totalSaleAmount.toLocaleString('en-PK')})
                </span>
              </div>
              <div className="pt-2 border-t border-gray-200 dark:border-slate-700 flex justify-between font-bold text-sm">
                <span>Net Difference:</span>
                <span className="font-mono text-purple-700 dark:text-purple-400">
                  {settlementDirection === 'customer_paid'
                    ? `Customer Pays Rs. ${absoluteSettlement.toLocaleString('en-PK')}`
                    : settlementDirection === 'shop_payout'
                    ? `Shop Pays Rs. ${absoluteSettlement.toLocaleString('en-PK')}`
                    : 'Equal Exchange (Rs. 0)'}
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

            <h3 className="text-lg font-black text-gray-900 dark:text-white">Exchange Completed!</h3>
            <p className="text-xs text-gray-500">
              Exchange memo <b className="font-mono text-purple-600">{completedExchange.exchange_number}</b> recorded
              successfully.
            </p>

            {/* WhatsApp Outbox Status Banner */}
            {completedExchange.customer_phone ? (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/70 dark:border-emerald-800/60 rounded-xl text-left flex items-center justify-between gap-2 shadow-2xs">
                <div className="flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300 font-medium">
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                  <div>
                    <span className="font-bold">Added to WhatsApp Outbox</span>
                    <span className="block text-[11px] text-emerald-700 dark:text-emerald-400">📱 +{completedExchange.customer_phone}</span>
                  </div>
                </div>
                <Link
                  to="/whatsapp-queue"
                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold shrink-0 transition"
                >
                  View Outbox 📲
                </Link>
              </div>
            ) : (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/70 dark:border-amber-800/60 rounded-xl text-left space-y-2">
                <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                  ⚠️ کسٹمر کا موبائل نمبر درج نہیں تھا۔ آؤٹ باکس میں شامل کرنے کے لیے نمبر درج کریں:
                </p>
                <div className="flex items-center gap-1.5">
                  <input
                    type="tel"
                    placeholder="e.g. 03001234567"
                    value={outboxPromptPhone}
                    onChange={(e) => setOutboxPromptPhone(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleManualEnqueueCompleted}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shrink-0 cursor-pointer"
                  >
                    Add to Outbox 📲
                  </button>
                </div>
              </div>
            )}

            {outboxSuccessMsg && (
              <div className="text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 py-1.5 px-3 rounded-lg border border-emerald-200 dark:border-emerald-800">
                {outboxSuccessMsg}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => handlePrintReceipt(completedExchange)}
                className="py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm cursor-pointer transition active:scale-95"
              >
                <Printer size={15} /> Print Memo
              </button>
              <button
                type="button"
                onClick={() => handleSendWhatsApp(completedExchange)}
                className="py-2.5 px-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm cursor-pointer transition active:scale-95"
              >
                <Send size={15} /> WhatsApp Bill
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowReceiptModal(false)
                setCompletedExchange(null)
                setOutboxPromptPhone('')
                setOutboxSuccessMsg('')
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
                <div>Old Phone Intake: <b>PR-{String(selectedExchangeForView.purchase_id || '').slice(-8)}</b></div>
              </div>
            </div>

            {/* Line Items Snapshots */}
            <div className="space-y-3">
              <div>
                <span className="text-xs font-black text-red-600 uppercase">📥 Customer Old Phone(s)</span>
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
                <span className="text-xs font-black text-green-600 uppercase">📤 New Replacement Item(s)</span>
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
                <span>Total New Phone Price:</span>
                <span className="font-bold font-mono">
                  Rs. {parseFloat(selectedExchangeForView.sale_amount || 0).toLocaleString('en-PK')}
                </span>
              </div>
              <div className="flex justify-between text-red-600">
                <span>Less Old Phone Value:</span>
                <span className="font-bold font-mono">
                  - Rs. {parseFloat(selectedExchangeForView.trade_in_credit || 0).toLocaleString('en-PK')}
                </span>
              </div>
              <div className="pt-1.5 border-t border-purple-200 dark:border-purple-800 flex justify-between font-black text-sm text-purple-700 dark:text-purple-400">
                <span>Net Difference ({selectedExchangeForView.settlement_direction}):</span>
                <span className="font-mono">
                  Rs. {parseFloat(selectedExchangeForView.settlement_amount || 0).toLocaleString('en-PK')}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => handlePrintReceipt(selectedExchangeForView)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Printer size={13} /> Print
              </button>
              <button
                type="button"
                onClick={() => handleSendWhatsApp(selectedExchangeForView)}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Send size={13} /> WhatsApp
              </button>
              <button
                type="button"
                onClick={() => setSelectedExchangeForView(null)}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-bold cursor-pointer"
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
              Voiding this transaction will restore the new items back to available inventory, mark old phones
              as returned to the customer, and reverse cash/bank settlements.
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
                className="px-4 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 text-gray-700 dark:text-gray-300 rounded-xl font-bold text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteVoid}
                disabled={voiding}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
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
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                >
                  Save Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: SPLIT PAYMENT SETTLEMENT ── */}
      {showSplitModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-4 sm:p-5 border border-purple-200 dark:border-purple-900 shadow-2xl space-y-4 max-h-[90dvh] flex flex-col">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-purple-100 dark:bg-purple-900/40 text-purple-600 rounded-lg font-bold text-sm">
                  🔀
                </span>
                <div>
                  <h3 className="font-black text-sm text-gray-900 dark:text-white uppercase tracking-tight">
                    Split Payment Settlement
                  </h3>
                  <p className="text-[10px] text-gray-500">
                    Net Settlement: <b className="text-purple-600">Rs. {absoluteSettlement.toLocaleString('en-PK')}</b>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSplitModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 overflow-y-auto flex-1 custom-scrollbar pr-1">
              {splitAllocations.map((alloc, idx) => (
                <div
                  key={idx}
                  className="p-2.5 bg-gray-50 dark:bg-slate-800/60 rounded-xl border border-gray-200 dark:border-slate-700 space-y-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-gray-700 dark:text-gray-300">
                      Payment Line #{idx + 1}
                    </span>
                    {splitAllocations.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeSplitLine(idx)}
                        className="text-red-500 hover:text-red-700 text-xs font-bold cursor-pointer"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={alloc.method}
                      onChange={e => updateSplitLine(idx, 'method', e.target.value)}
                      className="text-xs p-1.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 font-semibold text-gray-900 dark:text-white"
                    >
                      <option value="cash">💵 Cash Vault</option>
                      <option value="bank">🏦 Bank Account</option>
                    </select>

                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-400 font-bold">Rs.</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="Amount"
                        value={alloc.amount}
                        onChange={e => updateSplitLine(idx, 'amount', e.target.value)}
                        className="w-full text-xs font-bold p-1.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-white text-right"
                      />
                    </div>
                  </div>

                  {alloc.method === 'bank' && (
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 block mb-0.5">Deposit Into Bank:</label>
                      <select
                        value={alloc.account_id}
                        onChange={e => updateSplitLine(idx, 'account_id', e.target.value)}
                        className="w-full text-xs p-1.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-white font-medium"
                      >
                        {bankOnlyAccounts.map(a => (
                          <option key={a.id} value={a.id}>
                            {a.bank_name || a.account_name} ({a.account_name}) - Rs. {Number(a.current_balance).toLocaleString('en-PK')}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={addSplitLine}
                className="w-full py-1.5 border border-dashed border-purple-400 dark:border-purple-700 text-purple-600 dark:text-purple-400 rounded-xl text-xs font-bold hover:bg-purple-50 dark:hover:bg-purple-950/20 transition flex items-center justify-center gap-1 cursor-pointer"
              >
                <Plus size={13} /> Add Another Payment Line
              </button>

              {/* Split Summary */}
              <div className="p-3 bg-purple-50/50 dark:bg-purple-950/20 rounded-xl border border-purple-100 dark:border-purple-900/30 space-y-1 text-xs">
                <div className="flex justify-between text-gray-600 dark:text-gray-300">
                  <span>Net Settlement Due:</span>
                  <span className="font-bold font-mono">Rs. {absoluteSettlement.toLocaleString('en-PK')}</span>
                </div>
                <div className="flex justify-between text-purple-700 dark:text-purple-400">
                  <span>Total Split Allocated:</span>
                  <span className="font-bold font-mono">Rs. {totalSplitAllocated.toLocaleString('en-PK')}</span>
                </div>
                <div className="flex justify-between font-black pt-1 border-t border-purple-200 dark:border-purple-800">
                  <span>Remaining to Allocate:</span>
                  <span className={`font-mono ${splitRemaining === 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    Rs. {splitRemaining.toLocaleString('en-PK')}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowSplitModal(false)}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-bold cursor-pointer transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (splitRemaining !== 0) {
                    alert(`Allocated amount (Rs. ${totalSplitAllocated.toLocaleString('en-PK')}) must equal net settlement (Rs. ${absoluteSettlement.toLocaleString('en-PK')}). Remaining: Rs. ${splitRemaining.toLocaleString('en-PK')}`)
                    return
                  }
                  setShowSplitModal(false)
                }}
                disabled={splitRemaining !== 0}
                className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold cursor-pointer transition disabled:opacity-40"
              >
                Confirm Split Allocation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
