import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { db, addToSyncQueue } from '../services/db'
import { recordAuditLog } from '../services/auditService'
import { getShopPreset, getPricingConfig } from '../utils/businessPresets'
import { getBankAccounts, deductBankBalance, findOrCreateAccountForPayment } from '../services/bankService'
import BankAccountModal from '../components/BankAccountModal'

function AddProduct() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const shopSettings = (() => {
    try {
      const sid = user?.shop_id
      return JSON.parse((sid ? localStorage.getItem(`shop_settings_${sid}`) : null) || '{}')
    } catch (_) { return {} }
  })()
  const preset = getShopPreset(shopSettings)
  const pricingConfig = getPricingConfig(shopSettings)

  const [categories, setCategories] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [brands, setBrands] = useState([])
  const [units, setUnits] = useState([])
  const [brandCategoryMap, setBrandCategoryMap] = useState({})
  const [loading, setLoading] = useState(false)
  const [showNewBrandInput, setShowNewBrandInput] = useState(false)
  const [newBrandName, setNewBrandName] = useState('')

  // Bank & Payment state for initial purchase
  const [bankAccounts, setBankAccounts] = useState([])
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('')
  const [selectedCashVaultId, setSelectedCashVaultId] = useState('')
  const [paymentType, setPaymentType] = useState('cash') // 'cash' | 'bank' | 'credit'
  const [showBankModal, setShowBankModal] = useState(false)
  const [skipInitialPurchase, setSkipInitialPurchase] = useState(false)

  const cashVaults = bankAccounts.filter(a =>
    a.bank_name?.toLowerCase().includes('cash') ||
    a.account_name?.toLowerCase().includes('cash') ||
    a.account_number === 'CASH'
  )
  const bankOnlyAccounts = bankAccounts.filter(a =>
    !a.bank_name?.toLowerCase().includes('cash') &&
    !a.account_name?.toLowerCase().includes('cash') &&
    a.account_number !== 'CASH'
  )

  const [form, setForm] = useState({
    name: '',
    sku: '',
    brand: '',
    category_id: '',
    supplier_id: '',
    unit_id: '',
    c_rate: '',
    cost_price: '',
    sale_price: '',
    stock_quantity: '',
    low_stock_threshold: '10',
    status: 'active'
  })

  const fetchBankAccounts = async () => {
    if (!user?.shop_id) return
    try {
      const list = await getBankAccounts(user.shop_id)
      setBankAccounts(list)
      const defBank = list.find(a => a.is_default && !a.bank_name?.toLowerCase().includes('cash') && !a.account_name?.toLowerCase().includes('cash') && a.account_number !== 'CASH')
        || list.find(a => !a.bank_name?.toLowerCase().includes('cash') && !a.account_name?.toLowerCase().includes('cash') && a.account_number !== 'CASH')
      if (defBank && !selectedBankAccountId) setSelectedBankAccountId(String(defBank.id))

      const defCash = list.find(a => a.is_default && (a.bank_name?.toLowerCase().includes('cash') || a.account_name?.toLowerCase().includes('cash') || a.account_number === 'CASH'))
        || list.find(a => a.bank_name?.toLowerCase().includes('cash') || a.account_name?.toLowerCase().includes('cash') || a.account_number === 'CASH')
      if (defCash && !selectedCashVaultId) setSelectedCashVaultId(String(defCash.id))
    } catch (e) {
      console.warn('AddProduct fetchBankAccounts warning:', e)
    }
  }

  useEffect(() => {
    fetchData()
    fetchBankAccounts()
  }, [])

  const fetchData = async () => {
    try {
      if (!navigator.onLine) throw new Error('Offline')

      // Try fetching from Supabase
      const fetchPromise = Promise.all([
        supabase.from('categories').select('*').eq('shop_id', user.shop_id).order('name'),
        supabase.from('suppliers').select('*').eq('shop_id', user.shop_id).order('name'),
        supabase.from('brands').select('*').eq('shop_id', user.shop_id).order('name'),
        supabase.from('units').select('*').eq('shop_id', user.shop_id).order('name')
      ])

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      const [catResult, supResult, brandResult, unitResult] = await Promise.race([fetchPromise, timeoutPromise])

      if (catResult.error || supResult.error || brandResult.error) throw new Error('Fetch failed')
      if (unitResult?.data) { try { await db.units.bulkPut(JSON.parse(JSON.stringify(unitResult.data))) } catch (_) {} }

      const sid = String(user.shop_id)

      if (catResult.data) {
        await db.categories.bulkPut(JSON.parse(JSON.stringify(catResult.data)))
      }
      if (supResult.data) {
        await db.suppliers.bulkPut(JSON.parse(JSON.stringify(supResult.data)))
      }
      if (brandResult.data) {
        await db.brands.bulkPut(JSON.parse(JSON.stringify(brandResult.data)))
      }

      // Always render from local DB to include pending offline items!
      const [lCats, lSups, lBrands, lUnits] = await Promise.all([
        db.categories.toArray(),
        db.suppliers.toArray(),
        db.brands.toArray(),
        db.units.toArray().catch(() => [])
      ])

      setCategories(lCats.filter(x => String(x.shop_id) === sid))
      setSuppliers(lSups.filter(x => String(x.shop_id) === sid))
      setBrands(lBrands.filter(x => String(x.shop_id) === sid))
      setUnits(lUnits.filter(x => String(x.shop_id) === sid))

      // Load brand-category map
      const lBrandCats = await db.brand_categories.toArray().catch(() => [])
      const myBrandCats = lBrandCats.filter(x => String(x.shop_id) === sid)
      const bcMap = {}
      myBrandCats.forEach(bc => {
        if (!bcMap[bc.brand_id]) bcMap[bc.brand_id] = []
        bcMap[bc.brand_id].push(bc.category_id)
      })
      setBrandCategoryMap(bcMap)

    } catch (e) {
      console.log('AddProduct: Fetching from local DB (Offline)')
      try {
        const [lCats, lSups, lBrands, lUnits] = await Promise.all([
          db.categories.toArray(),
          db.suppliers.toArray(),
          db.brands.toArray(),
          db.units.toArray().catch(() => [])
        ])
        const offlineSid = String(user.shop_id)
        setCategories(lCats.filter(x => String(x.shop_id) === offlineSid))
        setSuppliers(lSups.filter(x => String(x.shop_id) === offlineSid))
        setBrands(lBrands.filter(x => String(x.shop_id) === offlineSid))
        setUnits(lUnits.filter(x => String(x.shop_id) === offlineSid))
        const lBrandCats = await db.brand_categories.toArray().catch(() => [])
        const myBrandCats = lBrandCats.filter(x => String(x.shop_id) === offlineSid)
        const bcMap = {}
        myBrandCats.forEach(bc => {
          if (!bcMap[bc.brand_id]) bcMap[bc.brand_id] = []
          bcMap[bc.brand_id].push(bc.category_id)
        })
        setBrandCategoryMap(bcMap)
      } catch (err) {
        console.error('Local DB AddProduct Error:', err)
      }
    }
  }

  const handleAddBrand = async () => {
    if (!newBrandName.trim()) return

    // UUID id only for local IndexedDB — Supabase brands.id is SERIAL (integer)
    const localBrandData = { id: crypto.randomUUID(), name: newBrandName.trim(), shop_id: user.shop_id }

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')

      const { data, error } = await supabase.from('brands').insert([{ name: newBrandName.trim(), shop_id: user.shop_id }]).select()
      if (error) throw error

      setBrands([...brands, data[0]])
      setForm({ ...form, brand: data[0].name })
    } catch (err) {
      const errMsg = err?.message || String(err)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        await db.brands.add(localBrandData)
        await addToSyncQueue('brands', 'INSERT', localBrandData)
        setBrands([...brands, localBrandData])
        setForm({ ...form, brand: localBrandData.name })
        alert('Offline mode: Brand added locally. Will sync when online! 🔄')
      } else {
        alert('Error adding brand: ' + errMsg)
      }
    }

    setNewBrandName('')
    setShowNewBrandInput(false)
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    if (name === 'brand') {
      // When brand changes, reset category if it's not in the brand's allowed categories
      const brandObj = brands.find(b => b.name === value)
      const allowedCatIds = brandObj ? brandCategoryMap[brandObj.id] : null
      const currentCatAllowed = !allowedCatIds || allowedCatIds.includes(parseInt(form.category_id))
      setForm(prev => ({ ...prev, brand: value, category_id: currentCatAllowed ? prev.category_id : '' }))
    } else {
      setForm({ ...form, [name]: value })
    }
  }

  // Filtered categories based on selected brand
  const brandObj = brands.find(b => b.name === form.brand)
  const filteredCategories = brandObj && brandCategoryMap[brandObj.id]?.length
    ? categories.filter(c => brandCategoryMap[brandObj.id].includes(c.id))
    : categories

  const autoGenerateSKU = () => {
    const prefix = (form.name || 'PRD').replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase()
    const suffix = Math.floor(1000 + Math.random() * 9000)
    setForm(prev => ({ ...prev, sku: `${prefix}-${suffix}` }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    // Validation
    if (!form.name.trim()) return alert('Product Name is required')
    if (!form.brand) return alert('Brand is required')
    if (!form.category_id) return alert('Category is required')

    setLoading(true)

    // Phase 4: Enforce Product Limits
    try {
      const sid = user?.shop_id
      const limits = JSON.parse((sid ? localStorage.getItem(`plan_limits_${sid}`) : null) || localStorage.getItem('plan_limits') || '{}')
      const currentCount = await db.products.where('shop_id').equals(user.shop_id).count()

      if (limits.product_limit && currentCount >= limits.product_limit) {
        alert(`Limit Reached! Aapka ${limits.plan_name || 'TRIAL'} plan sirf ${limits.product_limit} products ki ijazat deta hai. Meharbani karke Superadmin se plan upgrade karwayein.`)
        setLoading(false)
        return
      }
    } catch (limitErr) {
      console.warn('Limit check failed, proceeding anyway:', limitErr)
    }

    // Sanitize foreign keys and numeric fields
    const toIntOrNull = (v) => { const n = parseInt(v, 10); return (!isNaN(n) && n > 0) ? n : null }
    const toNumOrZero = (v, def = 0) => {
      if (v === null || v === undefined || v === '') return def
      const n = parseFloat(v)
      return isNaN(n) ? def : n
    }

    const stockQtyNum = toNumOrZero(form.stock_quantity, 0)
    const costPriceNum = toNumOrZero(form.cost_price, 0)
    const initialPurchaseTotal = stockQtyNum > 0 && costPriceNum > 0 ? (stockQtyNum * costPriceNum) : 0
    const isInitialPurchase = initialPurchaseTotal > 0 && !skipInitialPurchase

    if (isInitialPurchase) {
      if (paymentType === 'credit' && !form.supplier_id) {
        setLoading(false)
        return alert('Please select a Supplier above to record this initial purchase on Credit!')
      }
      if (paymentType === 'bank' && !selectedBankAccountId) {
        setLoading(false)
        return alert('Please select a Bank Account for Bank payment!')
      }
    }

    const localId = crypto.randomUUID()
    const productData = {
      ...form,
      id: localId,
      shop_id: user.shop_id,
      category_id: toIntOrNull(form.category_id),
      supplier_id: toIntOrNull(form.supplier_id),
      unit_id: toIntOrNull(form.unit_id),
      cost_price: costPriceNum,
      sale_price: toNumOrZero(form.sale_price, 0),
      stock_quantity: stockQtyNum,
      c_rate: toNumOrZero(form.c_rate, 0),
      low_stock_threshold: toNumOrZero(form.low_stock_threshold, 10)
    }

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')

      // Strip local UUID id for Supabase SERIAL integer PK
      const { id: _localId, ...supabaseProductData } = productData

      let { data: inserted, error } = await supabase.from('products').insert([supabaseProductData]).select()

      // If foreign key constraint failed (e.g. offline category ID), retry without FKs so the product is saved
      if (error && (error.code === '23503' || error.message?.includes('foreign key') || error.message?.includes('fkey'))) {
        console.warn('AddProduct: FK constraint failed on cloud insert, retrying without FKs')
        const retryPayload = { ...supabaseProductData, category_id: null, supplier_id: null, unit_id: null }
        const retry = await supabase.from('products').insert([retryPayload]).select()
        inserted = retry.data
        error = retry.error
      }

      if (error) throw error

      // Cache returned product with real cloud ID to local IndexedDB
      if (inserted && inserted[0]) {
        await db.products.put(inserted[0])
      }

      // Record initial stock purchase and deduct from account / update supplier
      if (isInitialPurchase) {
        const prodId = (inserted && inserted[0]?.id) || productData.id
        const isImmediatePaid = paymentType === 'cash' || paymentType === 'bank'
        const effectivePaymentType = paymentType
        const selectedBank = effectivePaymentType === 'bank' && selectedBankAccountId
          ? bankAccounts.find(b => String(b.id) === String(selectedBankAccountId))
          : null
        const selectedCash = effectivePaymentType === 'cash' && selectedCashVaultId
          ? bankAccounts.find(b => String(b.id) === String(selectedCashVaultId))
          : null

        const paymentDetailsObj = selectedBank ? {
          bank_account_id: selectedBank.id,
          bank_name: selectedBank.bank_name,
          account_name: selectedBank.account_name
        } : (selectedCash ? {
          cash_account_id: selectedCash.id,
          account_name: selectedCash.account_name
        } : null)

        const paymentNote = selectedBank 
          ? `[Paid via ${selectedBank.bank_name ? `${selectedBank.bank_name} - ` : ''}${selectedBank.account_name}]`
          : (effectivePaymentType === 'cash' 
            ? (selectedCash ? `[Paid via ${selectedCash.account_name}]` : `[Paid via Cash in Hand]`)
            : `[Purchased on Credit]`)

        const purchaseData = {
          shop_id: user.shop_id,
          supplier_id: toIntOrNull(form.supplier_id),
          total_amount: initialPurchaseTotal,
          net_amount: initialPurchaseTotal,
          paid_amount: isImmediatePaid ? initialPurchaseTotal : 0,
          amount_paid: isImmediatePaid ? initialPurchaseTotal : 0,
          payment_type: effectivePaymentType,
          payment_method: effectivePaymentType,
          payment_details: paymentDetailsObj,
          remarks: paymentNote,
          notes: paymentNote,
          status: 'completed'
        }

        try {
          let { data: purchase, error: pError } = await supabase.from('purchases').insert([purchaseData]).select().single()
          if (pError && (pError.message?.includes('column') || pError.code === 'PGRST204')) {
            const minimalPurchase = {
              shop_id: user.shop_id,
              supplier_id: toIntOrNull(form.supplier_id),
              total_amount: initialPurchaseTotal,
              amount_paid: isImmediatePaid ? initialPurchaseTotal : 0,
              payment_method: effectivePaymentType,
              payment_type: effectivePaymentType,
              payment_details: paymentDetailsObj,
              remarks: paymentNote
            }
            const res = await supabase.from('purchases').insert([minimalPurchase]).select().single()
            purchase = res.data
            pError = res.error
          }

          if (purchase) {
            const purchaseItem = {
              purchase_id: purchase.id,
              product_id: toIntOrNull(prodId),
              product_name: form.name,
              quantity: stockQtyNum,
              unit_price: costPriceNum,
              cost_price: costPriceNum,
              total_price: initialPurchaseTotal,
              subtotal: initialPurchaseTotal
            }
            let { data: resItems, error: itemsError } = await supabase.from('purchase_items').insert([purchaseItem]).select()
            if (itemsError && (itemsError.message?.includes('column') || itemsError.code === 'PGRST204')) {
              const minimalItem = {
                purchase_id: purchase.id,
                product_id: toIntOrNull(prodId),
                quantity: stockQtyNum,
                cost_price: costPriceNum,
                subtotal: initialPurchaseTotal
              }
              const res = await supabase.from('purchase_items').insert([minimalItem]).select()
              resItems = res.data
            }

            await db.purchases.put(purchase).catch(() => {})
            if (resItems) await db.purchase_items.bulkPut(resItems).catch(() => {})

            if (effectivePaymentType === 'bank' && selectedBankAccountId) {
              await deductBankBalance({
                shopId: user.shop_id,
                accountId: Number(selectedBankAccountId),
                amount: initialPurchaseTotal,
                purchaseId: purchase.id,
                description: `Initial Stock Purchase PR-${String(purchase.id).slice(-6)}: ${form.name}`
              }).catch(err => console.warn('AddProduct bank deduction error:', err))
            } else if (effectivePaymentType === 'cash') {
              const targetCashId = selectedCashVaultId || (await findOrCreateAccountForPayment({ shopId: user.shop_id, method: 'cash', accounts: bankAccounts }))?.id
              if (targetCashId) {
                await deductBankBalance({
                  shopId: user.shop_id,
                  accountId: Number(targetCashId),
                  amount: initialPurchaseTotal,
                  purchaseId: purchase.id,
                  description: `Initial Stock Cash Purchase PR-${String(purchase.id).slice(-6)}: ${form.name}`
                }).catch(err => console.warn('AddProduct cash deduction error:', err))
              }
            } else if (effectivePaymentType === 'credit' && form.supplier_id) {
              const supplier = suppliers.find(s => String(s.id) === String(form.supplier_id))
              const newBalance = (supplier?.outstanding_balance || 0) + initialPurchaseTotal
              try {
                await supabase.from('suppliers').update({ outstanding_balance: newBalance }).eq('id', form.supplier_id)
              } catch (_) {}
              try {
                await db.suppliers.update(form.supplier_id, { outstanding_balance: newBalance })
              } catch (_) {}
            }

            if (isImmediatePaid && form.supplier_id) {
              const paymentData = {
                shop_id: user.shop_id,
                supplier_id: toIntOrNull(form.supplier_id),
                amount: initialPurchaseTotal,
                payment_type: 'payment',
                payment_method: effectivePaymentType,
                note: paymentNote
              }
              try {
                await supabase.from('supplier_payments').insert([paymentData])
              } catch (_) {}
              try {
                await db.supplier_payments.add(paymentData)
              } catch (_) {}
            }
          }
        } catch (pErr) {
          console.warn('Initial purchase recording error:', pErr)
        }
      }

      await recordAuditLog(
        'PRODUCT_ADDED',
        'products',
        (inserted && inserted[0]?.id) || productData.id,
        { name: productData.name, brand: productData.brand, category_id: productData.category_id },
        user.id,
        user.shop_id
      )

      alert('Product added successfully!')
      navigate('/products')
    } catch (error) {
      const errMsg = error?.message || String(error)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine || error.name === 'TypeError') {
        // Offline: Save to Local DB and Queue Sync
        await db.products.add(productData)
        await addToSyncQueue('products', 'INSERT', productData)

        if (isInitialPurchase) {
          const offlinePurchaseId = crypto.randomUUID()
          const isImmediatePaid = paymentType === 'cash' || paymentType === 'bank'
          const offlinePurchaseData = {
            id: offlinePurchaseId,
            shop_id: user.shop_id,
            supplier_id: toIntOrNull(form.supplier_id),
            total_amount: initialPurchaseTotal,
            net_amount: initialPurchaseTotal,
            paid_amount: isImmediatePaid ? initialPurchaseTotal : 0,
            amount_paid: isImmediatePaid ? initialPurchaseTotal : 0,
            payment_type: paymentType,
            payment_method: paymentType,
            status: 'completed'
          }
          await db.purchases.add(offlinePurchaseData).catch(() => {})
          await addToSyncQueue('purchases', 'INSERT', offlinePurchaseData).catch(() => {})

          const offlineItem = {
            id: crypto.randomUUID(),
            purchase_id: offlinePurchaseId,
            product_id: productData.id,
            product_name: form.name,
            quantity: stockQtyNum,
            unit_price: costPriceNum,
            cost_price: costPriceNum,
            total_price: initialPurchaseTotal
          }
          await db.purchase_items.add(offlineItem).catch(() => {})
          await addToSyncQueue('purchase_items', 'INSERT', offlineItem).catch(() => {})

          if (paymentType === 'credit' && form.supplier_id) {
            const supplier = suppliers.find(s => String(s.id) === String(form.supplier_id))
            const newBalance = (supplier?.outstanding_balance || 0) + initialPurchaseTotal
            await db.suppliers.update(form.supplier_id, { outstanding_balance: newBalance }).catch(() => {})
            await addToSyncQueue('suppliers', 'UPDATE', { id: form.supplier_id, outstanding_balance: newBalance }).catch(() => {})
          } else if (paymentType === 'bank' && selectedBankAccountId) {
            await deductBankBalance({
              shopId: user.shop_id,
              accountId: Number(selectedBankAccountId),
              amount: initialPurchaseTotal,
              purchaseId: offlinePurchaseId,
              description: `Initial Stock Purchase PR-${offlinePurchaseId.slice(-6)}: ${form.name}`
            }).catch(() => {})
          } else if (paymentType === 'cash') {
            const targetCashId = selectedCashVaultId || (await findOrCreateAccountForPayment({ shopId: user.shop_id, method: 'cash', accounts: bankAccounts }))?.id
            if (targetCashId) {
              await deductBankBalance({
                shopId: user.shop_id,
                accountId: Number(targetCashId),
                amount: initialPurchaseTotal,
                purchaseId: offlinePurchaseId,
                description: `Initial Stock Cash Purchase PR-${offlinePurchaseId.slice(-6)}: ${form.name}`
              }).catch(() => {})
            }
          }
        }

        await recordAuditLog(
          'PRODUCT_ADDED',
          'products',
          productData.id,
          { name: productData.name, brand: productData.brand, category_id: productData.category_id, offline: true },
          user.id,
          user.shop_id
        )
        alert('Offline mode: Product saved locally! It will sync automatically when you are back online. 🔄')
        navigate('/products')
      } else {
        alert('Error: ' + error.message)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">📦 Add Product</h1>

      <div className="bg-white rounded-xl shadow p-6 max-w-3xl">
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Basic Info */}
          <h2 className="font-semibold text-gray-700 border-b pb-2">Basic Information</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-700 font-medium mb-1">Product Name *</label>
              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={preset.placeholders.productName}
              />
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1 flex justify-between">
                <span>Brand</span>
                <button
                  type="button"
                  onClick={() => setShowNewBrandInput(!showNewBrandInput)}
                  className="text-[10px] text-blue-600 font-bold uppercase hover:underline"
                >
                  {showNewBrandInput ? '← Select' : '+ New Brand'}
                </button>
              </label>
              {showNewBrandInput ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newBrandName}
                    onChange={(e) => setNewBrandName(e.target.value)}
                    className="flex-1 px-4 py-2 border border-blue-300 bg-blue-50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Brand name..."
                  />
                  <button
                    type="button"
                    onClick={handleAddBrand}
                    className="px-3 bg-blue-600 text-white rounded-lg font-bold"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <select
                  name="brand"
                  value={form.brand}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select brand...</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.name}>{b.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-700 font-medium mb-1">SKU / Barcode</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  name="sku"
                  value={form.sku}
                  onChange={handleChange}
                  onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  placeholder={preset.placeholders.sku}
                />
                <button type="button" onClick={autoGenerateSKU}
                  className="px-3 py-2 bg-gray-100 hover:bg-blue-100 text-gray-600 hover:text-blue-700 rounded-lg text-xs font-bold transition whitespace-nowrap border border-gray-200">
                  ⚡ Auto
                </button>
              </div>
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1">Category *</label>
              <select
                name="category_id"
                value={form.category_id}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select category...</option>
                {filteredCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-gray-700 font-medium mb-1">Supplier</label>
            <select
              name="supplier_id"
              value={form.supplier_id}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select supplier</option>
              {suppliers.map((sup) => (
                <option key={sup.id} value={sup.id}>{sup.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-gray-700 font-medium mb-1">Unit of Measure</label>
            <select name="unit_id" value={form.unit_id} onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Select unit...</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.name}{u.abbreviation ? ` (${u.abbreviation})` : ''}</option>)}
            </select>
            {units.length === 0 && <p className="text-xs text-gray-400 mt-1">Units add karne ke liye Master Data → Units mein jayein</p>}
          </div>

          {/* Pricing */}
          <h2 className="font-semibold text-gray-700 border-b pb-2 pt-2">Pricing</h2>

          <div className={`grid ${pricingConfig.enabled ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'} gap-4`}>
            {pricingConfig.enabled && (
              <div>
                <label className="block text-gray-700 font-medium mb-1">{pricingConfig.label}</label>
                <input
                  type="number"
                  name="c_rate"
                  value={form.c_rate}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0"
                />
              </div>
            )}
            <div>
              <label className="block text-gray-700 font-medium mb-1">Purchase / Cost Price *</label>
              <input
                type="number"
                name="cost_price"
                value={form.cost_price}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1">Sale / Selling Price *</label>
              <input
                type="number"
                name="sale_price"
                value={form.sale_price}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
              />
            </div>
          </div>

          {/* Profit Preview */}
          {form.cost_price && form.sale_price && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-green-700 font-medium">
                💰 Profit per unit: Rs. {(parseFloat(form.sale_price) - parseFloat(form.cost_price)).toFixed(2)}
                <span className="ml-3 text-green-500">
                  ({(((parseFloat(form.sale_price) - parseFloat(form.cost_price)) / parseFloat(form.cost_price)) * 100).toFixed(1)}%)
                </span>
              </p>
            </div>
          )}

          {/* Stock */}
          <h2 className="font-semibold text-gray-700 border-b pb-2 pt-2">Stock</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-700 font-medium mb-1">Stock Quantity *</label>
              <input
                type="number"
                name="stock_quantity"
                value={form.stock_quantity}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1">Low Stock Alert</label>
              <input
                type="number"
                name="low_stock_threshold"
                value={form.low_stock_threshold}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="10"
              />
            </div>
          </div>

          {/* Initial Stock Purchase & Payment Workflow */}
          {parseFloat(form.stock_quantity) > 0 && parseFloat(form.cost_price) > 0 && (
            <div className="bg-blue-50/80 border-2 border-blue-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-blue-200 pb-2.5">
                <div>
                  <h3 className="font-bold text-gray-800 text-sm flex items-center gap-1.5">
                    <span>💳</span> Initial Stock Purchase & Payment
                  </h3>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Total Outlay: {parseFloat(form.stock_quantity)} units × Rs. {parseFloat(form.cost_price)} ={' '}
                    <strong className="text-blue-700 font-extrabold text-sm">
                      Rs. {(parseFloat(form.stock_quantity) * parseFloat(form.cost_price)).toLocaleString()}
                    </strong>
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none bg-white px-2.5 py-1 rounded-lg border border-gray-200">
                  <input
                    type="checkbox"
                    checked={skipInitialPurchase}
                    onChange={e => setSkipInitialPurchase(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>Catalog Only (No financial deduction)</span>
                </label>
              </div>

              {!skipInitialPurchase && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1.5">Payment Method *</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setPaymentType('cash')}
                        className={`py-2 rounded-lg font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer ${
                          paymentType === 'cash'
                            ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-300'
                            : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <span>💵 Cash</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPaymentType('bank')
                          if (!selectedBankAccountId && bankOnlyAccounts.length > 0) {
                            const def = bankOnlyAccounts.find(b => b.is_default) || bankOnlyAccounts[0]
                            if (def) setSelectedBankAccountId(String(def.id))
                          }
                        }}
                        className={`py-2 rounded-lg font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer ${
                          paymentType === 'bank'
                            ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-300'
                            : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <span>🏦 Bank</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentType('credit')}
                        className={`py-2 rounded-lg font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer ${
                          paymentType === 'credit'
                            ? 'bg-amber-600 text-white shadow-sm ring-2 ring-amber-300'
                            : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <span>📒 Credit</span>
                      </button>
                    </div>
                  </div>

                  {/* Cash Vault Selector */}
                  {paymentType === 'cash' && (
                    <div className="p-3 bg-white rounded-lg border border-emerald-200 space-y-1">
                      <label className="block text-xs font-bold text-emerald-900">
                        Deduct From Cash Drawer / Vault:
                      </label>
                      {cashVaults.length > 0 ? (
                        <select
                          value={selectedCashVaultId}
                          onChange={e => setSelectedCashVaultId(e.target.value)}
                          className="w-full px-3 py-2 border border-emerald-300 rounded-lg text-xs font-semibold bg-white outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                          {cashVaults.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.account_name} (Current: Rs. {Number(c.current_balance || 0).toLocaleString()})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-xs text-gray-500">Deducts automatically from Primary Cash Drawer</p>
                      )}
                    </div>
                  )}

                  {/* Bank Account Selector */}
                  {paymentType === 'bank' && (
                    <div className="p-3 bg-white rounded-lg border border-blue-200 space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-bold text-blue-900">
                        <span>Deduct From Bank Account:</span>
                        <button
                          type="button"
                          onClick={() => setShowBankModal(true)}
                          className="text-blue-600 hover:underline text-[11px]"
                        >
                          + Add Bank
                        </button>
                      </div>
                      {bankOnlyAccounts.length > 0 ? (
                        <select
                          value={selectedBankAccountId}
                          onChange={e => setSelectedBankAccountId(e.target.value)}
                          className="w-full px-3 py-2 border border-blue-300 rounded-lg text-xs font-semibold bg-white outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">-- Select Bank Account --</option>
                          {bankOnlyAccounts.map(b => (
                            <option key={b.id} value={b.id}>
                              {b.bank_name ? `${b.bank_name} - ` : ''}{b.account_name} (Balance: Rs. {Number(b.current_balance || 0).toLocaleString()}) {b.is_default ? '★' : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="p-2 bg-blue-50 rounded text-xs text-blue-800 flex items-center justify-between">
                          <span>No bank account linked.</span>
                          <button
                            type="button"
                            onClick={() => setShowBankModal(true)}
                            className="px-2 py-1 bg-blue-600 text-white rounded font-bold text-[10px]"
                          >
                            Add Account
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Credit Notice */}
                  {paymentType === 'credit' && (
                    <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-800">
                      {form.supplier_id ? (
                        <p>
                          ⚠️ <strong>Rs. {(parseFloat(form.stock_quantity) * parseFloat(form.cost_price)).toLocaleString()}</strong> will be added to the outstanding debt of{' '}
                          <strong>{suppliers.find(s => String(s.id) === String(form.supplier_id))?.name || 'Selected Supplier'}</strong>.
                        </p>
                      ) : (
                        <p className="text-red-600 font-bold">
                          ⚠️ Please select a Supplier in the form above to record this initial purchase on Credit!
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-gray-700 font-medium mb-1">Status</label>
            <select
              name="status"
              value={form.status}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50">
              {loading ? 'Saving...' : 'Save Product'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/products')}
              className="px-6 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition">
              Cancel
            </button>
          </div>

        </form>
      </div>

      <BankAccountModal
        isOpen={showBankModal}
        onClose={() => {
          setShowBankModal(false)
          fetchBankAccounts()
        }}
        onSuccess={() => {
          fetchBankAccounts()
        }}
      />
    </div>
  )
}

export default AddProduct