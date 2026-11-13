import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { useNavigate, useParams } from 'react-router-dom'
import { db, addToSyncQueue } from '../services/db'
import { getShopPreset, getPricingConfig } from '../utils/businessPresets'
import { notify } from '../utils/toast'

function EditProduct() {
  const { id } = useParams()
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
  const [fetching, setFetching] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [isPhoneItem, setIsPhoneItem] = useState(false)
  const [showNewBrandInput, setShowNewBrandInput] = useState(false)
  const [newBrandName, setNewBrandName] = useState('')
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

  useEffect(() => {
    fetchData()
  }, [id])

  const fetchData = async () => {
    try {
      setNotFound(false)
      if (!navigator.onLine) throw new Error('Offline')

      const numId = parseInt(id, 10)
      const queryId = !isNaN(numId) ? numId : id

      // Fetch product and relationships
      const fetchPromise = Promise.all([
        supabase.from('products').select('*').eq('id', queryId).eq('shop_id', user.shop_id).maybeSingle(),
        supabase.from('categories').select('*').eq('shop_id', user.shop_id).order('name'),
        supabase.from('suppliers').select('*').eq('shop_id', user.shop_id).order('name'),
        supabase.from('brands').select('*').eq('shop_id', user.shop_id).order('name'),
        supabase.from('units').select('*').eq('shop_id', user.shop_id).order('name')
      ])

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      const [prodResult, catResult, supResult, brandResult, unitResult] = await Promise.race([fetchPromise, timeoutPromise])

      let product = prodResult.data
      let phoneDetected = false

      if (!product) {
        // Check if this ID belongs to a mobile phone in phones table
        const { data: phoneRow } = await supabase
          .from('phones')
          .select('*')
          .eq('id', queryId)
          .eq('shop_id', user.shop_id)
          .maybeSingle()

        if (phoneRow) {
          phoneDetected = true
          setIsPhoneItem(true)
          product = {
            name: `${phoneRow.brand || ''} ${phoneRow.model || ''} ${phoneRow.storage || ''} ${phoneRow.color || ''}`.trim() || 'Mobile Phone',
            sku: phoneRow.imei_1 || '',
            brand: phoneRow.brand || '',
            category_id: '',
            supplier_id: phoneRow.supplier_id || '',
            unit_id: '',
            c_rate: 0,
            cost_price: phoneRow.cost_price || 0,
            sale_price: phoneRow.sale_price || phoneRow.selling_price || 0,
            stock_quantity: phoneRow.status === 'in_stock' ? 1 : 0,
            low_stock_threshold: '1',
            status: phoneRow.status === 'in_stock' ? 'active' : phoneRow.status
          }
        }
      }

      if (!product) throw new Error('Product not found')

      if (unitResult?.data) { setUnits(unitResult.data); try { await db.units.bulkPut(JSON.parse(JSON.stringify(unitResult.data))) } catch (_) {} }
      setForm({
        name: product.name || '',
        sku: product.sku || '',
        brand: product.brand || '',
        category_id: product.category_id || '',
        supplier_id: product.supplier_id || '',
        unit_id: product.unit_id || '',
        c_rate: product.c_rate || '',
        cost_price: product.cost_price || '',
        sale_price: product.sale_price || '',
        stock_quantity: product.stock_quantity || '',
        low_stock_threshold: product.low_stock_threshold || '10',
        status: product.status || 'active'
      })

      if (catResult.data) {
        setCategories(catResult.data)
        await db.categories.bulkPut(JSON.parse(JSON.stringify(catResult.data))).catch(() => {})
      }
      if (supResult.data) {
        setSuppliers(supResult.data)
        await db.suppliers.bulkPut(JSON.parse(JSON.stringify(supResult.data))).catch(() => {})
      }
      if (brandResult.data) {
        setBrands(brandResult.data)
        await db.brands.bulkPut(JSON.parse(JSON.stringify(brandResult.data))).catch(() => {})
      }

      // Load brand-category map
      const sid2 = String(user.shop_id)
      const lBrandCats = await db.brand_categories?.toArray ? await db.brand_categories.toArray().catch(() => []) : []
      const myBrandCats = lBrandCats.filter(x => String(x.shop_id) === sid2)
      const bcMap = {}
      myBrandCats.forEach(bc => {
        if (!bcMap[bc.brand_id]) bcMap[bc.brand_id] = []
        bcMap[bc.brand_id].push(bc.category_id)
      })
      setBrandCategoryMap(bcMap)

    } catch (e) {
      console.log('EditProduct: Fetching from local DB (Offline / Fallback)', e)
      try {
        const numId = parseInt(id, 10)
        let localProd = (await db.products.get(id)) || (!isNaN(numId) ? await db.products.get(numId) : null)

        if (!localProd && db.phones) {
          const localPhone = (await db.phones.get(id)) || (!isNaN(numId) ? await db.phones.get(numId) : null)
          if (localPhone) {
            setIsPhoneItem(true)
            localProd = {
              name: `${localPhone.brand || ''} ${localPhone.model || ''} ${localPhone.storage || ''} ${localPhone.color || ''}`.trim() || 'Mobile Phone',
              sku: localPhone.imei_1 || '',
              brand: localPhone.brand || '',
              category_id: '',
              supplier_id: localPhone.supplier_id || '',
              unit_id: '',
              c_rate: 0,
              cost_price: localPhone.cost_price || 0,
              sale_price: localPhone.sale_price || localPhone.selling_price || 0,
              stock_quantity: localPhone.status === 'in_stock' ? 1 : 0,
              low_stock_threshold: '1',
              status: localPhone.status === 'in_stock' ? 'active' : localPhone.status
            }
          }
        }

        if (localProd) {
          setForm({
            name: localProd.name || '',
            sku: localProd.sku || '',
            brand: localProd.brand || '',
            category_id: localProd.category_id || '',
            supplier_id: localProd.supplier_id || '',
            unit_id: localProd.unit_id || '',
            c_rate: localProd.c_rate || '',
            cost_price: localProd.cost_price || '',
            sale_price: localProd.sale_price || '',
            stock_quantity: localProd.stock_quantity || '',
            low_stock_threshold: localProd.low_stock_threshold || '10',
            status: localProd.status || 'active'
          })
        } else {
          setNotFound(true)
        }

        const offlineSid = String(user.shop_id)
        const lUnits = await db.units?.toArray ? await db.units.toArray().catch(() => []) : []
        setUnits(lUnits.filter(x => String(x.shop_id) === offlineSid))

        const [lCats, lSups, lBrands] = await Promise.all([
          db.categories.toArray().catch(() => []),
          db.suppliers.toArray().catch(() => []),
          db.brands.toArray().catch(() => [])
        ])
        setCategories(lCats.filter(x => String(x.shop_id) === offlineSid))
        setSuppliers(lSups.filter(x => String(x.shop_id) === offlineSid))
        setBrands(lBrands.filter(x => String(x.shop_id) === offlineSid))
      } catch (err) {
        console.error('Local DB EditProduct Error:', err)
        setNotFound(true)
      }
    } finally {
      setFetching(false)
    }
  }

  const handleAddBrand = async () => {
    if (!newBrandName.trim()) return

    const brandData = { id: crypto.randomUUID(), name: newBrandName.trim(), shop_id: user.shop_id }

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')

      // Strip the local UUID id — brands.id is SERIAL (integer) in Supabase
      const { id: _localId, ...supabasePayload } = brandData
      const { data, error } = await supabase.from('brands').insert([supabasePayload]).select()
      if (error) throw error

      setBrands([...brands, data[0]])
      setForm({ ...form, brand: data[0].name })
    } catch (err) {
      const errMsg = err?.message || String(err)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        await db.brands.add(brandData)
        await addToSyncQueue('brands', 'INSERT', brandData)
        setBrands([...brands, brandData])
        setForm({ ...form, brand: brandData.name })
        notify('Offline mode: Brand added locally. Will sync when online! 🔄')
      } else {
        notify('Error adding brand: ' + errMsg)
      }
    }

    setNewBrandName('')
    setShowNewBrandInput(false)
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    if (name === 'brand') {
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
    setLoading(true)

    // Sanitize foreign keys and numeric fields
    const toIntOrNull = (v) => { const n = parseInt(v, 10); return (!isNaN(n) && n > 0) ? n : null }
    const toNumOrZero = (v, def = 0) => {
      if (v === null || v === undefined || v === '') return def
      const n = parseFloat(v)
      return isNaN(n) ? def : n
    }

    if (isPhoneItem) {
      const phoneUpdates = {
        sale_price: toNumOrZero(form.sale_price, 0),
        selling_price: toNumOrZero(form.sale_price, 0),
        expected_sale_price: toNumOrZero(form.sale_price, 0),
        cost_price: toNumOrZero(form.cost_price, 0),
        updated_at: new Date().toISOString()
      }
      try {
        if (db.phones) {
          await db.phones.update(id, phoneUpdates).catch(async () => {
            const numId = parseInt(id, 10)
            if (!isNaN(numId)) await db.phones.update(numId, phoneUpdates).catch(() => {})
          })
        }
        if (navigator.onLine) {
          const numId = parseInt(id, 10)
          const queryId = !isNaN(numId) ? numId : id
          const { error } = await supabase.from('phones').update(phoneUpdates).eq('id', queryId)
          if (error) throw error
        } else {
          await addToSyncQueue('phones', 'UPDATE', { id, ...phoneUpdates })
        }
        notify('Phone price and details updated successfully!')
        navigate('/products')
        return
      } catch (err) {
        notify('Error updating phone: ' + (err.message || String(err)))
        return
      } finally {
        setLoading(false)
      }
    }

    const updatedProductData = {
      ...form,
      category_id: toIntOrNull(form.category_id),
      supplier_id: toIntOrNull(form.supplier_id),
      unit_id: toIntOrNull(form.unit_id),
      cost_price: toNumOrZero(form.cost_price, 0),
      sale_price: toNumOrZero(form.sale_price, 0),
      stock_quantity: toNumOrZero(form.stock_quantity, 0),
      c_rate: toNumOrZero(form.c_rate, 0),
      low_stock_threshold: toNumOrZero(form.low_stock_threshold, 10)
    }

    // Always update local IndexedDB immediately
    await db.products.update(id, updatedProductData)

    const isLocalUuid = typeof id === 'string' && id.includes('-')

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')

      if (isLocalUuid) {
        // If this product was created offline with a UUID id, queue sync to reconcile and insert to cloud
        await addToSyncQueue('products', 'INSERT', { id, ...updatedProductData, shop_id: user.shop_id })
      } else {
        let { error } = await supabase.from('products').update(updatedProductData).eq('id', id)
        if (error && (error.code === '23503' || error.message?.includes('foreign key') || error.message?.includes('fkey'))) {
          // If FK failed, retry update with null FKs
          const retryPayload = { ...updatedProductData, category_id: null, supplier_id: null, unit_id: null }
          const retry = await supabase.from('products').update(retryPayload).eq('id', id)
          error = retry.error
        }
        if (error) throw error
      }

      notify('Product updated successfully!')
      navigate('/products')
    } catch (error) {
      const errMsg = error?.message || String(error)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine || error.name === 'TypeError') {
        // Offline: Queue Sync
        await addToSyncQueue('products', isLocalUuid ? 'INSERT' : 'UPDATE', { id, ...updatedProductData, shop_id: user.shop_id })
        notify('Offline mode: Product updated locally! It will sync automatically when you are back online. 🔄')
        navigate('/products')
      } else {
        notify('Error: ' + error.message)
      }
    } finally {
      setLoading(false)
    }
  }

  if (fetching) {
    return <div className="text-gray-500 p-6">Loading product data...</div>
  }

  if (notFound) {
    return (
      <div className="p-8 max-w-md mx-auto text-center mt-12 bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
        <div className="w-14 h-14 bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 rounded-2xl flex items-center justify-center mx-auto mb-3 text-2xl font-black">
          ⚠️
        </div>
        <h2 className="text-lg font-black text-gray-900 dark:text-gray-100">Item Not Found</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-5">
          The requested record ID ({id}) could not be located in your catalog or inventory.
        </p>
        <button
          onClick={() => navigate('/products')}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs transition cursor-pointer"
        >
          ← Return to Products Catalog
        </button>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">✏️ Edit Product</h1>

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
                  <option value="">Select brand</option>
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
              <label className="block text-gray-700 font-medium mb-1">Category</label>
              <select
                name="category_id"
                value={form.category_id}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select category</option>
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
              {loading ? 'Saving Update...' : 'Update Product'}
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
    </div>
  )
}

export default EditProduct
