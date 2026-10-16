import { useState, useRef, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { db } from '../services/db'
import { useAuth } from '../context/AuthContext'
import { Plus, Trash2, Smartphone, DollarSign, Shield, CheckCircle, AlertCircle, Scan, Landmark, ChevronDown, Check } from 'lucide-react'
import { searchIphoneModels, getIphoneColorsForModel, ALL_IPHONE_COLORS, IPHONE_MODELS } from '../utils/iphonePresets'
import { getBankAccounts, deductBankBalance } from '../services/bankService'
import BankAccountModal from './BankAccountModal'

const COMMON_BRANDS = ['Apple', 'Samsung', 'Xiaomi', 'Vivo', 'Oppo', 'Realme', 'Google', 'OnePlus', 'Infinix', 'Tecno', 'Other']
const STORAGE_OPTIONS = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB', '2TB']
const CONDITIONS = ['Used', 'New', 'Refurbished']
const DEFAULT_PTA_STATUSES = [
  'PTA Approved',
  'Non-PTA',
  'JV',
  'CPID Approved',
  'VIP Approved',
  'Software Patch',
  '60-Days Extension',
  'Custom'
]

function normalizeCondition(cond) {
  if (!cond) return 'used'
  const c = cond.toLowerCase().trim()
  if (c === 'new' || c === 'brand new' || c === 'brand_new') return 'brand_new'
  if (c === 'refurbished') return 'refurbished'
  if (c === 'open_box' || c === 'open box') return 'open_box'
  if (c === 'faulty') return 'faulty'
  return 'used'
}

function normalizePtaStatus(status) {
  if (!status) return 'approved'
  const s = status.toLowerCase().trim()
  if (s.includes('non') || s === 'non-pta' || s === 'non_pta') return 'non_pta'
  if (s.includes('cpid') || s === 'jv' || s.includes('patch') || s.includes('software')) return 'cpid'
  if (s.includes('vip')) return 'vip'
  if (s.includes('block')) return 'blocked'
  return 'approved'
}

export default function PhonePurchasePanel({ suppliers = [], onPurchaseComplete, onQuickAddSupplier }) {
  const { user } = useAuth()
  const imeiInputRef = useRef(null)

  const [phoneCart, setPhoneCart] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [paymentType, setPaymentType] = useState('cash')
  const [paidAmount, setPaidAmount] = useState('')
  const [purchaseNotes, setPurchaseNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Single phone entry form state
  const [phoneForm, setPhoneForm] = useState({
    imei_1: '',
    imei_2: '',
    brand: 'Apple',
    model: '',
    storage: '128GB',
    color: '',
    condition: 'Used',
    pta_status: 'PTA Approved',
    cost_price: '',
    additional_costs: '',
    sale_price: '',
    notes: ''
  })

  // IMEI Auto-fetch & Buy-back History State
  const [historyMatch, setHistoryMatch] = useState(null)
  const [imeiLookupLoading, setImeiLookupLoading] = useState(false)
  const lookupTimeoutRef = useRef(null)

  // Quick Supplier state
  const [showSupplierModal, setShowSupplierModal] = useState(false)
  const [newSupplierName, setNewSupplierName] = useState('')
  const [newSupplierPhone, setNewSupplierPhone] = useState('')
  const [savingSupplier, setSavingSupplier] = useState(false)

  // Bank Accounts & Deduction state
  const [bankAccounts, setBankAccounts] = useState([])
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('')
  const [showBankModal, setShowBankModal] = useState(false)

  // iPhone Model, Color & PTA Dropdown States
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [showColorDropdown, setShowColorDropdown] = useState(false)
  const [showPtaDropdown, setShowPtaDropdown] = useState(false)
  const modelDropdownRef = useRef(null)
  const colorDropdownRef = useRef(null)
  const ptaDropdownRef = useRef(null)

  // Real-time Custom Colors state
  const [customColors, setCustomColors] = useState(() => {
    try {
      const sid = user?.shop_id
      const saved = sid ? localStorage.getItem(`shop_custom_colors_${sid}`) : null
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [newCustomColor, setNewCustomColor] = useState('')

  // Real-time Custom PTA Statuses state
  const [customPtaStatuses, setCustomPtaStatuses] = useState(() => {
    try {
      const sid = user?.shop_id
      const saved = sid ? localStorage.getItem(`shop_custom_pta_${sid}`) : null
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [newCustomPta, setNewCustomPta] = useState('')

  // Combined PTA statuses list
  const allPtaStatuses = [
    ...customPtaStatuses,
    ...DEFAULT_PTA_STATUSES.filter(s => !customPtaStatuses.includes(s))
  ]

  const handleAddCustomColor = () => {
    const trimmed = newCustomColor.trim()
    if (!trimmed) return
    if (!customColors.includes(trimmed)) {
      const updated = [trimmed, ...customColors]
      setCustomColors(updated)
      if (user?.shop_id) {
        localStorage.setItem(`shop_custom_colors_${user.shop_id}`, JSON.stringify(updated))
      }
    }
    setPhoneForm(prev => ({ ...prev, color: trimmed }))
    setNewCustomColor('')
    setShowColorDropdown(false)
  }

  const handleRemoveCustomColor = (colorToRemove) => {
    const updated = customColors.filter(c => c !== colorToRemove)
    setCustomColors(updated)
    if (user?.shop_id) {
      localStorage.setItem(`shop_custom_colors_${user.shop_id}`, JSON.stringify(updated))
    }
  }

  const handleAddCustomPta = () => {
    const trimmed = newCustomPta.trim()
    if (!trimmed) return
    if (!allPtaStatuses.includes(trimmed)) {
      const updated = [trimmed, ...customPtaStatuses]
      setCustomPtaStatuses(updated)
      if (user?.shop_id) {
        localStorage.setItem(`shop_custom_pta_${user.shop_id}`, JSON.stringify(updated))
      }
    }
    setPhoneForm(prev => ({ ...prev, pta_status: trimmed }))
    setNewCustomPta('')
    setShowPtaDropdown(false)
  }

  const handleRemoveCustomPta = (statusToRemove) => {
    const updated = customPtaStatuses.filter(s => s !== statusToRemove)
    setCustomPtaStatuses(updated)
    if (user?.shop_id) {
      localStorage.setItem(`shop_custom_pta_${user.shop_id}`, JSON.stringify(updated))
    }
  }

  // Load bank accounts
  const loadBankAccounts = async () => {
    if (!user?.shop_id) return
    try {
      const list = await getBankAccounts(user.shop_id)
      setBankAccounts(list)
      setSelectedBankAccountId(prev => {
        if (prev) return prev
        const def = list.find(a => a.is_default)
        return def ? String(def.id) : ''
      })
    } catch (err) {
      console.warn('Failed to load bank accounts:', err)
    }
  }

  useEffect(() => {
    loadBankAccounts()
  }, [user?.shop_id])

  // Click outside listener for model, color, and pta popovers
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target)) {
        setShowModelDropdown(false)
      }
      if (colorDropdownRef.current && !colorDropdownRef.current.contains(e.target)) {
        setShowColorDropdown(false)
      }
      if (ptaDropdownRef.current && !ptaDropdownRef.current.contains(e.target)) {
        setShowPtaDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Calculations
  const totalCost = phoneCart.reduce((sum, p) => sum + (parseFloat(p.cost_price) || 0) + (parseFloat(p.additional_costs) || 0), 0)
  const effectivePaid = paidAmount === '' ? totalCost : (parseFloat(paidAmount) || 0)
  const remainingBalance = Math.max(0, totalCost - effectivePaid)

  // Selected Bank Account
  const selectedBankAccount = bankAccounts.find(b => String(b.id) === String(selectedBankAccountId))

  // Autocomplete Model & Color derivations
  const matchingIphoneModels = searchIphoneModels(phoneForm.model)
  const officialModelColors = IPHONE_MODELS.find(
    m => m.name.toLowerCase() === phoneForm.model.trim().toLowerCase()
  )?.colors || []

  // Focus IMEI 1 input on load
  useEffect(() => {
    imeiInputRef.current?.focus()
  }, [])

  // 🔍 Smart IMEI Auto-Fetch for Customer Phone Buy-Backs
  const performImeiLookup = async (imeiRaw) => {
    const cleanImei = String(imeiRaw || '').replace(/[^0-9]/g, '')
    if (cleanImei.length < 8) {
      setHistoryMatch(null)
      return
    }

    setImeiLookupLoading(true)
    try {
      let foundPhone = null

      // 1. Check local Dexie first for instant response
      try {
        const localPhones = (await db.phones?.toArray()) || []
        foundPhone = localPhones.find(p =>
          (String(p.imei_1 || '').replace(/[^0-9]/g, '') === cleanImei ||
           String(p.imei_2 || '').replace(/[^0-9]/g, '') === cleanImei) &&
          String(p.shop_id) === String(user.shop_id)
        )
      } catch (_) {}

      // 2. Query Supabase if online and not found locally
      if (!foundPhone && navigator.onLine) {
        const { data } = await supabase
          .from('phones')
          .select('*')
          .eq('shop_id', user.shop_id)
          .or(`imei_1.eq.${cleanImei},imei_2.eq.${cleanImei}`)
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (data) foundPhone = data
      }

      if (foundPhone) {
        // Query last sale for this phone to get the customer who bought it
        let saleInfo = null
        if (navigator.onLine) {
          try {
            const { data: saleItems } = await supabase
              .from('sale_items')
              .select('id, sale_id, price, cost_price, created_at, sales(id, customer_name, customer_id, created_at, total_amount)')
              .eq('phone_id', foundPhone.id)
              .order('created_at', { ascending: false })
              .limit(1)

            if (saleItems && saleItems.length > 0) {
              saleInfo = saleItems[0]
            }
          } catch (_) {}
        }

        // Offline fallback for sale history
        if (!saleInfo) {
          try {
            const localItems = (await db.sale_items?.toArray()) || []
            const localSales = (await db.sales?.toArray()) || []
            const matchedItem = localItems.find(i =>
              i.phone_id === foundPhone.id ||
              (i.imei_snapshot && JSON.stringify(i.imei_snapshot).includes(cleanImei))
            )
            if (matchedItem) {
              const matchedSale = localSales.find(s => s.id === matchedItem.sale_id)
              saleInfo = { ...matchedItem, sales: matchedSale }
            }
          } catch (_) {}
        }

        const originalBuyer = foundPhone.customer_name || saleInfo?.sales?.customer_name || 'Customer'
        const originalPhone = foundPhone.customer_phone || ''
        const originalPrice = Number(foundPhone.sale_price || saleInfo?.price || 0)
        const originalCost = Number(foundPhone.cost_price || saleInfo?.cost_price || 0)
        const soldDate = foundPhone.sold_at || saleInfo?.created_at || saleInfo?.sales?.created_at
        const invoiceNo = foundPhone.invoice_no || saleInfo?.sales?.id || saleInfo?.sale_id

        const match = {
          phoneId: foundPhone.id,
          brand: foundPhone.brand,
          model: foundPhone.model,
          storage: foundPhone.storage || '128GB',
          color: foundPhone.color || '',
          pta_status: foundPhone.pta_status || 'PTA Approved',
          imei_1: foundPhone.imei_1,
          imei_2: foundPhone.imei_2 || '',
          originalBuyer,
          originalPhone,
          originalPrice,
          originalCost,
          soldDate,
          invoiceNo,
          status: foundPhone.status
        }

        setHistoryMatch(match)

        // Auto-fill all device specs into form
        setPhoneForm(prev => ({
          ...prev,
          brand: match.brand || prev.brand,
          model: match.model || prev.model,
          storage: match.storage || prev.storage,
          color: match.color || prev.color,
          pta_status: match.pta_status || prev.pta_status,
          imei_2: match.imei_2 || prev.imei_2,
          condition: 'Used',
          sale_price: prev.sale_price || (originalPrice ? String(Math.round(originalPrice * 0.95)) : ''),
          notes: prev.notes || (soldDate ? `[Customer Buy-Back: Originally sold on ${new Date(soldDate).toLocaleDateString()} to ${originalBuyer}]` : `[Buy-Back from ${originalBuyer}]`)
        }))
      } else {
        setHistoryMatch(null)
      }
    } catch (e) {
      console.warn('IMEI lookup error:', e)
    } finally {
      setImeiLookupLoading(false)
    }
  }

  // 1-Click Set Customer as Seller
  const handleSetCustomerAsSeller = async (custName, custPhone) => {
    if (!custName || custName === 'Walk-in Customer' || custName === 'Customer') return
    const existing = suppliers.find(s => s.name?.toLowerCase().trim() === custName.toLowerCase().trim())
    if (existing) {
      setSupplierId(String(existing.id))
      setSuccessMsg(`👤 Selected "${existing.name}" as seller for this buy-back!`)
      return
    }

    try {
      const { data, error } = await supabase.from('suppliers').insert([{
        name: custName.trim(),
        phone: custPhone?.trim() || '',
        shop_id: user.shop_id,
        balance: 0
      }]).select().single()

      if (error) throw error
      if (data) {
        setSupplierId(String(data.id))
        setSuccessMsg(`👤 Created & selected "${data.name}" as seller!`)
        if (onQuickAddSupplier) onQuickAddSupplier(data)
      }
    } catch (err) {
      console.warn('Auto-create supplier notice:', err)
      setNewSupplierName(custName)
      setNewSupplierPhone(custPhone || '')
      setShowSupplierModal(true)
    }
  }

  const handleAddPhoneToCart = (e) => {
    e.preventDefault()
    setErrorMsg('')

    const imei1 = phoneForm.imei_1.trim()
    const imei2 = phoneForm.imei_2.trim()

    if (!imei1) {
      setErrorMsg('IMEI 1 is required!')
      imeiInputRef.current?.focus()
      return
    }

    if (!phoneForm.brand || !phoneForm.model.trim()) {
      setErrorMsg('Brand and Model are required!')
      return
    }

    if (imei2 && imei1 === imei2) {
      setErrorMsg('IMEI 1 and IMEI 2 cannot be identical!')
      return
    }

    // Check duplicate in current cart
    const existsInCart = phoneCart.some(p =>
      p.imei_1 === imei1 ||
      (p.imei_2 && p.imei_2 === imei1) ||
      (imei2 && (p.imei_1 === imei2 || p.imei_2 === imei2))
    )

    if (existsInCart) {
      setErrorMsg(`IMEI (${imei1}) is already added to this purchase batch!`)
      return
    }

    const newPhone = {
      ...phoneForm,
      id: crypto.randomUUID(),
      imei_1: imei1,
      imei_2: imei2 || null,
      model: phoneForm.model.trim(),
      cost_price: parseFloat(phoneForm.cost_price) || 0,
      additional_costs: parseFloat(phoneForm.additional_costs) || 0,
      sale_price: parseFloat(phoneForm.sale_price) || 0
    }

    setPhoneCart(prev => [newPhone, ...prev])

    // Reset IMEI fields and model, keep brand/storage/condition for rapid batch entry
    setPhoneForm(prev => ({
      ...prev,
      imei_1: '',
      imei_2: '',
      notes: ''
    }))
    setHistoryMatch(null)

    imeiInputRef.current?.focus()
  }

  const handleRemoveFromCart = (id) => {
    setPhoneCart(prev => prev.filter(p => p.id !== id))
  }

  const handleCreateSupplier = async (e) => {
    e.preventDefault()
    if (!newSupplierName.trim()) return
    setSavingSupplier(true)
    try {
      const payload = {
        name: newSupplierName.trim(),
        phone: newSupplierPhone.trim(),
        shop_id: user.shop_id,
        balance: 0
      }
      const { data, error } = await supabase.from('suppliers').insert([payload]).select().single()
      if (error) throw error
      if (data) {
        await db.suppliers.put(data)
        if (onQuickAddSupplier) onQuickAddSupplier(data)
        setSupplierId(String(data.id))
        setShowSupplierModal(false)
        setNewSupplierName('')
        setNewSupplierPhone('')
      }
    } catch (err) {
      alert('Error creating supplier: ' + err.message)
    } finally {
      setSavingSupplier(false)
    }
  }

  const handlePostPurchase = async () => {
    if (phoneCart.length === 0) {
      setErrorMsg('Add at least one phone to the batch.')
      return
    }
    if (!supplierId) {
      setErrorMsg('Please select a supplier.')
      return
    }

    setSubmitting(true)
    setErrorMsg('')
    setSuccessMsg('')

    try {
      const phonesPayload = phoneCart.map(p => ({
        imei_1: p.imei_1.trim(),
        imei_2: p.imei_2 ? p.imei_2.trim() : null,
        brand: p.brand || 'Unknown',
        model: p.model || 'Unknown',
        storage: p.storage || null,
        color: p.color || null,
        condition: normalizeCondition(p.condition),
        pta_status: normalizePtaStatus(p.pta_status),
        cost_price: parseFloat(p.cost_price) || 0,
        additional_costs: parseFloat(p.additional_costs) || 0,
        sale_price: parseFloat(p.sale_price) || 0,
        notes: p.notes ? `${p.notes} [PTA: ${p.pta_status}]` : `[PTA: ${p.pta_status}]`
      }))

      // Build effective purchase notes including bank deduction reference if applicable
      let effectiveNotes = purchaseNotes?.trim() || ''
      if (selectedBankAccount && effectivePaid > 0) {
        const bankTag = `[Paid via ${selectedBankAccount.bank_name || 'Bank'} - ${selectedBankAccount.account_name}]`
        effectiveNotes = effectiveNotes ? `${effectiveNotes} ${bankTag}` : bankTag
      }

      // Call Atomic PostgreSQL RPC (primary 7-param signature, with graceful fallback to 6-param signature if schema cache differs)
      let rpcData, rpcError
      const primaryRes = await supabase.rpc('record_phone_purchase', {
        p_supplier_id: parseInt(supplierId),
        p_branch_id: user.branch_id || null,
        p_phones: phonesPayload,
        p_total_amount: totalCost,
        p_paid_amount: effectivePaid,
        p_payment_type: paymentType,
        p_notes: effectiveNotes || null
      })

      if (primaryRes.error && (primaryRes.error.code === 'PGRST202' || primaryRes.error.message?.includes('schema cache'))) {
        console.warn('Falling back to legacy record_phone_purchase signature...', primaryRes.error.message)
        const fallbackRes = await supabase.rpc('record_phone_purchase', {
          p_supplier_id: parseInt(supplierId),
          p_phones: phonesPayload,
          p_total_amount: totalCost,
          p_paid_amount: effectivePaid,
          p_payment_method: paymentType,
          p_remarks: effectiveNotes || null
        })
        rpcData = fallbackRes.data
        rpcError = fallbackRes.error
      } else {
        rpcData = primaryRes.data
        rpcError = primaryRes.error
      }

      // Check for real duplicate IMEI conflict
      if (rpcData && !rpcData.success && rpcData.error?.includes('already exists')) {
        throw new Error(rpcData.error)
      }

      // If RPC failed due to session, cache, or schema mismatch, execute resilient direct table insert
      if (rpcError || (rpcData && !rpcData.success)) {
        console.warn('PhonePurchasePanel: RPC failed (' + (rpcError?.message || rpcData?.error) + '). Falling back to direct database insert...')
        
        // 1. Insert Purchase Record
        let purchaseId = null
        const purchaseRecord = {
          shop_id: user.shop_id,
          branch_id: user.branch_id || null,
          user_id: user.id || null,
          supplier_id: parseInt(supplierId),
          total_amount: totalCost,
          net_amount: totalCost,
          paid_amount: effectivePaid,
          amount_paid: effectivePaid,
          payment_method: paymentType,
          payment_type: paymentType,
          remarks: effectiveNotes || null,
          notes: effectiveNotes || null,
          status: 'completed',
          created_at: new Date().toISOString()
        }
        
        let pRes = await supabase.from('purchases').insert([purchaseRecord]).select().single()
        if (pRes.error) {
          // Retry with core columns
          const corePurchase = {
            shop_id: user.shop_id,
            supplier_id: parseInt(supplierId),
            total_amount: totalCost,
            amount_paid: effectivePaid,
            payment_method: paymentType,
            remarks: effectiveNotes || null
          }
          pRes = await supabase.from('purchases').insert([corePurchase]).select().single()
        }
        
        if (pRes.error) throw pRes.error
        purchaseId = pRes.data.id

        // 2. Insert Phones & Purchase Items
        for (const phoneItem of phoneCart) {
          const cleanCondition = normalizeCondition(phoneItem.condition)
          const cleanPta = phoneItem.pta_status || 'approved'
          const costVal = parseFloat(phoneItem.cost_price) || 0
          const saleVal = parseFloat(phoneItem.sale_price) || 0

          const phoneRecord = {
            shop_id: user.shop_id,
            branch_id: user.branch_id || null,
            imei_1: phoneItem.imei_1?.trim(),
            imei_2: phoneItem.imei_2?.trim() || null,
            brand: phoneItem.brand?.trim() || 'Unknown',
            model: phoneItem.model?.trim() || 'Unknown Phone',
            storage: phoneItem.storage || null,
            color: phoneItem.color || null,
            condition: cleanCondition,
            pta_status: cleanPta,
            cost_price: costVal,
            sale_price: saleVal,
            selling_price: saleVal,
            expected_sale_price: saleVal,
            supplier_id: parseInt(supplierId),
            purchase_id: purchaseId,
            status: 'in_stock',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }

          let phoneRes = await supabase.from('phones').insert([phoneRecord]).select().single()
          if (phoneRes.error) {
            // Retry with core columns
            const corePhone = {
              shop_id: user.shop_id,
              imei_1: phoneItem.imei_1?.trim(),
              brand: phoneItem.brand?.trim() || 'Unknown',
              model: phoneItem.model?.trim() || 'Unknown Phone',
              cost_price: costVal,
              sale_price: saleVal,
              supplier_id: parseInt(supplierId),
              purchase_id: purchaseId,
              status: 'in_stock'
            }
            phoneRes = await supabase.from('phones').insert([corePhone]).select().single()
          }

          if (phoneRes.error) throw phoneRes.error
          const savedPhone = phoneRes.data

          // Insert Purchase Item
          const itemRecord = {
            purchase_id: purchaseId,
            phone_id: savedPhone.id,
            quantity: 1,
            unit_price: costVal,
            cost_price: costVal,
            total_price: costVal,
            subtotal: costVal
          }
          await supabase.from('purchase_items').insert([itemRecord]).catch(() => {})
        }

        // 3. Update Supplier Balance
        const balanceIncrease = totalCost - effectivePaid
        if (balanceIncrease > 0) {
          const { data: curSup } = await supabase.from('suppliers').select('balance, outstanding_balance').eq('id', supplierId).maybeSingle()
          const newBal = (curSup?.outstanding_balance || curSup?.balance || 0) + balanceIncrease
          await supabase.from('suppliers').update({ balance: newBal, outstanding_balance: newBal }).eq('id', supplierId).catch(() => {})
        }

        // 4. Record Supplier Payment if paid > 0
        if (effectivePaid > 0) {
          await supabase.from('supplier_payments').insert([{
            shop_id: user.shop_id,
            branch_id: user.branch_id || null,
            supplier_id: parseInt(supplierId),
            amount: effectivePaid,
            payment_method: paymentType,
            payment_type: 'payment',
            description: `Payment for Phone Purchase PR-${purchaseId} (${paymentType})`
          }]).catch(() => {})
        }

        rpcData = {
          success: true,
          purchase_id: purchaseId,
          phones_count: phoneCart.length
        }
      }

      // Cache phones locally in Dexie
      try {
        const cachedPhones = phoneCart.map(p => ({
          ...p,
          shop_id: user.shop_id,
          branch_id: user.branch_id,
          supplier_id: parseInt(supplierId),
          purchase_id: rpcData.purchase_id,
          condition: normalizeCondition(p.condition),
          pta_status: p.pta_status,
          status: 'in_stock'
        }))
        await db.phones.bulkPut(cachedPhones)
      } catch (cacheErr) {
        console.warn('Local Dexie cache notice:', cacheErr)
      }

      // Automatically deduct from chosen bank account
      let bankDeductionResult = null
      if (selectedBankAccountId && effectivePaid > 0) {
        try {
          bankDeductionResult = await deductBankBalance({
            shopId: user.shop_id,
            accountId: Number(selectedBankAccountId),
            amount: effectivePaid,
            purchaseId: rpcData.purchase_id,
            description: `Phone Purchase PR-${rpcData.purchase_id} (${phoneCart.length} phones)`
          })
          const updated = await getBankAccounts(user.shop_id)
          setBankAccounts(updated)
        } catch (bankErr) {
          console.warn('Bank balance deduction warning:', bankErr)
        }
      }

      const phonesCountAdded = rpcData.phones_count || rpcData.phone_count || phoneCart.length
      const bankNotice = bankDeductionResult
        ? ` Paid Rs. ${effectivePaid.toLocaleString()} from ${selectedBankAccount?.account_name || 'Bank Account'}.`
        : ''
      setSuccessMsg(`✅ Purchase PR-${rpcData.purchase_id} recorded successfully! ${phonesCountAdded} phones added to inventory.${bankNotice}`)
      setPhoneCart([])
      setPaidAmount('')
      setPurchaseNotes('')

      if (onPurchaseComplete) {
        onPurchaseComplete(rpcData)
      }
    } catch (err) {
      console.error('Phone purchase error:', err)
      setErrorMsg(err.message || 'Failed to record purchase.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Messages */}
      {errorMsg && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2 text-sm font-semibold">
          <AlertCircle className="w-5 h-5 shrink-0 text-red-500" />
          <span>{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center gap-2 text-sm font-semibold">
          <CheckCircle className="w-5 h-5 shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Main Grid: Form Left, Batch Summary Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* ── Left Column: Fast Phone Entry Form (7 cols) ── */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sm:p-5">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                <Smartphone className="w-5 h-5" />
              </div>
              <h2 className="font-bold text-gray-800 text-base">Scan & Add Phone</h2>
            </div>
            <span className="text-[11px] font-semibold text-gray-400 bg-gray-50 px-2 py-1 rounded-md">
              Barcode / Serial Scanner Ready
            </span>
          </div>

          <form onSubmit={handleAddPhoneToCart} className="space-y-4">
            {/* IMEI Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                    IMEI 1 <span className="text-red-500">*</span>
                  </label>
                  {imeiLookupLoading && (
                    <span className="text-[10px] text-blue-600 font-semibold animate-pulse flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping"></span>
                      Checking History...
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    ref={imeiInputRef}
                    type="text"
                    required
                    placeholder="Scan or enter IMEI 1..."
                    value={phoneForm.imei_1}
                    onChange={e => {
                      const val = e.target.value
                      setPhoneForm(prev => ({ ...prev, imei_1: val }))
                      if (lookupTimeoutRef.current) clearTimeout(lookupTimeoutRef.current)
                      lookupTimeoutRef.current = setTimeout(() => {
                        performImeiLookup(val)
                      }, 350)
                    }}
                    onBlur={() => performImeiLookup(phoneForm.imei_1)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        performImeiLookup(phoneForm.imei_1)
                      }
                    }}
                    className={`w-full pl-9 pr-8 py-2 border rounded-xl font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition ${
                      historyMatch ? 'border-amber-400 bg-amber-50/20' : 'border-gray-300'
                    }`}
                  />
                  <Scan className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                  {imeiLookupLoading && (
                    <div className="absolute right-3 top-2.5">
                      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  IMEI 2 <span className="text-gray-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="Scan or enter IMEI 2..."
                  value={phoneForm.imei_2}
                  onChange={e => setPhoneForm(prev => ({ ...prev, imei_2: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                />
              </div>
            </div>

            {/* 🌟 Buy-Back / Previous Store Sale History Card */}
            {historyMatch && (
              <div className="bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-yellow-500/10 border border-amber-300/80 dark:border-amber-500/40 rounded-[18px] p-4 text-xs shadow-xs animate-in fade-in duration-300">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <span className="text-2xl shrink-0">🌟</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white uppercase tracking-wider">
                          Device Sold by Us Before (Buy-Back)
                        </span>
                        <span className="text-[10px] text-gray-500 font-semibold">• Specs Auto-Filled</span>
                      </div>
                      <h4 className="font-bold text-gray-900 dark:text-white text-sm mt-1">
                        {historyMatch.brand} {historyMatch.model} {historyMatch.storage} {historyMatch.color ? `(${historyMatch.color})` : ''}
                      </h4>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-600 dark:text-gray-300 text-[11px] mt-1 font-medium">
                        <span>👤 Sold to: <strong className="text-gray-900 dark:text-white font-bold">{historyMatch.originalBuyer}</strong></span>
                        {historyMatch.soldDate && (
                          <span>📅 Sold Date: <strong className="text-gray-900 dark:text-white font-bold">{new Date(historyMatch.soldDate).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></span>
                        )}
                        {historyMatch.originalPrice > 0 && (
                          <span>💰 Sold At: <strong className="text-emerald-700 dark:text-emerald-400 font-bold">Rs. {historyMatch.originalPrice.toLocaleString()}</strong></span>
                        )}
                        {historyMatch.invoiceNo && (
                          <span>🧾 Invoice: <strong className="text-blue-700 dark:text-blue-400 font-bold">#{String(historyMatch.invoiceNo).slice(-8)}</strong></span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                    {historyMatch.originalBuyer && historyMatch.originalBuyer !== 'Walk-in Customer' && historyMatch.originalBuyer !== 'Customer' && (
                      <button
                        type="button"
                        onClick={() => handleSetCustomerAsSeller(historyMatch.originalBuyer, historyMatch.originalPhone)}
                        className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white rounded-full text-xs font-bold transition shadow-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>👤</span>
                        <span>Set {historyMatch.originalBuyer} as Seller</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setHistoryMatch(null)}
                      className="px-2 py-1 text-gray-400 hover:text-gray-700 text-xs font-bold cursor-pointer"
                      title="Dismiss alert"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Brand, Model, Storage */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Brand</label>
                <select
                  value={phoneForm.brand}
                  onChange={e => {
                    const b = e.target.value
                    setPhoneForm(prev => ({ ...prev, brand: b }))
                    if (b === 'Apple') setShowModelDropdown(true)
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
                >
                  {COMMON_BRANDS.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>

              {/* Model field with Shorthand & Dropdown Autocomplete */}
              <div className="relative" ref={modelDropdownRef}>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Model <span className="text-red-500">*</span>
                  </label>
                  {phoneForm.brand === 'Apple' && (
                    <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.2 rounded">
                      Type 11, 14, 16, X...
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder={phoneForm.brand === 'Apple' ? 'e.g. 11, 14, 16 Pro, X...' : 'e.g. S24 Ultra'}
                    value={phoneForm.model}
                    onChange={e => {
                      const val = e.target.value
                      setPhoneForm(prev => ({ ...prev, model: val }))
                      setShowModelDropdown(true)
                    }}
                    onFocus={() => {
                      if (phoneForm.brand === 'Apple' || !phoneForm.model) {
                        setShowModelDropdown(true)
                      }
                    }}
                    className="w-full pl-3 pr-8 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none font-medium bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowModelDropdown(prev => !prev)}
                    className="absolute right-2 top-2.5 text-gray-400 hover:text-gray-600 cursor-pointer"
                    title="Toggle iPhone Models Dropdown"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>

                {/* iPhone Models Dropdown Popover */}
                {showModelDropdown && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-2xl z-40 max-h-60 overflow-y-auto divide-y divide-gray-100">
                    <div className="p-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between text-[11px] font-bold text-gray-500">
                      <span>Apple iPhone Presets ({matchingIphoneModels.length})</span>
                      <span className="text-[10px] text-gray-400">Click or type shorthand</span>
                    </div>
                    {matchingIphoneModels.length === 0 ? (
                      <div className="p-3 text-xs text-gray-400 text-center">
                        No iPhone preset matching "{phoneForm.model}". Custom model will be kept.
                      </div>
                    ) : (
                      matchingIphoneModels.map(m => (
                        <button
                          key={m.name}
                          type="button"
                          onClick={() => {
                            setPhoneForm(prev => ({
                              ...prev,
                              brand: 'Apple',
                              model: m.name,
                              storage: m.defaultStorage || prev.storage || '128GB',
                              color: m.colors?.[0] || prev.color
                            }))
                            setShowModelDropdown(false)
                          }}
                          className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-blue-50 transition cursor-pointer ${
                            phoneForm.model.toLowerCase() === m.name.toLowerCase() ? 'bg-blue-50/80 font-bold text-blue-700' : 'text-gray-800'
                          }`}
                        >
                          <div>
                            <span className="font-bold">{m.name}</span>
                            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">
                              Series {m.series}
                            </span>
                          </div>
                          <span className="text-[10px] text-gray-400 truncate max-w-[120px]">
                            {m.colors.slice(0, 2).join(', ')}...
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Storage</label>
                <select
                  value={phoneForm.storage}
                  onChange={e => setPhoneForm(prev => ({ ...prev, storage: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
                >
                  {STORAGE_OPTIONS.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Color, Condition, PTA Status */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Color field with Official iPhone Colors Dropdown & Quick Badges */}
              <div className="relative" ref={colorDropdownRef}>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">Color</label>
                  {phoneForm.brand === 'Apple' && officialModelColors.length > 0 && (
                    <span className="text-[10px] text-emerald-600 font-semibold bg-emerald-50 px-1.5 py-0.2 rounded">
                      Official Colors
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="e.g. Natural Titanium / Black"
                    value={phoneForm.color}
                    onChange={e => {
                      setPhoneForm(prev => ({ ...prev, color: e.target.value }))
                      setShowColorDropdown(true)
                    }}
                    onFocus={() => setShowColorDropdown(true)}
                    className="w-full pl-3 pr-8 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowColorDropdown(prev => !prev)}
                    className="absolute right-2 top-2.5 text-gray-400 hover:text-gray-600 cursor-pointer"
                    title="Choose Color"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>

                {/* Quick Color Badges for Selected Model */}
                {officialModelColors.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {officialModelColors.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setPhoneForm(prev => ({ ...prev, color: c }))}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition cursor-pointer ${
                          phoneForm.color === c
                            ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                            : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-200'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}

                {/* Quick Badges for Custom Colors */}
                {customColors.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {customColors.map(c => (
                      <button
                        key={'badge-cust-' + c}
                        type="button"
                        onClick={() => setPhoneForm(prev => ({ ...prev, color: c }))}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition cursor-pointer ${
                          phoneForm.color === c
                            ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                            : 'bg-blue-50/70 hover:bg-blue-100 text-blue-700 border-blue-200'
                        }`}
                      >
                        ★ {c}
                      </button>
                    ))}
                  </div>
                )}

                {/* Color Dropdown Popover */}
                {showColorDropdown && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-2xl z-40 max-h-60 overflow-y-auto divide-y divide-gray-100 animate-in fade-in slide-in-from-top-1 duration-150">
                    {/* Real-time Add Custom Color input */}
                    <div className="p-2 bg-slate-50 border-b border-gray-100">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={newCustomColor}
                          onChange={e => setNewCustomColor(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              handleAddCustomColor()
                            }
                          }}
                          placeholder="Add custom color..."
                          className="flex-1 px-2.5 py-1 text-xs border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        />
                        <button
                          type="button"
                          onClick={handleAddCustomColor}
                          disabled={!newCustomColor.trim()}
                          className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <Plus className="w-3 h-3" /> Add
                        </button>
                      </div>
                    </div>

                    {/* Custom Colors Section */}
                    {customColors.length > 0 && (
                      <div className="p-1.5 bg-blue-50/50">
                        <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider px-2 py-0.5">
                          Custom Colors ({customColors.length})
                        </p>
                        <div className="flex flex-wrap gap-1 p-1">
                          {customColors.map(c => (
                            <div
                              key={'cust-drop-' + c}
                              className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border transition ${
                                phoneForm.color === c ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-blue-200'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setPhoneForm(prev => ({ ...prev, color: c }))
                                  setShowColorDropdown(false)
                                }}
                                className="font-medium cursor-pointer"
                              >
                                {c}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleRemoveCustomColor(c)
                                }}
                                className="text-[10px] opacity-60 hover:opacity-100 hover:text-red-500 ml-1 cursor-pointer"
                                title="Remove custom color"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {officialModelColors.length > 0 && (
                      <div className="p-1.5 bg-gray-50">
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-2 py-1">
                          Official {phoneForm.model} Colors
                        </p>
                        {officialModelColors.map(c => (
                          <button
                            key={'official-' + c}
                            type="button"
                            onClick={() => {
                              setPhoneForm(prev => ({ ...prev, color: c }))
                              setShowColorDropdown(false)
                            }}
                            className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between hover:bg-blue-50 transition cursor-pointer ${
                              phoneForm.color === c ? 'bg-blue-50 text-blue-700 font-bold' : 'text-gray-800'
                            }`}
                          >
                            <span>{c}</span>
                            {phoneForm.color === c && <Check className="w-3.5 h-3.5 text-blue-600" />}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="p-1.5">
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-2 py-1">
                        All Apple iPhone Colors
                      </p>
                      {ALL_IPHONE_COLORS.filter(c => !officialModelColors.includes(c)).map(c => (
                        <button
                          key={'all-' + c}
                          type="button"
                          onClick={() => {
                            setPhoneForm(prev => ({ ...prev, color: c }))
                            setShowColorDropdown(false)
                          }}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between hover:bg-blue-50 transition cursor-pointer ${
                            phoneForm.color === c ? 'bg-blue-50 text-blue-700 font-bold' : 'text-gray-800'
                          }`}
                        >
                          <span>{c}</span>
                          {phoneForm.color === c && <Check className="w-3.5 h-3.5 text-blue-600" />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Condition</label>
                <select
                  value={phoneForm.condition}
                  onChange={e => setPhoneForm(prev => ({ ...prev, condition: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
                >
                  {CONDITIONS.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* PTA Status Combobox with Real-Time Custom Addition */}
              <div className="relative" ref={ptaDropdownRef}>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">PTA Status</label>
                  <button
                    type="button"
                    onClick={() => setShowPtaDropdown(prev => !prev)}
                    className="text-[10px] text-blue-600 font-semibold hover:underline flex items-center gap-0.5 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> Custom
                  </button>
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowPtaDropdown(prev => !prev)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm font-bold text-left flex items-center justify-between bg-white text-blue-700 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
                  >
                    <span className="truncate">{phoneForm.pta_status || 'PTA Approved'}</span>
                    <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                  </button>
                </div>

                {/* PTA Status Dropdown Popover */}
                {showPtaDropdown && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-2xl z-40 max-h-64 overflow-y-auto divide-y divide-gray-100 animate-in fade-in slide-in-from-top-1 duration-150">
                    {/* Real-time Add Custom PTA Status input */}
                    <div className="p-2 bg-slate-50 border-b border-gray-100">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={newCustomPta}
                          onChange={e => setNewCustomPta(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              handleAddCustomPta()
                            }
                          }}
                          placeholder="Type custom status (e.g. Tax Paid)..."
                          className="flex-1 px-2.5 py-1 text-xs border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        />
                        <button
                          type="button"
                          onClick={handleAddCustomPta}
                          disabled={!newCustomPta.trim()}
                          className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <Plus className="w-3 h-3" /> Add
                        </button>
                      </div>
                    </div>

                    {/* Custom PTA Statuses List */}
                    {customPtaStatuses.length > 0 && (
                      <div className="p-1.5 bg-blue-50/40">
                        <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider px-2 py-0.5">
                          Your Custom Statuses
                        </p>
                        <div className="space-y-0.5">
                          {customPtaStatuses.map(s => (
                            <div
                              key={'cust-pta-' + s}
                              className="flex items-center justify-between px-2.5 py-1 rounded-lg text-xs hover:bg-blue-50 transition"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setPhoneForm(prev => ({ ...prev, pta_status: s }))
                                  setShowPtaDropdown(false)
                                }}
                                className="flex-1 text-left font-semibold text-gray-800 cursor-pointer"
                              >
                                {s}
                              </button>
                              <div className="flex items-center gap-1">
                                {phoneForm.pta_status === s && <Check className="w-3.5 h-3.5 text-blue-600" />}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleRemoveCustomPta(s)
                                  }}
                                  className="text-gray-400 hover:text-red-500 text-xs ml-1 cursor-pointer"
                                  title="Delete custom status"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Standard PTA Statuses */}
                    <div className="p-1.5">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2 py-0.5">
                        Standard Statuses
                      </p>
                      <div className="space-y-0.5">
                        {DEFAULT_PTA_STATUSES.map(s => (
                          <button
                            key={'std-pta-' + s}
                            type="button"
                            onClick={() => {
                              setPhoneForm(prev => ({ ...prev, pta_status: s }))
                              setShowPtaDropdown(false)
                            }}
                            className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between hover:bg-gray-100 transition cursor-pointer ${
                              phoneForm.pta_status === s ? 'bg-blue-50 text-blue-700 font-bold' : 'text-gray-700'
                            }`}
                          >
                            <span>{s}</span>
                            {phoneForm.pta_status === s && <Check className="w-3.5 h-3.5 text-blue-600" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Pricing Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-gray-50/70 p-3 rounded-xl border border-gray-100">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Purchase Cost (Rs.) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  placeholder="e.g. 150000"
                  value={phoneForm.cost_price}
                  onChange={e => setPhoneForm(prev => ({ ...prev, cost_price: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm font-bold text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Direct Cost (Rs.)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="Repair/Tax"
                  value={phoneForm.additional_costs}
                  onChange={e => setPhoneForm(prev => ({ ...prev, additional_costs: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Target Sale (Rs.)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="e.g. 175000"
                  value={phoneForm.sale_price}
                  onChange={e => setPhoneForm(prev => ({ ...prev, sale_price: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm font-bold text-emerald-700 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm transition cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Add Phone to Batch
              </button>
            </div>
          </form>
        </div>

        {/* ── Right Column: Batch List & Payment Settlement (5 cols) ── */}
        <div className="lg:col-span-5 flex flex-col gap-4">

          {/* Supplier Picker Card */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                Supplier <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => setShowSupplierModal(true)}
                className="text-xs text-blue-600 font-bold hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> New Supplier
              </button>
            </div>
            <select
              value={supplierId}
              onChange={e => setSupplierId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            >
              <option value="">-- Choose Supplier --</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name} {s.phone ? `(${s.phone})` : ''}</option>
              ))}
            </select>
          </div>

          {/* Batch Inward List */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 flex-1 flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h3 className="font-bold text-gray-800 text-sm">Phones in Batch ({phoneCart.length})</h3>
              <span className="text-xs font-mono font-bold text-blue-600">
                Rs. {totalCost.toLocaleString()}
              </span>
            </div>

            <div className="my-3 max-h-56 overflow-y-auto space-y-2 pr-1 custom-scrollbar flex-1">
              {phoneCart.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-xs">
                  <Smartphone className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  No phones in batch yet. Scan IMEI to add.
                </div>
              ) : (
                phoneCart.map((p, idx) => (
                  <div key={p.id || idx} className="p-2.5 rounded-xl border border-gray-100 bg-gray-50/50 hover:bg-gray-50 flex items-center justify-between text-xs">
                    <div className="min-w-0 pr-2">
                      <p className="font-bold text-gray-800 truncate">
                        {p.brand} {p.model} <span className="text-gray-500 font-normal">({p.storage})</span>
                      </p>
                      <p className="font-mono text-[11px] text-gray-500">IMEI: {p.imei_1}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] font-bold px-1.5 py-0.2 bg-blue-100 text-blue-800 rounded">
                          {p.pta_status}
                        </span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.2 bg-gray-200 text-gray-700 rounded">
                          {p.condition}
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-gray-900">Rs. {(p.cost_price + p.additional_costs).toLocaleString()}</p>
                      <button
                        type="button"
                        onClick={() => handleRemoveFromCart(p.id)}
                        className="text-red-500 hover:text-red-700 mt-1 cursor-pointer"
                        title="Remove phone"
                      >
                        <Trash2 className="w-3.5 h-3.5 ml-auto" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Payment & Settlement Summary */}
            <div className="border-t border-gray-100 pt-3 space-y-2.5">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="block text-[11px] font-bold text-gray-600 mb-1">Payment Method</label>
                  <select
                    value={paymentType}
                    onChange={e => {
                      const val = e.target.value
                      setPaymentType(val)
                      if (val === 'bank' && !selectedBankAccountId && bankAccounts.length > 0) {
                        const def = bankAccounts.find(b => b.is_default) || bankAccounts[0]
                        if (def) setSelectedBankAccountId(String(def.id))
                      }
                    }}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs font-semibold outline-none bg-white"
                  >
                    <option value="cash">💵 Cash Paid</option>
                    <option value="bank">🏦 Bank Transfer</option>
                    <option value="credit">📒 Credit (Udhaar)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-600 mb-1">Paid Amount (Rs.)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder={totalCost.toString()}
                    value={paidAmount}
                    onChange={e => setPaidAmount(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs font-bold outline-none"
                  />
                </div>
              </div>

              {/* Bank Account Selection & Live Balance Deduction Preview */}
              {(paymentType === 'bank' || (paymentType === 'cash' && effectivePaid > 0)) && (
                <div className={`rounded-xl p-3 space-y-2 text-xs border transition ${
                  paymentType === 'bank'
                    ? 'bg-blue-50/90 border-blue-300 ring-2 ring-blue-100'
                    : 'bg-blue-50/60 border-blue-200'
                }`}>
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-blue-900 flex items-center gap-1.5 uppercase tracking-wide">
                      <Landmark className="w-3.5 h-3.5 text-blue-600" />
                      {paymentType === 'bank' ? '🏦 Pay Through Bank Account *' : 'Deduct From Bank (Optional)'}
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowBankModal(true)}
                      className="text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" /> + Add Bank
                    </button>
                  </div>

                  {bankAccounts.length === 0 ? (
                    <div className="bg-white p-2.5 rounded-lg border border-blue-200 space-y-1.5">
                      <p className="text-gray-600 text-[11px] font-medium">
                        No business bank accounts found yet. Add your Meezan, HBL, Bank Alfalah, etc. to deduct from balance.
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowBankModal(true)}
                        className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 shadow-sm"
                      >
                        <Plus className="w-3 h-3" /> Link Bank Account Now
                      </button>
                    </div>
                  ) : (
                    <select
                      value={selectedBankAccountId}
                      onChange={e => setSelectedBankAccountId(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-blue-300 rounded-lg text-xs font-semibold outline-none bg-white focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">{paymentType === 'bank' ? '-- Select Bank Account --' : '-- No Bank Deduction (Cash Drawer) --'}</option>
                      {bankAccounts.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.bank_name ? `${b.bank_name} - ` : ''}{b.account_name} (Rs. {b.current_balance.toLocaleString()}) {b.is_default ? '★' : ''}
                        </option>
                      ))}
                    </select>
                  )}

                  {selectedBankAccount && (
                    <div className="pt-1 border-t border-blue-100 flex flex-col gap-1 text-[11px]">
                      <div className="flex justify-between items-center text-blue-800 font-medium">
                        <span>Current Account Balance:</span>
                        <span className="font-mono font-bold">Rs. {selectedBankAccount.current_balance.toLocaleString()}</span>
                      </div>
                      {effectivePaid > 0 && (
                        <div className="flex justify-between items-center text-blue-950 font-bold">
                          <span>Balance After Deduction:</span>
                          <span className={`font-mono ${selectedBankAccount.current_balance < effectivePaid ? 'text-red-600' : 'text-emerald-700'}`}>
                            Rs. {(selectedBankAccount.current_balance - effectivePaid).toLocaleString()}
                          </span>
                        </div>
                      )}
                      {effectivePaid > 0 && selectedBankAccount.current_balance < effectivePaid && (
                        <p className="text-[10px] text-red-600 font-semibold pt-0.5">
                          ⚠️ Warning: Deduction will make this bank account balance negative.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {remainingBalance > 0 && (
                <div className="flex justify-between items-center text-xs text-orange-700 bg-orange-50 px-2.5 py-1.5 rounded-lg border border-orange-100 font-semibold">
                  <span>Balance Payable to Supplier:</span>
                  <span className="font-bold font-mono">Rs. {remainingBalance.toLocaleString()}</span>
                </div>
              )}

              <button
                type="button"
                disabled={submitting || phoneCart.length === 0}
                onClick={handlePostPurchase}
                className={`w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition shadow-sm ${
                  submitting || phoneCart.length === 0
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer'
                }`}
              >
                {submitting ? 'Posting Purchase...' : `Confirm Purchase (Rs. ${totalCost.toLocaleString()})`}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Add Supplier Modal */}
      {showSupplierModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <h3 className="font-bold text-gray-900 text-base">Quick Add Supplier</h3>
            <form onSubmit={handleCreateSupplier} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Supplier Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ali Wholesaler"
                  value={newSupplierName}
                  onChange={e => setNewSupplierName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Phone Number</label>
                <input
                  type="text"
                  placeholder="0300-1234567"
                  value={newSupplierPhone}
                  onChange={e => setNewSupplierPhone(e.target.value)}
                  className="w-full px-3 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSupplierModal(false)}
                  className="px-4 py-2 border text-gray-600 rounded-xl text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSupplier}
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold"
                >
                  {savingSupplier ? 'Saving...' : 'Save Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Add Bank Account Modal */}
      {showBankModal && (
        <BankAccountModal
          isOpen={showBankModal}
          onClose={() => setShowBankModal(false)}
          shopId={user?.shop_id}
          onSuccess={(newAcc) => {
            setBankAccounts(prev => [newAcc, ...prev])
            setSelectedBankAccountId(String(newAcc.id))
            setPaymentType('bank')
          }}
        />
      )}
    </div>
  )
}
