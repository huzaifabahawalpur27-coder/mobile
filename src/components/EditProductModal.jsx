import { useState, useEffect } from 'react'
import {
  X,
  Package,
  Smartphone,
  DollarSign,
  Tag,
  Layers,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Barcode,
  Plus,
  Truck,
  Boxes
} from 'lucide-react'
import { supabase } from '../services/supabase'
import { db, addToSyncQueue } from '../services/db'
import { recordAuditLog } from '../services/auditService'
import ProductConversionModal from './ProductConversionModal'
import BatchManagementModal from './BatchManagementModal'

const PHONE_STORAGES = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB']
const PHONE_CONDITIONS = ['Brand New', 'Used - Like New', 'Used - Good', 'Used - Fair', 'Refurbished', 'Damaged']
const PTA_STATUSES = ['PTA Approved', 'Non-PTA', 'JV / Gevey', 'Software Patch', 'CPID Approved']

export default function EditProductModal({
  isOpen,
  onClose,
  product,
  categories = [],
  brands = [],
  suppliers = [],
  units = [],
  onSaveSuccess,
  userRole = 'admin',
  shopId = null
}) {
  const isPhone = Boolean(
    product?.item_type === 'phone' ||
    product?.imei_1 ||
    (product?.brand && product?.model && (product?.storage || product?.pta_status || product?.color))
  )

  const canViewCost = ['owner', 'admin', 'manager', 'superadmin'].includes(userRole)

  // Standard Product Form State
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [brand, setBrand] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [unitId, setUnitId] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [salePrice, setSalePrice] = useState('')
  const [cRate, setCRate] = useState('')
  const [stockQuantity, setStockQuantity] = useState('')
  const [lowStockThreshold, setLowStockThreshold] = useState('10')
  const [status, setStatus] = useState('active')

  // Phone-specific Form State
  const [model, setModel] = useState('')
  const [storage, setStorage] = useState('128GB')
  const [color, setColor] = useState('')
  const [condition, setCondition] = useState('Used - Good')
  const [ptaStatus, setPtaStatus] = useState('PTA Approved')
  const [imei1, setImei1] = useState('')
  const [imei2, setImei2] = useState('')
  const [batteryHealth, setBatteryHealth] = useState('')
  const [notes, setNotes] = useState('')

  // Quick Brand Add State
  const [showAddBrand, setShowAddBrand] = useState(false)
  const [newBrandName, setNewBrandName] = useState('')
  const [localBrands, setLocalBrands] = useState([])

  // Submission State
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [showConversionModal, setShowConversionModal] = useState(false)
  const [showBatchModal, setShowBatchModal] = useState(false)

  useEffect(() => {
    if (brands && brands.length > 0) {
      setLocalBrands(brands)
    }
  }, [brands])

  useEffect(() => {
    if (product) {
      setErrorMsg('')
      setShowAddBrand(false)
      setNewBrandName('')

      if (isPhone) {
        setBrand(product.brand || '')
        setModel(product.model || product.name || '')
        setStorage(product.storage || '128GB')
        setColor(product.color || '')
        setCondition(product.condition || 'Used - Good')
        setPtaStatus(product.pta_status || 'PTA Approved')
        setImei1(product.imei_1 || product.sku || '')
        setImei2(product.imei_2 || '')
        setBatteryHealth(product.battery_health ? String(product.battery_health) : '')
        setNotes(product.notes || product.defects || '')
        setCostPrice(product.cost_price !== undefined && product.cost_price !== null ? String(product.cost_price) : '')
        setSalePrice(
          product.sale_price !== undefined && product.sale_price !== null
            ? String(product.sale_price)
            : product.selling_price !== undefined
              ? String(product.selling_price)
              : ''
        )
        setStatus(product.status || 'in_stock')
      } else {
        setName(product.name || '')
        setSku(product.sku || '')
        setBrand(product.brand || '')
        setCategoryId(product.category_id ? String(product.category_id) : '')
        setSupplierId(product.supplier_id ? String(product.supplier_id) : '')
        setUnitId(product.unit_id ? String(product.unit_id) : '')
        setCostPrice(product.cost_price !== undefined && product.cost_price !== null ? String(product.cost_price) : '')
        setSalePrice(product.sale_price !== undefined && product.sale_price !== null ? String(product.sale_price) : '')
        setCRate(product.c_rate !== undefined && product.c_rate !== null ? String(product.c_rate) : '')
        setStockQuantity(product.stock_quantity !== undefined && product.stock_quantity !== null ? String(product.stock_quantity) : '0')
        setLowStockThreshold(product.low_stock_threshold ? String(product.low_stock_threshold) : '10')
        setStatus(product.status || 'active')
      }
    }
  }, [product, isPhone])

  // Real-time Financial Calculations
  const parsedCost = parseFloat(costPrice) || 0
  const parsedSale = parseFloat(salePrice) || 0
  const profitPerUnit = parsedSale - parsedCost
  const marginPercent = parsedSale > 0 ? (profitPerUnit / parsedSale) * 100 : 0

  // SKU Auto-generator
  const handleAutoGenerateSKU = () => {
    const rawName = isPhone ? `${brand}-${model}` : (name || 'PRD')
    const prefix = rawName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'ITEM'
    const rand = Math.floor(1000 + Math.random() * 9000)
    setSku(`${prefix}-${rand}`)
  }

  // Quick Add Brand
  const handleQuickAddBrand = async () => {
    if (!newBrandName.trim()) return
    const nameToAdd = newBrandName.trim()
    try {
      const payload = { name: nameToAdd, shop_id: shopId || product?.shop_id }
      if (navigator.onLine) {
        const { data, error } = await supabase.from('brands').insert([payload]).select()
        if (error) throw error
        if (data && data[0]) {
          setLocalBrands(prev => [...prev, data[0]])
          setBrand(data[0].name)
        }
      } else {
        const localObj = { id: Date.now(), ...payload }
        if (db.brands) {
          await db.brands.add(localObj)
          await addToSyncQueue('brands', 'INSERT', localObj)
        }
        setLocalBrands(prev => [...prev, localObj])
        setBrand(nameToAdd)
      }
      setNewBrandName('')
      setShowAddBrand(false)
    } catch (err) {
      alert('Failed to add brand: ' + (err.message || String(err)))
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setErrorMsg('')

    if (isPhone) {
      if (!model.trim()) {
        setErrorMsg('Phone Model name is required.')
        return
      }
      if (!imei1.trim()) {
        setErrorMsg('Valid Primary IMEI 1 is required for mobile phones.')
        return
      }
    } else {
      if (!name.trim()) {
        setErrorMsg('Product Name is required.')
        return
      }
    }

    if (parsedSale < 0) {
      setErrorMsg('Sale Price cannot be negative.')
      return
    }
    if (canViewCost && parsedCost < 0) {
      setErrorMsg('Cost Price cannot be negative.')
      return
    }

    setSaving(true)

    try {
      const targetId = product.id
      const numId = parseInt(targetId, 10)
      const isOnline = navigator.onLine

      if (isPhone) {
        // ── UPDATE SERIALIZED PHONE ──
        const phoneUpdates = {
          brand: brand.trim() || 'Other',
          model: model.trim(),
          storage: storage || null,
          color: color.trim() || null,
          condition: condition || 'Used',
          pta_status: ptaStatus || 'PTA Approved',
          imei_1: imei1.trim(),
          imei_2: imei2.trim() || null,
          sale_price: parsedSale,
          selling_price: parsedSale,
          expected_sale_price: parsedSale,
          status: status || 'in_stock',
          notes: notes.trim() || null,
          updated_at: new Date().toISOString()
        }

        if (canViewCost) {
          phoneUpdates.cost_price = parsedCost
        }
        if (batteryHealth) {
          phoneUpdates.battery_health = parseInt(batteryHealth, 10) || null
        }

        // 1. Update IndexedDB
        if (db.phones) {
          await db.phones.update(targetId, phoneUpdates).catch(async () => {
            if (!isNaN(numId)) await db.phones.update(numId, phoneUpdates).catch(() => {})
          })
        }

        // 2. Update Supabase
        if (isOnline) {
          const queryId = !isNaN(numId) ? numId : targetId
          const { error } = await supabase.from('phones').update(phoneUpdates).eq('id', queryId)
          if (error) throw error
        } else {
          await addToSyncQueue('phones', 'UPDATE', { id: targetId, ...phoneUpdates })
        }

        await recordAuditLog(
          'EDIT_PHONE',
          'phones',
          String(targetId),
          { model: phoneUpdates.model, imei: phoneUpdates.imei_1, changes: phoneUpdates }
        ).catch(() => {})

      } else {
        // ── UPDATE STANDARD CATALOG PRODUCT ──
        const toIntOrNull = (v) => { const n = parseInt(v, 10); return (!isNaN(n) && n > 0) ? n : null }
        const toNumOrZero = (v, def = 0) => {
          if (v === null || v === undefined || v === '') return def
          const n = parseFloat(v)
          return isNaN(n) ? def : n
        }

        const productUpdates = {
          name: name.trim(),
          sku: sku.trim() || null,
          brand: brand.trim() || null,
          category_id: toIntOrNull(categoryId),
          supplier_id: toIntOrNull(supplierId),
          unit_id: toIntOrNull(unitId),
          cost_price: canViewCost ? parsedCost : (product.cost_price || 0),
          sale_price: parsedSale,
          c_rate: toNumOrZero(cRate, 0),
          stock_quantity: toNumOrZero(stockQuantity, 0),
          low_stock_threshold: toNumOrZero(lowStockThreshold, 10),
          status: status || 'active',
          updated_at: new Date().toISOString()
        }

        // 1. Update IndexedDB
        if (db.products) {
          await db.products.update(targetId, productUpdates).catch(async () => {
            if (!isNaN(numId)) await db.products.update(numId, productUpdates).catch(() => {})
          })
        }

        // 2. Update Supabase
        if (isOnline) {
          const queryId = !isNaN(numId) ? numId : targetId
          let { error } = await supabase.from('products').update(productUpdates).eq('id', queryId)
          if (error && (error.code === '23503' || error.message?.includes('foreign key') || error.message?.includes('fkey'))) {
            // If FK constraint fails on deleted category/unit, retry with null FKs
            const fallback = { ...productUpdates, category_id: null, supplier_id: null, unit_id: null }
            const retry = await supabase.from('products').update(fallback).eq('id', queryId)
            error = retry.error
          }
          if (error) throw error
        } else {
          await addToSyncQueue('products', 'UPDATE', { id: targetId, ...productUpdates })
        }

        await recordAuditLog(
          'EDIT_PRODUCT',
          'products',
          String(targetId),
          { name: productUpdates.name, sku: productUpdates.sku, changes: productUpdates }
        ).catch(() => {})
      }

      if (onSaveSuccess) onSaveSuccess()
      onClose()
    } catch (err) {
      console.error('Save product details error:', err)
      setErrorMsg(err.message || 'Failed to update product details.')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen || !product) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="w-full max-w-2xl sm:max-w-3xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 flex flex-col max-h-[92dvh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── MODAL HEADER ── */}
        <div className="px-5 py-4 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between bg-gray-50/70 dark:bg-slate-800/50 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black shrink-0 ${
              isPhone
                ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400'
                : 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
            }`}>
              {isPhone ? <Smartphone size={20} /> : <Package size={20} />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-gray-900 dark:text-white truncate">
                  {isPhone ? 'Edit Mobile Phone Details' : 'Edit Product Details'}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 shrink-0">
                  {isPhone ? 'Phone Inventory' : 'Product Catalog'}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {product.name || `${product.brand || ''} ${product.model || ''}`} • ID: #{product.id}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition cursor-pointer"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* ── MODAL BODY FORM ── */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 custom-scrollbar min-h-0 text-xs">
          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-xl flex items-center gap-2 text-red-700 dark:text-red-400">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {isPhone ? (
            /* ════════════════════════════════════════════════════════════
               FORM: MOBILE PHONE SPECIFIC FIELDS
            ════════════════════════════════════════════════════════════ */
            <div className="space-y-4">
              {/* Device Identity */}
              <div className="p-4 bg-gray-50/70 dark:bg-slate-800/40 rounded-xl border border-gray-200 dark:border-slate-800 space-y-3">
                <h3 className="font-black text-xs uppercase tracking-wider text-purple-700 dark:text-purple-400 flex items-center gap-1.5">
                  <Smartphone size={14} /> Device Identity (فون کی معلومات)
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Brand *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Apple, Samsung"
                      value={brand}
                      onChange={e => setBrand(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white font-semibold"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Model Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. iPhone 15 Pro Max"
                      value={model}
                      onChange={e => setModel(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white font-bold"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Storage</label>
                    <select
                      value={storage}
                      onChange={e => setStorage(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white font-semibold"
                    >
                      {PHONE_STORAGES.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Color</label>
                    <input
                      type="text"
                      placeholder="e.g. Natural Titanium, Black"
                      value={color}
                      onChange={e => setColor(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Condition</label>
                    <select
                      value={condition}
                      onChange={e => setCondition(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white font-semibold"
                    >
                      {PHONE_CONDITIONS.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">PTA Status</label>
                    <select
                      value={ptaStatus}
                      onChange={e => setPtaStatus(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white font-semibold"
                    >
                      {PTA_STATUSES.map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Hardware Identifiers */}
              <div className="p-4 bg-gray-50/70 dark:bg-slate-800/40 rounded-xl border border-gray-200 dark:border-slate-800 space-y-3">
                <h3 className="font-black text-xs uppercase tracking-wider text-purple-700 dark:text-purple-400 flex items-center gap-1.5">
                  <Barcode size={14} /> IMEI Numbers & Hardware Specs
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Primary IMEI 1 *</label>
                    <input
                      type="text"
                      required
                      placeholder="15-digit IMEI 1"
                      value={imei1}
                      onChange={e => setImei1(e.target.value)}
                      className="w-full p-2 font-mono font-bold bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-purple-700 dark:text-purple-300"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Secondary IMEI 2</label>
                    <input
                      type="text"
                      placeholder="Optional IMEI 2"
                      value={imei2}
                      onChange={e => setImei2(e.target.value)}
                      className="w-full p-2 font-mono bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-700 dark:text-gray-300"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Battery Health (%)</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      placeholder="e.g. 88"
                      value={batteryHealth}
                      onChange={e => setBatteryHealth(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Pricing & Inventory Status */}
              <div className="p-4 bg-gray-50/70 dark:bg-slate-800/40 rounded-xl border border-gray-200 dark:border-slate-800 space-y-3">
                <h3 className="font-black text-xs uppercase tracking-wider text-purple-700 dark:text-purple-400 flex items-center gap-1.5">
                  <DollarSign size={14} /> Pricing & Stock Status
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {canViewCost && (
                    <div>
                      <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Cost / Purchase Price (Rs.)</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="0"
                        value={costPrice}
                        onChange={e => setCostPrice(e.target.value)}
                        className="w-full p-2 font-mono font-bold bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white text-right"
                      />
                    </div>
                  )}

                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Selling / Sale Price (Rs.) *</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      placeholder="0"
                      value={salePrice}
                      onChange={e => setSalePrice(e.target.value)}
                      className="w-full p-2 font-mono font-black bg-white dark:bg-slate-900 border border-emerald-400 dark:border-emerald-600 rounded-lg text-emerald-700 dark:text-emerald-400 text-right"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Inventory Status</label>
                    <select
                      value={status}
                      onChange={e => setStatus(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white font-bold"
                    >
                      <option value="in_stock">In Stock (Available)</option>
                      <option value="sold">Sold</option>
                      <option value="returned">Returned / Voided</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Inspection Notes / Defects</label>
                  <input
                    type="text"
                    placeholder="e.g. Minor scratch on bezel, includes original box & cable"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="w-full p-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          ) : (
            /* ════════════════════════════════════════════════════════════
               FORM: STANDARD PRODUCT / ACCESSORY FIELDS
            ════════════════════════════════════════════════════════════ */
            <div className="space-y-4">
              {/* Basic Information */}
              <div className="p-4 bg-gray-50/70 dark:bg-slate-800/40 rounded-xl border border-gray-200 dark:border-slate-800 space-y-3">
                <h3 className="font-black text-xs uppercase tracking-wider text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
                  <Tag size={14} /> Basic Product Information (بنیادی معلومات)
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Product Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Fast Charger 20W Type-C"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white font-bold"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="font-bold text-gray-600 dark:text-gray-400">SKU / Barcode</label>
                      <button
                        type="button"
                        onClick={handleAutoGenerateSKU}
                        className="text-[10px] text-blue-600 hover:text-blue-800 dark:text-blue-400 font-bold cursor-pointer"
                      >
                        Auto-generate
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="e.g. CHG-20W-01"
                      value={sku}
                      onChange={e => setSku(e.target.value)}
                      className="w-full p-2 font-mono bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="font-bold text-gray-600 dark:text-gray-400">Brand</label>
                      <button
                        type="button"
                        onClick={() => setShowAddBrand(!showAddBrand)}
                        className="text-[10px] text-blue-600 hover:text-blue-800 dark:text-blue-400 font-bold cursor-pointer"
                      >
                        {showAddBrand ? 'Choose existing' : '+ New Brand'}
                      </button>
                    </div>

                    {showAddBrand ? (
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          placeholder="Brand name"
                          value={newBrandName}
                          onChange={e => setNewBrandName(e.target.value)}
                          className="flex-1 p-2 bg-white dark:bg-slate-900 border border-blue-400 rounded-lg text-gray-900 dark:text-white font-semibold"
                        />
                        <button
                          type="button"
                          onClick={handleQuickAddBrand}
                          className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold"
                        >
                          Add
                        </button>
                      </div>
                    ) : (
                      <select
                        value={brand}
                        onChange={e => setBrand(e.target.value)}
                        className="w-full p-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white font-semibold"
                      >
                        <option value="">-- No Brand / Generic --</option>
                        {localBrands.map(b => (
                          <option key={b.id || b.name} value={b.name}>{b.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Category</label>
                    <select
                      value={categoryId}
                      onChange={e => setCategoryId(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white font-semibold"
                    >
                      <option value="">-- Select Category --</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Supplier</label>
                    <select
                      value={supplierId}
                      onChange={e => setSupplierId(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white font-semibold"
                    >
                      <option value="">-- Select Supplier --</option>
                      {suppliers.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Measurement Unit</label>
                    <select
                      value={unitId}
                      onChange={e => setUnitId(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white font-semibold"
                    >
                      <option value="">-- Pieces / Standard --</option>
                      {units.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Pricing & Valuation */}
              <div className="p-4 bg-gray-50/70 dark:bg-slate-800/40 rounded-xl border border-gray-200 dark:border-slate-800 space-y-3">
                <h3 className="font-black text-xs uppercase tracking-wider text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
                  <DollarSign size={14} /> Pricing & Rates (قیمتیں)
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {canViewCost && (
                    <div>
                      <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Cost Price (خرید قیمت)</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="0"
                        value={costPrice}
                        onChange={e => setCostPrice(e.target.value)}
                        className="w-full p-2 font-mono font-bold bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white text-right"
                      />
                    </div>
                  )}

                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Sale / Retail Price (فروخت قیمت) *</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      placeholder="0"
                      value={salePrice}
                      onChange={e => setSalePrice(e.target.value)}
                      className="w-full p-2 font-mono font-black bg-white dark:bg-slate-900 border border-emerald-400 dark:border-emerald-600 rounded-lg text-emerald-700 dark:text-emerald-400 text-right"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Wholesale / C-Rate</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0"
                      value={cRate}
                      onChange={e => setCRate(e.target.value)}
                      className="w-full p-2 font-mono bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white text-right"
                    />
                  </div>
                </div>
              </div>

              {/* Inventory Management & Status */}
              <div className="p-4 bg-gray-50/70 dark:bg-slate-800/40 rounded-xl border border-gray-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-xs uppercase tracking-wider text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
                    <Layers size={14} /> Stock & Visibility (اسٹاک کنٹرول)
                  </h3>

                  {!isPhone && (
                    <div>
                      {product?.inventory_mode === 'batch_tracked' ? (
                        <button
                          type="button"
                          onClick={() => setShowBatchModal(true)}
                          className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-300 flex items-center gap-1 transition cursor-pointer"
                        >
                          <Boxes size={12} /> Manage FIFO Batches
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowConversionModal(true)}
                          className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-emerald-700 hover:bg-emerald-50 border border-dashed border-emerald-400 flex items-center gap-1 transition cursor-pointer"
                        >
                          <Boxes size={12} /> Convert to FIFO Batches
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Current Stock Quantity</label>
                    <input
                      type="number"
                      step="any"
                      placeholder="0"
                      value={stockQuantity}
                      onChange={e => setStockQuantity(e.target.value)}
                      className="w-full p-2 font-mono font-bold bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white text-center"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Low Stock Alert (≤)</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="10"
                      value={lowStockThreshold}
                      onChange={e => setLowStockThreshold(e.target.value)}
                      className="w-full p-2 font-mono bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white text-center"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-gray-600 dark:text-gray-400 block mb-1">Catalog Status</label>
                    <select
                      value={status}
                      onChange={e => setStatus(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white font-bold"
                    >
                      <option value="active">Active (Visible in POS)</option>
                      <option value="inactive">Inactive (Hidden)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── PROFIT & MARGIN PREVIEW BAR ── */}
          {canViewCost && parsedSale > 0 && parsedCost > 0 && (
            <div className="p-3 bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 rounded-xl flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300 font-bold">
                <CheckCircle2 size={16} />
                <span>Estimated Profit: Rs. {profitPerUnit.toLocaleString('en-PK')} / unit</span>
              </div>
              <div className="font-black text-emerald-700 dark:text-emerald-400 font-mono">
                Margin: {marginPercent.toFixed(1)}%
              </div>
            </div>
          )}
        </form>

        {/* ── MODAL FOOTER ── */}
        <div className="px-5 py-3.5 bg-gray-50 dark:bg-slate-800/80 border-t border-gray-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-xl transition cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-black rounded-xl shadow-md transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {saving ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                <span>Saving Changes...</span>
              </>
            ) : (
              <span>Save Product Details</span>
            )}
          </button>
        </div>
      </div>

      {/* FIFO Batch Conversion & Management Modals */}
      <ProductConversionModal
        isOpen={showConversionModal}
        onClose={() => setShowConversionModal(false)}
        product={product}
        userShopId={shopId || product?.shop_id}
        onSuccess={() => {
          if (onSaveSuccess) onSaveSuccess()
        }}
      />

      <BatchManagementModal
        isOpen={showBatchModal}
        onClose={() => setShowBatchModal(false)}
        product={product}
        userShopId={shopId || product?.shop_id}
      />
    </div>
  )
}
