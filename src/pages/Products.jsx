import { useEffect, useState, useRef } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { db, addToSyncQueue, moveToTrash } from '../services/db'
import { recordAuditLog } from '../services/auditService'
import PasswordModal from '../components/PasswordModal'
import BarcodeLabelModal from '../components/BarcodeLabelModal'
import ProductDetailModal from '../components/ProductDetailModal'
import { hasFeature } from '../utils/featureGate'

function Products() {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [brands, setBrands] = useState([])
  const [units, setUnits] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [detailProduct, setDetailProduct] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [showLowStockOnly, setShowLowStockOnly] = useState(false)
  const { user } = useAuth()
  const fileInputRef = useRef(null)
  const [selected, setSelected] = useState([])
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [pendingDeleteIds, setPendingDeleteIds] = useState([])
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [bulkCategory, setBulkCategory] = useState('')
  const [bulkBrand, setBulkBrand] = useState('')
  const [bulkUnit, setBulkUnit] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)

  // Inline edit state
  const [inlineEditId, setInlineEditId] = useState(null)
  const [inlineForm, setInlineForm] = useState({})
  const [inlineSaving, setInlineSaving] = useState(false)

  // Barcode label printing state
  const [showBarcodeModal, setShowBarcodeModal] = useState(false)
  const [barcodeModalProduct, setBarcodeModalProduct] = useState(null)

  // Import preview state
  const [showImportPreview, setShowImportPreview] = useState(false)
  const [importPreviewRows, setImportPreviewRows] = useState([])
  const [autoCreateCategories, setAutoCreateCategories] = useState(false)
  const [autoCreateBrands, setAutoCreateBrands] = useState(false)

  const [phones, setPhones] = useState([])
  const [catalogType, setCatalogType] = useState('all') // 'all', 'phones', 'products'
  const [selectedStorage, setSelectedStorage] = useState('all')
  const [selectedPta, setSelectedPta] = useState('all')
  const [copiedImei, setCopiedImei] = useState(null)

  useEffect(() => {
    if (user?.shop_id) fetchProducts()
  }, [user?.shop_id])

  const fetchProducts = async () => {
    if (!user?.shop_id) {
      setLoading(false)
      console.error('Products: Missing user.shop_id!')
      return
    }

    const sid = String(user.shop_id)

    // ── Step 1: Show local IndexedDB data IMMEDIATELY (instant UI) ────────────
    try {
      const [lProds, lCats, lBrands, lUnits, lSups, lPhones] = await Promise.all([
        db.products.toArray(),
        db.categories.toArray(),
        db.brands.toArray(),
        db.units.toArray(),
        db.suppliers.toArray().catch(() => []),
        db.phones ? db.phones.toArray().catch(() => []) : Promise.resolve([])
      ])
      const myProds = lProds.filter(x => String(x.shop_id) === sid)
      const myCats = lCats.filter(x => String(x.shop_id) === sid)
      const myBrands = lBrands.filter(x => String(x.shop_id) === sid)
      const myUnits = lUnits.filter(x => String(x.shop_id) === sid)
      const mySups = lSups.filter(x => String(x.shop_id) === sid)
      const myPhones = (lPhones || []).filter(x => String(x.shop_id) === sid)

      setProducts(myProds)
      setCategories(myCats)
      setBrands(myBrands)
      setUnits(myUnits)
      setSuppliers(mySups)
      setPhones(myPhones)
      if (myProds.length > 0 || myPhones.length > 0) {
        setLoading(false)
      }
    } catch (localErr) {
      console.warn('Products: Local DB read failed:', localErr)
    }

    // ── Step 2: Background refresh from Supabase (updates UI silently) ────────
    if (!navigator.onLine) {
      setLoading(false)
      return
    }

    try {
      const fetchPromise = Promise.all([
        supabase.from('products').select('*, categories(name)').eq('shop_id', user.shop_id).order('created_at', { ascending: false }),
        supabase.from('categories').select('*').eq('shop_id', user.shop_id),
        supabase.from('brands').select('*').eq('shop_id', user.shop_id).order('name'),
        supabase.from('units').select('*').eq('shop_id', user.shop_id).order('name'),
        supabase.from('phones').select('*').eq('shop_id', user.shop_id).order('created_at', { ascending: false })
      ])

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 4000))
      const [pData, cData, bData, uData, phData] = await Promise.race([fetchPromise, timeoutPromise])

      if (pData.error || cData.error || bData.error) throw new Error('Supabase fetch failed')

      // Cache to local DB
      if (pData.data) {
        await db.products.bulkPut(JSON.parse(JSON.stringify(pData.data)))
      }
      if (cData.data) {
        await db.categories.bulkPut(JSON.parse(JSON.stringify(cData.data)))
      }
      if (bData.data) {
        await db.brands.bulkPut(JSON.parse(JSON.stringify(bData.data)))
      }
      if (uData?.data) {
        await db.units.bulkPut(JSON.parse(JSON.stringify(uData.data))).catch(() => {})
      }
      if (phData?.data && db.phones) {
        await db.phones.bulkPut(JSON.parse(JSON.stringify(phData.data))).catch(() => {})
      }

      // Re-read and merge from local DB
      const [lProds, lCats, lBrands, lUnits, lPhones] = await Promise.all([
        db.products.toArray(),
        db.categories.toArray(),
        db.brands.toArray(),
        db.units.toArray(),
        db.phones ? db.phones.toArray().catch(() => []) : Promise.resolve([])
      ])

      const myProds = lProds.filter(x => String(x.shop_id) === sid)
      const myCats = lCats.filter(x => String(x.shop_id) === sid)
      const myBrands = lBrands.filter(x => String(x.shop_id) === sid)
      const myUnits = lUnits.filter(x => String(x.shop_id) === sid)
      const myPhones = (lPhones || []).filter(x => String(x.shop_id) === sid)

      setProducts(myProds)
      setCategories(myCats)
      setBrands(myBrands)
      setUnits(myUnits)
      setPhones(myPhones)
    } catch (e) {
      console.warn('Products: Supabase background refresh failed:', e)
    } finally {
      setLoading(false)
    }
  }

  // Effective threshold: product-level → category-level → system default (10)
  const getEffectiveThreshold = (product) => {
    if (product.low_stock_threshold) return product.low_stock_threshold
    const cat = categories.find(c => c.id === product.category_id)
    if (cat?.low_stock_threshold) return cat.low_stock_threshold
    return 10
  }

  const categoryNameMap = categories.reduce((acc, c) => {
    acc[String(c.id)] = c.name
    return acc
  }, {})

  const unitNameMap = units.reduce((acc, u) => {
    acc[String(u.id)] = u.name
    return acc
  }, {})

  const handleCopyImei = (e, imei) => {
    e.stopPropagation()
    if (!imei) return
    navigator.clipboard.writeText(imei)
    setCopiedImei(imei)
    setTimeout(() => setCopiedImei(null), 1800)
  }

  // Normalize mobile phones into catalog items
  const normalizedPhones = phones.map(p => {
    const cost = Number(p.cost_price || 0) + Number(p.additional_costs || 0)
    const sale = Number(p.sale_price || 0)
    const inStock = p.status === 'in_stock'
    return {
      id: p.id,
      item_type: 'phone',
      name: `${p.brand || ''} ${p.model || ''} ${p.storage || ''} ${p.color || ''}`.trim() || 'Mobile Phone',
      brand: p.brand || '',
      model: p.model || '',
      sku: p.imei_1 || '',
      imei_1: p.imei_1 || '',
      imei_2: p.imei_2 || '',
      storage: p.storage || '',
      color: p.color || '',
      ram: p.ram || '',
      condition: p.condition || '',
      pta_status: p.pta_status || '',
      battery_health: p.battery_health,
      category_id: 'phone_category',
      category_name: 'Mobile Phone',
      unit_id: null,
      unit_name: 'Device',
      stock_quantity: inStock ? 1 : 0,
      cost_price: cost,
      sale_price: sale,
      c_rate: 0,
      low_stock_threshold: 1,
      status: inStock ? 'active' : p.status,
      created_at: p.created_at,
      supplier_id: p.supplier_id,
      supplier_name: p.supplier_name,
      raw_item: p
    }
  })

  // Normalize regular products into catalog items
  const normalizedProducts = products.map(p => ({
    ...p,
    item_type: 'product',
    brand: p.brand || '',
    category_name: categoryNameMap[String(p.category_id)] || p.categories?.name || 'No category',
    unit_name: unitNameMap[String(p.unit_id)] || 'Piece',
    raw_item: p
  }))

  // Combined Catalog
  const fullCatalog = [
    ...(catalogType === 'products' ? [] : normalizedPhones),
    ...(catalogType === 'phones' ? [] : normalizedProducts)
  ]

  const filteredCatalog = fullCatalog.filter(item => {
    const q = search.trim().toLowerCase()
    let matchSearch = true
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean)
      const nameStr = String(item.name || '').toLowerCase()
      const brandStr = String(item.brand || '').toLowerCase()
      const skuStr = String(item.sku || '').toLowerCase()
      const idStr = String(item.id || '').toLowerCase()
      const imei1Str = String(item.imei_1 || '').toLowerCase()
      const imei2Str = String(item.imei_2 || '').toLowerCase()
      const modelStr = String(item.model || '').toLowerCase()
      const storageStr = String(item.storage || '').toLowerCase()
      const colorStr = String(item.color || '').toLowerCase()
      const ptaStr = String(item.pta_status || '').toLowerCase()
      const conditionStr = String(item.condition || '').toLowerCase()
      const catStr = String(item.category_name || '').toLowerCase()
      const unitStr = String(item.unit_name || '').toLowerCase()

      const searchTarget = `${nameStr} ${brandStr} ${skuStr} ${idStr} ${imei1Str} ${imei2Str} ${modelStr} ${storageStr} ${colorStr} ${ptaStr} ${conditionStr} ${catStr} ${unitStr}`

      matchSearch = tokens.every(token => searchTarget.includes(token))
    }

    const matchCat = (selectedCategory && selectedCategory !== 'all') ? (
      item.item_type === 'phone'
        ? selectedCategory === 'phone_category'
        : String(item.category_id) === String(selectedCategory)
    ) : true

    const matchLow = showLowStockOnly ? (
      item.item_type === 'phone'
        ? item.stock_quantity <= 0
        : item.stock_quantity <= getEffectiveThreshold(item)
    ) : true

    const matchPta = selectedPta !== 'all' ? (
      item.item_type === 'phone' && String(item.pta_status || '').toLowerCase() === selectedPta.toLowerCase()
    ) : true

    const matchStorage = selectedStorage !== 'all' ? (
      item.item_type === 'phone' && String(item.storage || '').toLowerCase() === selectedStorage.toLowerCase()
    ) : true

    return matchSearch && matchCat && matchLow && matchPta && matchStorage
  })

  // Category low stock summary for banner
  const categoryLowStockAlerts = categories
    .filter(c => c.low_stock_threshold > 0)
    .map(c => ({
      cat: c,
      count: products.filter(p => p.category_id === c.id && p.stock_quantity <= c.low_stock_threshold).length
    }))
    .filter(a => a.count > 0)

  const handleExport = () => {
    const toExport = selected.length > 0
      ? filteredCatalog.filter(p => selected.includes(p.id))
      : filteredCatalog
    const exportData = toExport.map(p => ({
      'Item Type': p.item_type === 'phone' ? 'Mobile Phone' : 'General Product',
      'Name / Model': p.name,
      'Brand': p.brand || '-',
      'Category': p.category_name || '-',
      'IMEI 1': p.imei_1 || '-',
      'IMEI 2': p.imei_2 || '-',
      'PTA Status': p.pta_status || '-',
      'Storage': p.storage || '-',
      'Color': p.color || '-',
      'Condition': p.condition || '-',
      'SKU / Barcode': p.sku || '',
      'Stock Qty': p.stock_quantity,
      'Cost Price': p.cost_price,
      'Sale Price': p.sale_price,
      'C.Rate': p.c_rate || 0,
      'Status': p.status
    }))

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Catalog')
    XLSX.writeFile(wb, `Catalog_Export_${new Date().toLocaleDateString()}.xlsx`)
  }

  const handleImport = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = null

    const reader = new FileReader()
    reader.onload = (evt) => {
      const bstr = evt.target.result
      const wb = XLSX.read(bstr, { type: 'binary' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json(ws)
      if (data.length === 0) { alert('Empty file!'); return }

      const previewRows = []
      for (const row of data) {
        const name = String(row['Product Name'] || row['name'] || '').trim()
        const brand = String(row['Brand'] || row['brand'] || '').trim()
        if (!name || !brand) continue
        const categoryName = String(row['Category'] || row['category'] || '').trim()
        const matchedCat = categoryName && categoryName !== '-'
          ? categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase())
          : null
        const unitName = String(row['Unit'] || row['unit'] || '').trim()
        const matchedUnit = unitName ? units.find(u => u.name.toLowerCase() === unitName.toLowerCase()) : null
        const brandLower = brand.toLowerCase()
        const brandMatched = brands.some(b => b.name.toLowerCase() === brandLower)
        previewRows.push({
          name, brand, categoryName: categoryName !== '-' ? categoryName : '',
          categoryId: matchedCat?.id || null,
          matched: !categoryName || categoryName === '-' || !!matchedCat,
          brandMatched,
          sku: String(row['SKU'] || row['sku'] || '').trim(),
          unitName,
          unitId: matchedUnit?.id || null,
          stock_quantity: parseFloat(row['Stock Qty'] || row['stock'] || 0),
          cost_price: parseFloat(row['Cost Price'] || row['cost'] || 0),
          sale_price: parseFloat(row['Sale Price'] || row['sale'] || 0),
          c_rate: parseFloat(row['C.Rate'] || 0),
          low_stock_threshold: parseFloat(row['Min Thresh'] || 10),
          status: row['Status'] || 'active'
        })
      }

      if (previewRows.length === 0) { alert('No valid rows (Product Name + Brand required)'); return }
      setImportPreviewRows(previewRows)
      setAutoCreateCategories(false)
      setShowImportPreview(true)
    }
    reader.readAsBinaryString(file)
  }

  const handleConfirmImport = async () => {
    setLoading(true)
    setShowImportPreview(false)

    let rows = importPreviewRows
    let currentCategories = [...categories]

    // Auto-create missing categories — use upsert to avoid duplicates
    if (autoCreateCategories) {
      const unmatchedNames = [...new Set(rows
        .filter(r => r.categoryName && !r.categoryId)
        .map(r => r.categoryName))]

      for (const catName of unmatchedNames) {
        try {
          // First check if it already exists (case-insensitive)
          const existing = currentCategories.find(c => c.name.toLowerCase() === catName.toLowerCase())
          if (existing) continue

          // Check in Supabase too (in case local cache is stale)
          const { data: found } = await supabase
            .from('categories')
            .select('*')
            .eq('shop_id', user.shop_id)
            .ilike('name', catName)
            .maybeSingle()

          if (found) {
            currentCategories.push(found)
          } else {
            const { data: newCat, error } = await supabase
              .from('categories')
              .insert([{ name: catName, shop_id: user.shop_id }])
              .select()
            if (!error && newCat?.[0]) currentCategories.push(newCat[0])
          }
        } catch (err) { /* skip */ }
      }

      // Re-map category IDs after creating
      rows = rows.map(r => {
        if (r.categoryName && !r.categoryId) {
          const found = currentCategories.find(c => c.name.toLowerCase() === r.categoryName.toLowerCase())
          return { ...r, categoryId: found?.id || null }
        }
        return r
      })
    }

    // Auto-create missing brands — same pattern as categories
    let currentBrands = [...brands]
    if (autoCreateBrands) {
      const unmatchedBrandNames = [...new Set(rows
        .filter(r => r.brand && !r.brandMatched)
        .map(r => r.brand))]

      for (const brandName of unmatchedBrandNames) {
        try {
          const existingLocal = currentBrands.find(b => b.name.toLowerCase() === brandName.toLowerCase())
          if (existingLocal) continue

          const { data: found } = await supabase
            .from('brands')
            .select('*')
            .eq('shop_id', user.shop_id)
            .ilike('name', brandName)
            .maybeSingle()

          if (found) {
            currentBrands.push(found)
          } else {
            const { data: newBrand, error } = await supabase
              .from('brands')
              .insert([{ name: brandName, shop_id: user.shop_id }])
              .select()
            if (!error && newBrand?.[0]) currentBrands.push(newBrand[0])
          }
        } catch (err) { /* skip */ }
      }

      // Re-map brandMatched after creating
      rows = rows.map(r => {
        if (r.brand && !r.brandMatched) {
          const found = currentBrands.find(b => b.name.toLowerCase() === r.brand.toLowerCase())
          return { ...r, brandMatched: !!found }
        }
        return r
      })
    }

    // Fetch existing product names to skip duplicates
    const { data: existingProds } = await supabase
      .from('products')
      .select('name, brand')
      .eq('shop_id', user.shop_id)

    const existingKeys = new Set(
      (existingProds || []).map(p => `${p.name.toLowerCase()}||${(p.brand || '').toLowerCase()}`)
    )

    const formatted = []
    const skipped = []
    for (const r of rows) {
      const key = `${r.name.toLowerCase()}||${r.brand.toLowerCase()}`
      if (existingKeys.has(key)) {
        skipped.push(r.name)
        continue
      }
      formatted.push({
        shop_id: user.shop_id,
        name: r.name,
        brand: r.brand,
        sku: r.sku || '',
        category_id: r.categoryId,
        unit_id: r.unitId || null,
        stock_quantity: r.stock_quantity,
        cost_price: r.cost_price,
        sale_price: r.sale_price,
        c_rate: r.c_rate,
        low_stock_threshold: r.low_stock_threshold,
        status: r.status
      })
    }

    if (formatted.length === 0) {
      alert(`⚠️ Koi naya product nahi mila.\n${skipped.length} products pehle se mojood hain (duplicate skip kiye).`)
      setLoading(false)
      setImportPreviewRows([])
      return
    }

    const { error } = await supabase.from('products').insert(formatted)
    if (error) {
      alert('Import error: ' + error.message)
    } else {
      await recordAuditLog('BULK_IMPORT_PRODUCTS', 'products', 'multiple', { count: formatted.length }, user.id, user.shop_id)
      const skipMsg = skipped.length > 0 ? `\n⏭️ ${skipped.length} duplicate(s) skip kiye.` : ''
      alert(`Import successful! ✅ ${formatted.length} products added.${skipMsg}`)
      fetchProducts()
    }
    setLoading(false)
    setImportPreviewRows([])
  }

  const handleInlineSave = async () => {
    if (!inlineForm.name?.trim()) return alert('Product Name is required')
    setInlineSaving(true)
    const toIntOrNull = (v) => { const n = parseInt(v); return isNaN(n) ? null : n }
    const updates = {
      name: inlineForm.name.trim(),
      brand: inlineForm.brand || '',
      category_id: inlineForm.category_id ? toIntOrNull(inlineForm.category_id) : null,
      unit_id: inlineForm.unit_id ? toIntOrNull(inlineForm.unit_id) : null,
      sku: inlineForm.sku || '',
      cost_price: parseFloat(inlineForm.cost_price) || 0,
      sale_price: parseFloat(inlineForm.sale_price) || 0,
      c_rate: parseFloat(inlineForm.c_rate) || 0,
      status: inlineForm.status || 'active'
    }
    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')
      const { error } = await supabase.from('products').update(updates).eq('id', inlineEditId)
      if (error) throw error
      setInlineEditId(null)
      fetchProducts()
    } catch (error) {
      const errMsg = error?.message || String(error)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        await db.products.update(inlineEditId, updates)
        await addToSyncQueue('products', 'UPDATE', { id: inlineEditId, ...updates })
        setInlineEditId(null)
        fetchProducts()
        alert('Offline mode: Updated locally! Will sync when online. 🔄')
      } else {
        alert('Error: ' + errMsg)
      }
    } finally {
      setInlineSaving(false)
    }
  }

  // Delete logic
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
      const item = fullCatalog.find(p => p.id === id)
      if (!item) continue

      const isPhone = item.item_type === 'phone'
      const tableName = isPhone ? 'phones' : 'products'

      try {
        if (navigator.onLine) {
          const { error } = await supabase.from(tableName).delete().eq('id', id).eq('shop_id', user.shop_id)
          if (error) {
            console.error('Delete failed:', error)
            failCount++
            continue
          }
        } else {
          await addToSyncQueue(tableName, 'DELETE', { id })
        }

        await moveToTrash(tableName, id, item.raw_item || item, user.id, user.shop_id)
        if (isPhone && db.phones) {
          await db.phones.delete(id)
        } else {
          await db.products.delete(id)
        }
        successfulIds.push(id)
        successCount++
      } catch (err) {
        console.error('Delete error:', err)
        failCount++
      }
    }

    if (failCount > 0) {
      alert(`⚠️ Partially completed.\n✅ Deleted: ${successCount}\n❌ Failed: ${failCount}\n\n👉 Items linked to sales or purchases cannot be deleted directly.`)
    } else if (successCount > 0) {
      alert(`🗑️ ${successCount} item(s) moved to Trash!`)
    }

    fetchProducts()
    setSelected([])
  }

  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleSelectAll = () => {
    if (selected.length === filteredCatalog.length && filteredCatalog.length > 0) {
      setSelected([])
    } else {
      setSelected(filteredCatalog.map(x => x.id))
    }
  }

  const handleBulkEdit = async () => {
    if (!bulkCategory && !bulkBrand && !bulkUnit) {
      alert('Category, Brand ya Unit mein se kuch toh select karo!')
      return
    }
    if (!confirm(`${selected.length} product(s) update honge. Continue?`)) return

    setBulkSaving(true)
    const updates = {}
    if (bulkCategory) updates.category_id = parseInt(bulkCategory)
    if (bulkBrand) updates.brand = bulkBrand
    if (bulkUnit) updates.unit_id = parseInt(bulkUnit)

    let successCount = 0
    let failCount = 0

    for (const id of selected) {
      try {
        if (navigator.onLine) {
          const { error } = await supabase.from('products').update(updates).eq('id', id).eq('shop_id', user.shop_id)
          if (error) { failCount++; continue }
        } else {
          await addToSyncQueue('products', 'UPDATE', { id, ...updates })
        }
        await db.products.update(id, updates)
        successCount++
      } catch (err) {
        console.error('Bulk edit error:', err)
        failCount++
      }
    }

    await recordAuditLog(
      'BULK_EDIT_PRODUCTS',
      'products',
      'multiple',
      { updated_count: successCount, failed_count: failCount, changes: updates },
      user.id,
      user.shop_id
    )

    setShowBulkEdit(false)
    setBulkCategory('')
    setBulkBrand('')
    setBulkUnit('')
    setSelected([])
    if (bulkCategory) setSelectedCategory('')
    await fetchProducts()
    setBulkSaving(false)

    if (failCount > 0) {
      alert(`⚠️ Partially completed.\n✅ Updated: ${successCount}\n❌ Failed: ${failCount}`)
    } else {
      alert(`✅ ${successCount} product(s) updated successfully!`)
    }
  }

  // Practical KPI Metrics
  const inStockPhonesCount = phones.filter(p => p.status === 'in_stock').length
  const totalPhonesCost = phones.filter(p => p.status === 'in_stock').reduce((s, p) => s + Number(p.cost_price || 0) + Number(p.additional_costs || 0), 0)
  const totalProductsCost = products.reduce((s, p) => s + (Number(p.cost_price || 0) * Number(p.stock_quantity || 0)), 0)
  const totalInventoryCost = totalPhonesCost + totalProductsCost
  const lowStockCount = products.filter(p => p.stock_quantity <= getEffectiveThreshold(p)).length

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">📦 Products & Inventory Catalog</h1>
          <p className="text-gray-500 text-xs sm:text-sm">Manage IMEI-tracked mobile phones, general accessories, and stock pricing</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImport}
            className="hidden"
            accept=".xlsx, .xls, .csv"
          />
          {hasFeature('bulk_import') && (
            <button
              onClick={() => fileInputRef.current.click()}
              className="px-3.5 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 rounded-xl transition font-bold text-xs flex items-center gap-1.5 shadow-xs"
            >
              <span>📥</span> Import
            </button>
          )}
          <button
            onClick={handleExport}
            className="px-3.5 py-2 border border-blue-100 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl transition font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <span>📤</span> Export{selected.length > 0 ? ` (${selected.length})` : ''}
          </button>
          <button
            onClick={() => {
              setBarcodeModalProduct(selected.length === 1 ? fullCatalog.find(p => p.id === selected[0]) : null)
              setShowBarcodeModal(true)
            }}
            className="px-3.5 py-2 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl transition font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <span>🏷️</span> Barcodes
          </button>
          {selected.length > 0 && (
            <>
              <button
                onClick={() => { setShowBulkEdit(true); setBulkCategory(''); setBulkBrand(''); setBulkUnit('') }}
                className="px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl transition font-bold text-xs flex items-center gap-1.5 shadow-xs"
              >
                ✏️ Bulk Edit ({selected.length})
              </button>
              <button
                onClick={() => requestDelete(selected)}
                className="px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl transition font-bold text-xs flex items-center gap-1.5 shadow-xs"
              >
                🗑️ Delete ({selected.length})
              </button>
            </>
          )}
          <Link
            to="/purchases"
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl transition shadow-sm font-bold text-xs flex items-center gap-1.5"
            title="Purchase serialized mobile phones with IMEI"
          >
            <span>📱</span> + Add Phone
          </Link>
          <Link
            to="/add-product"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition shadow-sm font-bold text-xs flex items-center gap-1.5"
          >
            <span>+</span> Add Product
          </Link>
        </div>
      </div>

      {/* Practical High-Level KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-xs">
          <p className="text-[10px] font-black uppercase text-gray-400">Total Portfolio</p>
          <p className="text-xl font-black text-gray-900 mt-0.5">{phones.length + products.length}</p>
          <p className="text-[10px] text-gray-400">Total catalog items</p>
        </div>
        <div className="bg-white p-3 rounded-xl border border-purple-100 shadow-xs">
          <p className="text-[10px] font-black uppercase text-purple-600">Mobile Phones</p>
          <p className="text-xl font-black text-purple-700 mt-0.5">{phones.length}</p>
          <p className="text-[10px] text-purple-500 font-semibold">{inStockPhonesCount} in stock</p>
        </div>
        <div className="bg-white p-3 rounded-xl border border-blue-100 shadow-xs">
          <p className="text-[10px] font-black uppercase text-blue-600">General Products</p>
          <p className="text-xl font-black text-blue-700 mt-0.5">{products.length}</p>
          <p className="text-[10px] text-gray-400">Accessories & items</p>
        </div>
        <div className="bg-white p-3 rounded-xl border border-amber-100 shadow-xs">
          <p className="text-[10px] font-black uppercase text-amber-600">Low Stock Alert</p>
          <p className="text-xl font-black text-amber-600 mt-0.5">{lowStockCount}</p>
          <p className="text-[10px] text-gray-400">Items below threshold</p>
        </div>
        {(user?.role === 'admin' || user?.role === 'manager' || user?.role === 'owner') && (
          <div className="bg-white p-3 rounded-xl border border-emerald-100 shadow-xs col-span-2 sm:col-span-1">
            <p className="text-[10px] font-black uppercase text-emerald-600">Stock Valuation (Cost)</p>
            <p className="text-lg font-black text-emerald-700 mt-0.5">Rs. {totalInventoryCost.toLocaleString()}</p>
            <p className="text-[10px] text-gray-400">Invested asset value</p>
          </div>
        )}
      </div>

      {/* Catalog Switcher & Search / Filters */}
      <div className="bg-white p-4 rounded-xl shadow-xs border border-gray-100 space-y-3">
        {/* Row 1: View Mode Switcher Pills */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
          <div className="flex items-center gap-1.5 bg-gray-100 p-1 rounded-xl">
            <button
              onClick={() => setCatalogType('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                catalogType === 'all' ? 'bg-white text-blue-700 shadow-xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span>📑</span> All Items ({phones.length + products.length})
            </button>
            <button
              onClick={() => setCatalogType('phones')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                catalogType === 'phones' ? 'bg-white text-purple-700 shadow-xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span>📱</span> Mobile Phones (IMEI) ({phones.length})
            </button>
            <button
              onClick={() => setCatalogType('products')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                catalogType === 'products' ? 'bg-white text-blue-700 shadow-xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span>📦</span> General Products ({products.length})
            </button>
          </div>

          <div className="text-xs text-gray-500 font-medium">
            Showing <strong className="text-gray-900">{filteredCatalog.length}</strong> items
          </div>
        </div>

        {/* Row 2: Search Input & Dynamic Dropdown Filters */}
        <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="🔍 Search name, brand, SKU, or IMEI (e.g. 3529...)..."
              className="w-full pl-3.5 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            {/* Category Filter */}
            {catalogType !== 'phones' && (
              <select
                className="px-3 py-2 border border-gray-200 rounded-lg text-xs font-semibold outline-none bg-white"
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
              >
                <option value="">All Categories</option>
                {catalogType === 'all' && <option value="phone_category">📱 Mobile Phones</option>}
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}

            {/* Mobile Phone Specific Filters (PTA & Storage) */}
            {catalogType !== 'products' && (
              <>
                <select
                  className="px-3 py-2 border border-purple-200 rounded-lg text-xs font-bold text-purple-800 outline-none bg-purple-50/50"
                  value={selectedPta}
                  onChange={e => setSelectedPta(e.target.value)}
                >
                  <option value="all">All PTA Status</option>
                  <option value="pta_approved">PTA Approved</option>
                  <option value="non_pta">Non-PTA</option>
                  <option value="jv_gevey">JV / Gevey</option>
                </select>

                <select
                  className="px-3 py-2 border border-gray-200 rounded-lg text-xs font-semibold outline-none bg-white"
                  value={selectedStorage}
                  onChange={e => setSelectedStorage(e.target.value)}
                >
                  <option value="all">All Storage</option>
                  <option value="64GB">64GB</option>
                  <option value="128GB">128GB</option>
                  <option value="256GB">256GB</option>
                  <option value="512GB">512GB</option>
                  <option value="1TB">1TB</option>
                </select>
              </>
            )}

            <label className="flex items-center gap-1.5 cursor-pointer select-none px-3 py-2 border border-gray-200 rounded-lg text-xs font-medium bg-gray-50/50">
              <input
                type="checkbox"
                checked={showLowStockOnly}
                onChange={e => setShowLowStockOnly(e.target.checked)}
                className="w-3.5 h-3.5 text-blue-600 rounded"
              />
              <span>Low Stock</span>
            </label>
          </div>
        </div>
      </div>

      {/* Category Low Stock Alert Banner */}
      {!loading && categoryLowStockAlerts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-amber-800 font-bold text-xs sm:text-sm">⚠️ Low Stock Category Alerts</span>
            <span className="bg-amber-100 text-amber-700 text-[10px] font-black px-2 py-0.5 rounded-full border border-amber-300">
              {categoryLowStockAlerts.length} categories
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {categoryLowStockAlerts.map(({ cat, count }) => (
              <button
                key={cat.id}
                onClick={() => { setSelectedCategory(String(cat.id)); setShowLowStockOnly(true) }}
                className="bg-white border border-amber-300 hover:border-amber-400 text-amber-800 text-[11px] font-semibold px-2.5 py-1 rounded-full transition cursor-pointer"
              >
                📦 {cat.name}: <span className="text-red-600 font-bold">{count} low</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="py-16 text-center text-gray-400 animate-pulse text-base font-medium">
          Loading catalog portfolio & mobile IMEI inventory...
        </div>
      )}

      {/* Empty state */}
      {!loading && filteredCatalog.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
          <p className="text-gray-500 font-bold text-base">No items found matching your filters</p>
          <p className="text-gray-400 text-xs mt-1">Try searching for a different keyword, SKU, or IMEI, or adjust the filters above.</p>
        </div>
      )}

      {/* Products & Phones Table */}
      {!loading && filteredCatalog.length > 0 && (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden relative">
          {/* Mobile Card View */}
          <div className="divide-y divide-gray-100 md:hidden">
            {filteredCatalog.map(item => {
              const isPhone = item.item_type === 'phone'
              const isLow = item.stock_quantity <= (isPhone ? 0 : getEffectiveThreshold(item))
              const cost = Number(item.cost_price || 0)
              const sale = Number(item.sale_price || 0)
              const margin = sale > 0 ? ((sale - cost) / sale * 100) : 0

              return (
                <div key={`${item.item_type}-${item.id}`} className={`p-3.5 ${selected.includes(item.id) ? 'bg-blue-50/60' : ''}`}>
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                          isPhone ? 'bg-purple-100 text-purple-800 border border-purple-200' : 'bg-blue-100 text-blue-800 border border-blue-200'
                        }`}>
                          {isPhone ? '📱 Phone' : '📦 Product'}
                        </span>
                        <p className="truncate font-black text-gray-900 text-sm">{item.name}</p>
                      </div>

                      <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                        {item.brand && (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-700">{item.brand}</span>
                        )}
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">{item.category_name}</span>
                        {isPhone && item.pta_status && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                            item.pta_status === 'pta_approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {item.pta_status.replace(/_/g, ' ')}
                          </span>
                        )}
                        {isPhone && item.storage && (
                          <span className="rounded bg-purple-50 text-purple-700 px-1.5 py-0.5 text-[10px] font-bold">{item.storage}</span>
                        )}
                      </div>

                      {/* IMEI Display on Mobile */}
                      {isPhone && item.imei_1 && (
                        <div className="mt-1.5 flex items-center gap-1 text-[11px] font-mono text-purple-800 bg-purple-50/70 px-2 py-0.5 rounded border border-purple-100">
                          <span className="font-bold">IMEI:</span>
                          <span className="font-semibold">{item.imei_1}</span>
                          <button
                            onClick={(e) => handleCopyImei(e, item.imei_1)}
                            className="ml-auto text-[10px] font-sans font-bold text-purple-600 hover:text-purple-800"
                            title="Copy IMEI"
                          >
                            {copiedImei === item.imei_1 ? '✓ Copied' : '📋 Copy'}
                          </button>
                        </div>
                      )}
                    </div>

                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      className="mt-1 h-4 w-4 rounded text-blue-600"
                    />
                  </div>

                  <div className="mt-2.5 grid grid-cols-3 gap-2 text-xs border-t border-gray-100 pt-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase text-gray-400">Stock</p>
                      <p className={`font-black ${isLow ? 'text-red-600' : 'text-emerald-600'}`}>
                        {isPhone ? (item.stock_quantity > 0 ? 'In Stock (1)' : 'Sold') : item.stock_quantity}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase text-gray-400">Sale Price</p>
                      <p className="font-black text-gray-900">Rs. {sale.toLocaleString()}</p>
                    </div>
                    {(user?.role === 'admin' || user?.role === 'manager' || user?.role === 'owner') && (
                      <div>
                        <p className="text-[10px] font-bold uppercase text-gray-400">Margin</p>
                        <p className={`font-black ${margin >= 25 ? 'text-emerald-600' : margin >= 10 ? 'text-amber-600' : 'text-red-600'}`}>
                          {margin.toFixed(0)}%
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="mt-2.5 flex items-center justify-between gap-1.5 pt-2 border-t border-gray-50">
                    <p className="font-mono text-[10px] text-gray-400 truncate max-w-[120px]">{item.sku || 'No SKU'}</p>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setDetailProduct(item)}
                        title="View Details"
                        className="rounded-lg bg-emerald-50 hover:bg-emerald-100 px-2 py-1.5 text-xs font-bold text-emerald-700 transition flex items-center gap-1"
                      >
                        👁️ Detail
                      </button>
                      <button
                        onClick={() => { setBarcodeModalProduct(item); setShowBarcodeModal(true) }}
                        title="Print Barcode"
                        className="rounded-lg bg-indigo-50 px-2 py-1.5 text-xs font-bold text-indigo-600"
                      >
                        🏷️
                      </button>
                      {!isPhone && (
                        <button
                          onClick={() => { setInlineEditId(item.id); setInlineForm({ ...item }) }}
                          className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-600"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        onClick={() => requestDelete([item.id])}
                        className="rounded-lg bg-red-50 px-2 py-1.5 text-xs font-bold text-red-600"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop Table View */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left">
              <thead className="bg-gray-50/80 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={selected.length === filteredCatalog.length && filteredCatalog.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded text-blue-600"
                    />
                  </th>
                  <th className="px-5 py-3 text-xs font-bold text-gray-500 uppercase">Item / Model</th>
                  <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Type / IMEI</th>
                  <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Category</th>
                  <th className="px-3 py-3 text-xs font-bold text-gray-500 uppercase">Stock</th>
                  <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Cost</th>
                  <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Sale Price</th>
                  {(user?.role === 'admin' || user?.role === 'manager' || user?.role === 'owner') && (
                    <th className="px-3 py-3 text-xs font-bold text-gray-500 uppercase">Margin</th>
                  )}
                  <th className="px-3 py-3 text-xs font-bold text-gray-500 uppercase">Status</th>
                  <th className="px-5 py-3 text-center text-xs font-bold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-sm">
                {filteredCatalog.map((item) => {
                  const isPhone = item.item_type === 'phone'
                  const isLow = item.stock_quantity <= (isPhone ? 0 : getEffectiveThreshold(item))
                  const cost = Number(item.cost_price || 0)
                  const sale = Number(item.sale_price || 0)
                  const margin = sale > 0 ? ((sale - cost) / sale * 100) : 0

                  return inlineEditId === item.id ? (
                    <tr key={item.id} className="bg-blue-50 ring-2 ring-inset ring-blue-300">
                      <td className="px-4 py-3">
                        <input type="checkbox" disabled className="w-4 h-4 rounded opacity-30" />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={inlineForm.name || ''}
                          onChange={e => setInlineForm(f => ({ ...f, name: e.target.value }))}
                          className="w-full text-sm border rounded px-2 py-1 focus:ring-1 focus:ring-blue-400 outline-none"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={inlineForm.brand || ''}
                          onChange={e => setInlineForm(f => ({ ...f, brand: e.target.value }))}
                          className="w-24 text-sm border rounded px-2 py-1 focus:ring-1 focus:ring-blue-400 outline-none"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={inlineForm.category_id || ''}
                          onChange={e => setInlineForm(f => ({ ...f, category_id: e.target.value }))}
                          className="w-full text-sm border rounded px-2 py-1 outline-none"
                        >
                          <option value="">-- None --</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-gray-400 text-xs text-center">{item.stock_quantity}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={inlineForm.cost_price || ''}
                          onChange={e => setInlineForm(f => ({ ...f, cost_price: e.target.value }))}
                          className="w-20 text-sm border rounded px-2 py-1 outline-none"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={inlineForm.sale_price || ''}
                          onChange={e => setInlineForm(f => ({ ...f, sale_price: e.target.value }))}
                          className="w-20 text-sm border rounded px-2 py-1 outline-none"
                        />
                      </td>
                      {(user?.role === 'admin' || user?.role === 'manager' || user?.role === 'owner') && <td className="px-3 py-2"></td>}
                      <td className="px-3 py-2">
                        <select
                          value={inlineForm.status || 'active'}
                          onChange={e => setInlineForm(f => ({ ...f, status: e.target.value }))}
                          className="text-xs border rounded px-2 py-1 outline-none"
                        >
                          <option value="active">active</option>
                          <option value="inactive">inactive</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex justify-center gap-1.5">
                          <button
                            onClick={handleInlineSave}
                            disabled={inlineSaving}
                            className="text-emerald-700 hover:text-emerald-900 font-bold text-xs bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded transition disabled:opacity-50"
                          >
                            {inlineSaving ? '...' : '✓ Save'}
                          </button>
                          <button
                            onClick={() => setInlineEditId(null)}
                            className="text-gray-500 hover:text-gray-700 font-bold text-xs bg-gray-50 hover:bg-gray-100 px-2.5 py-1 rounded transition"
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={`${item.item_type}-${item.id}`} className={`hover:bg-gray-50/80 transition ${selected.includes(item.id) ? 'bg-blue-50/50' : ''}`}>
                      <td className="px-4 py-3.5">
                        <input
                          type="checkbox"
                          checked={selected.includes(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          className="w-4 h-4 rounded text-blue-600"
                        />
                      </td>

                      {/* Product Name & Brand */}
                      <td className="px-5 py-3.5">
                        <div className="font-bold text-gray-900 flex items-center gap-2">
                          <span>{item.name}</span>
                          {isPhone && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-black uppercase bg-purple-100 text-purple-800 border border-purple-200">
                              Phone
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {item.brand && (
                            <span className="text-[10px] font-black text-gray-500 uppercase">{item.brand}</span>
                          )}
                          {isPhone && item.storage && (
                            <span className="text-[10px] text-purple-700 font-bold">• {item.storage}</span>
                          )}
                          {isPhone && item.color && (
                            <span className="text-[10px] text-gray-400">• {item.color}</span>
                          )}
                        </div>
                      </td>

                      {/* Type / IMEI */}
                      <td className="px-4 py-3.5">
                        {isPhone ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-100 w-fit">
                              <span className="text-[10px] font-sans text-purple-400">IMEI:</span>
                              <span>{item.imei_1 || 'N/A'}</span>
                              {item.imei_1 && (
                                <button
                                  onClick={(e) => handleCopyImei(e, item.imei_1)}
                                  className="text-[10px] text-purple-500 hover:text-purple-800 font-sans cursor-pointer"
                                  title="Copy IMEI"
                                >
                                  {copiedImei === item.imei_1 ? '✓' : '📋'}
                                </button>
                              )}
                            </div>
                            {item.pta_status && (
                              <span className={`inline-block px-1.5 py-0.2 rounded text-[10px] font-black uppercase tracking-wider ${
                                item.pta_status === 'pta_approved'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : item.pta_status === 'non_pta'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-purple-100 text-purple-800'
                              }`}>
                                {item.pta_status.replace(/_/g, ' ')}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="font-mono text-xs text-gray-500">{item.sku || <span className="italic text-gray-300">—</span>}</span>
                        )}
                      </td>

                      {/* Category */}
                      <td className="px-4 py-3.5 text-xs text-gray-600 font-medium">
                        {item.category_name}
                      </td>

                      {/* Stock */}
                      <td className="px-3 py-3.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                          isLow
                            ? 'bg-red-100 text-red-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {isPhone ? (item.stock_quantity > 0 ? '1 In Stock' : 'Sold') : item.stock_quantity}
                        </span>
                      </td>

                      {/* Cost */}
                      <td className="px-4 py-3.5 text-xs text-gray-500 font-semibold">
                        Rs. {cost.toLocaleString()}
                      </td>

                      {/* Sale Price */}
                      <td className="px-4 py-3.5 text-xs text-gray-900 font-black">
                        Rs. {sale.toLocaleString()}
                      </td>

                      {/* Margin */}
                      {(user?.role === 'admin' || user?.role === 'manager' || user?.role === 'owner') && (
                        <td className="px-3 py-3.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                            margin >= 25 ? 'bg-emerald-100 text-emerald-700' : margin >= 10 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'
                          }`}>
                            {margin.toFixed(0)}%
                          </span>
                        </td>
                      )}

                      {/* Status */}
                      <td className="px-3 py-3.5">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider ${
                          item.status === 'active' || item.status === 'in_stock'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-gray-100 text-gray-600 border border-gray-200'
                        }`}>
                          {item.status === 'in_stock' ? 'In Stock' : item.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3.5 text-center">
                        <div className="flex justify-center items-center gap-1.5">
                          <button
                            onClick={() => setDetailProduct(item)}
                            title="View Complete Specifications & Details"
                            className="p-1.5 text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition font-bold text-xs"
                          >
                            👁️ Detail
                          </button>
                          <button
                            onClick={() => { setBarcodeModalProduct(item); setShowBarcodeModal(true) }}
                            title="Print Barcode Label"
                            className="p-1.5 text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition text-xs"
                          >
                            🏷️
                          </button>
                          {!isPhone && (
                            <button
                              onClick={() => { setInlineEditId(item.id); setInlineForm({ ...item }) }}
                              title="Inline Edit"
                              className="px-2 py-1 text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 rounded-lg transition font-bold text-xs"
                            >
                              Edit
                            </button>
                          )}
                          <button
                            onClick={() => requestDelete([item.id])}
                            title="Delete Item"
                            className="p-1.5 text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 rounded-lg transition text-xs"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import Preview Modal */}
      {showImportPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start sm:items-center justify-center z-50 overflow-y-auto py-4 px-2 sm:px-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-4xl flex flex-col">
            <h2 className="text-xl font-bold text-gray-800 mb-1">📥 Import Preview</h2>
            <p className="text-sm text-gray-500 mb-3">{importPreviewRows.length} products ready to import. Category match status check karein.</p>

            {importPreviewRows.some(r => r.categoryName && !r.categoryId) && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3">
                <p className="text-sm text-yellow-800 font-medium">
                  ⚠️ {importPreviewRows.filter(r => r.categoryName && !r.categoryId).length} row(s) mein category match nahi hui.
                </p>
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input type="checkbox" checked={autoCreateCategories} onChange={e => setAutoCreateCategories(e.target.checked)} className="w-4 h-4 rounded accent-blue-600" />
                  <span className="text-sm text-yellow-800">Missing categories auto-create karo</span>
                </label>
              </div>
            )}

            {importPreviewRows.some(r => r.brand && !r.brandMatched) && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-3">
                <p className="text-sm text-orange-800 font-medium">
                  ⚠️ {importPreviewRows.filter(r => r.brand && !r.brandMatched).length} row(s) mein brand match nahi hui — ye brands aapke system mein nahi hain.
                </p>
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input type="checkbox" checked={autoCreateBrands} onChange={e => setAutoCreateBrands(e.target.checked)} className="w-4 h-4 rounded accent-orange-500" />
                  <span className="text-sm text-orange-800">Missing brands auto-create karo</span>
                </label>
              </div>
            )}

            <div className="flex-1 overflow-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">#</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">Product Name</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">Brand</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">Category</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">Cost</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">Sale</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {importPreviewRows.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{row.name}</td>
                      <td className="px-3 py-2">
                        {row.brand ? (
                          row.brandMatched ? (
                            <span className="text-green-700 bg-green-50 px-2 py-0.5 rounded-full text-xs font-medium">✓ {row.brand}</span>
                          ) : (
                            <span className="text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full text-xs font-medium">✗ {row.brand}</span>
                          )
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {row.categoryName ? (
                          row.categoryId ? (
                            <span className="text-green-700 bg-green-50 px-2 py-0.5 rounded-full text-xs font-medium">✓ {row.categoryName}</span>
                          ) : (
                            <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded-full text-xs font-medium">✗ {row.categoryName}</span>
                          )
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600">Rs.{row.cost_price}</td>
                      <td className="px-3 py-2 text-gray-600">Rs.{row.sale_price}</td>
                      <td className="px-3 py-2 text-gray-600">{row.stock_quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3 mt-4">
              <button onClick={handleConfirmImport}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition">
                ✅ Confirm Import ({importPreviewRows.length} products)
              </button>
              <button onClick={() => { setShowImportPreview(false); setImportPreviewRows([]) }}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-bold transition">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showPasswordModal && (
        <PasswordModal
          title="Delete Product(s)"
          message={`${pendingDeleteIds.length} item(s) will be moved to Trash`}
          onConfirm={executeDelete}
          onCancel={() => { setShowPasswordModal(false); setPendingDeleteIds([]) }}
        />
      )}

      {/* Bulk Edit Modal */}
      {showBulkEdit && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-start sm:items-center justify-center z-50 overflow-y-auto py-4 px-2 sm:px-4">
          <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-sm">
            <h2 className="text-xl font-bold text-gray-800 mb-1">✏️ Bulk Edit</h2>
            <p className="text-sm text-gray-500 mb-4">{selected.length} product(s) selected. Sirf woh fields update hongi jo aap select karein.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-gray-700 font-medium mb-1">Category</label>
                <select
                  value={bulkCategory}
                  onChange={e => setBulkCategory(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">— Don't change —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-gray-700 font-medium mb-1">Brand</label>
                <select
                  value={bulkBrand}
                  onChange={e => setBulkBrand(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">— Don't change —</option>
                  {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-gray-700 font-medium mb-1">Unit</label>
                <select
                  value={bulkUnit}
                  onChange={e => setBulkUnit(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">— Don't change —</option>
                  {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={handleBulkEdit}
                disabled={bulkSaving || (!bulkCategory && !bulkBrand && !bulkUnit)}
                className="flex-1 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold transition disabled:opacity-50"
              >
                {bulkSaving ? 'Updating...' : '✅ Apply Changes'}
              </button>
              <button
                onClick={() => { setShowBulkEdit(false); setBulkUnit('') }}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-bold transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barcode Label Printing Modal */}
      {showBarcodeModal && (
        <BarcodeLabelModal
          isOpen={showBarcodeModal}
          onClose={() => setShowBarcodeModal(false)}
          products={selected.length > 0 ? fullCatalog.filter(p => selected.includes(p.id)) : fullCatalog}
          defaultProduct={barcodeModalProduct}
          shopName={localStorage.getItem(`shop_name_${user?.shop_id}`) || 'EdgeX POS'}
        />
      )}

      {/* Product Detail Modal */}
      {detailProduct && (
        <ProductDetailModal
          isOpen={!!detailProduct}
          onClose={() => setDetailProduct(null)}
          product={detailProduct}
          categoryName={detailProduct.item_type === 'phone' ? 'Mobile Phones' : (categories.find(c => c.id === detailProduct.category_id)?.name || detailProduct.categories?.name)}
          unitName={detailProduct.item_type === 'phone' ? 'Device' : units.find(u => u.id === detailProduct.unit_id)?.name}
          supplierName={detailProduct.supplier_name || suppliers.find(s => s.id === detailProduct.supplier_id)?.name}
          onEdit={(prod) => {
            setDetailProduct(null)
            if (prod.item_type === 'phone') {
              // Phones are edited in stock inventory / purchases
              alert('Mobile phone serial & IMEI records are managed through Inventory.')
            } else {
              setInlineEditId(prod.id)
              setInlineForm({ ...prod })
            }
          }}
          onPrintBarcode={(prod) => {
            setBarcodeModalProduct(prod)
            setShowBarcodeModal(true)
          }}
          userRole={user?.role}
        />
      )}
    </div>
  )
}

export default Products
