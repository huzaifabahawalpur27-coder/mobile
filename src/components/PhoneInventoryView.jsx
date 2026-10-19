import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../services/supabase'
import { db } from '../services/db'
import { useAuth } from '../context/AuthContext'
import {
  Smartphone, Search, Copy, Check, Filter, History,
  ShieldCheck, AlertTriangle, X, ChevronDown, ChevronUp,
  Layers, HardDrive, Sparkles, Tag, Eye, EyeOff,
  Printer, FileText
} from 'lucide-react'
import PhoneStockPrintModal from './PhoneStockPrintModal'

// Normalize PTA statuses from various formats to standard keys
export const normalizePtaStatus = (status) => {
  const s = String(status || '').toLowerCase().trim()
  if (['approved', 'pta approved', 'pta_approved'].includes(s)) return 'approved'
  if (['non_pta', 'non-pta', 'non pta'].includes(s)) return 'non_pta'
  if (['cpid', 'patch'].includes(s)) return 'cpid'
  if (['vip', 'gevey'].includes(s)) return 'vip'
  if (['blocked'].includes(s)) return 'blocked'
  return s || 'approved'
}

export const getPtaBadge = (status) => {
  const norm = normalizePtaStatus(status)
  if (norm === 'approved') {
    return {
      label: 'PTA Approved',
      color: 'bg-emerald-50 text-emerald-700 border-emerald-200'
    }
  }
  if (norm === 'non_pta') {
    return {
      label: 'Non-PTA',
      color: 'bg-rose-50 text-rose-700 border-rose-200'
    }
  }
  if (norm === 'cpid') {
    return {
      label: 'CPID / Patch',
      color: 'bg-amber-50 text-amber-700 border-amber-200'
    }
  }
  if (norm === 'vip') {
    return {
      label: 'VIP / Gevey',
      color: 'bg-purple-50 text-purple-700 border-purple-200'
    }
  }
  return {
    label: status || 'Unknown',
    color: 'bg-gray-50 text-gray-700 border-gray-200'
  }
}

export default function PhoneInventoryView() {
  const { user } = useAuth()
  const [phones, setPhones] = useState([])
  const [loading, setLoading] = useState(true)

  // View Mode: 'model_summary' (Model & Quantity Breakdown) vs 'device_list' (IMEI level table)
  const [viewMode, setViewMode] = useState('model_summary')

  // Filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('in_stock')
  const [ptaFilter, setPtaFilter] = useState('all')
  const [storageFilter, setStorageFilter] = useState('all')
  const [brandFilter, setBrandFilter] = useState('all')
  const [conditionFilter, setConditionFilter] = useState('all')

  // Expanded Model Cards for Accordion IMEI view
  const [expandedModelKey, setExpandedModelKey] = useState(null)

  // History Modal
  const [selectedPhoneForHistory, setSelectedPhoneForHistory] = useState(null)
  const [historyLogs, setHistoryLogs] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Custody & Issues Modal
  const [selectedPhoneForCustody, setSelectedPhoneForCustody] = useState(null)
  const [savingCustody, setSavingCustody] = useState(false)
  const [custodyForm, setCustodyForm] = useState({
    issue_type: 'temporary_issue',
    recipient_name: '',
    recipient_phone: '',
    expected_return_date: '',
    deposit_amount: '',
    notes: ''
  })

  // Copy Feedback state
  const [copiedImei, setCopiedImei] = useState(null)

  // Print & PDF Stock Report Modal
  const [showPrintModal, setShowPrintModal] = useState(false)

  // Role check: Only owner, admin, manager can view purchase cost & margins
  const canViewCost = ['owner', 'admin', 'manager', 'superadmin'].includes(user?.role)

  useEffect(() => {
    if (user?.shop_id) {
      fetchPhones()
    }
  }, [user?.shop_id])

  const fetchPhones = async () => {
    setLoading(true)

    // 1. Instant local read from Dexie if available
    try {
      const localPhones = await db.phones?.toArray ? await db.phones.toArray() : []
      const myPhones = localPhones.filter(p => String(p.shop_id) === String(user.shop_id))
      if (myPhones.length > 0) {
        setPhones(myPhones)
        setLoading(false)
      }
    } catch (_) {}

    // 2. Refresh from Supabase (avoid broken relationships)
    if (navigator.onLine) {
      try {
        const { data, error } = await supabase
          .from('phones')
          .select('*')
          .eq('shop_id', user.shop_id)
          .order('created_at', { ascending: false })

        if (!error && data) {
          // Fetch suppliers in parallel to enrich without SQL join dependency
          try {
            const { data: supData } = await supabase
              .from('suppliers')
              .select('id, name')
              .eq('shop_id', user.shop_id)

            const supMap = (supData || []).reduce((acc, s) => { acc[s.id] = s.name; return acc }, {})
            const enriched = data.map(p => ({
              ...p,
              supplier_name: p.supplier_id ? supMap[p.supplier_id] || '' : ''
            }))
            setPhones(enriched)
            if (db.phones?.bulkPut) {
              await db.phones.bulkPut(enriched)
            }
          } catch (_) {
            setPhones(data)
            if (db.phones?.bulkPut) {
              await db.phones.bulkPut(data)
            }
          }
        }
      } catch (err) {
        console.warn('Phone fetch error:', err)
      }
    }
    setLoading(false)
  }

  const handleCopyImei = (imei) => {
    if (!imei) return
    navigator.clipboard.writeText(imei)
    setCopiedImei(imei)
    setTimeout(() => setCopiedImei(null), 1800)
  }

  const handleViewHistory = async (phone) => {
    setSelectedPhoneForHistory(phone)
    setLoadingHistory(true)
    setHistoryLogs([])
    try {
      const { data, error } = await supabase
        .from('phone_history')
        .select('*')
        .eq('phone_id', phone.id)
        .order('created_at', { ascending: true })

      if (!error && data) {
        setHistoryLogs(data)
      }
    } catch (err) {
      console.error('History fetch error:', err)
    } finally {
      setLoadingHistory(false)
    }
  }

  const openCustodyModal = (phone) => {
    setSelectedPhoneForCustody(phone)
    setCustodyForm({
      issue_type: 'temporary_issue',
      recipient_name: '',
      recipient_phone: '',
      expected_return_date: '',
      deposit_amount: '',
      notes: ''
    })
  }

  const handleIssueCustody = async (e) => {
    e.preventDefault()
    if (!custodyForm.recipient_name.trim()) {
      alert('Recipient / Dealer ka naam darj karein!')
      return
    }
    setSavingCustody(true)
    try {
      if (navigator.onLine) {
        const mappedIssueType = 
          custodyForm.issue_type === 'customer_reservation' || custodyForm.issue_type === 'reservation'
            ? 'reservation'
            : custodyForm.issue_type === 'personal_use' || custodyForm.issue_type === 'personal'
              ? 'personal_use'
              : custodyForm.issue_type === 'repair'
                ? 'repair'
                : 'temporary_issue'
        const depositVal = parseFloat(custodyForm.deposit_amount) || 0

        let res, rpcErr
        const primaryRes = await supabase.rpc('issue_phone_custody', {
          p_phone_id: selectedPhoneForCustody.id,
          p_issue_type: mappedIssueType,
          p_recipient_name: custodyForm.recipient_name.trim(),
          p_recipient_phone: custodyForm.recipient_phone.trim() || null,
          p_expected_return_date: custodyForm.expected_return_date || null,
          p_deposit_amount: depositVal,
          p_notes: custodyForm.notes.trim() || null
        })

        if (primaryRes.error) {
          console.warn('Primary RPC error, attempting direct update fallback...', primaryRes.error.message)
          const { error: insertErr } = await supabase.from('phone_custody').insert({
            shop_id: user.shop_id,
            branch_id: user.branch_id || null,
            phone_id: selectedPhoneForCustody.id,
            status: 'active',
            issue_type: mappedIssueType,
            recipient_name: custodyForm.recipient_name.trim(),
            recipient_phone: custodyForm.recipient_phone.trim() || null,
            deposit_amount: depositVal,
            token_deposit: depositVal,
            expected_return_date: custodyForm.expected_return_date || null,
            notes: custodyForm.notes.trim() || null
          })

          if (insertErr) throw insertErr

          const { error: pErr } = await supabase.from('phones').update({
            status: 'reserved',
            updated_at: new Date().toISOString()
          }).eq('id', selectedPhoneForCustody.id)

          if (pErr) throw pErr
        }

        const newStatus = 'reserved'
        setPhones(prev => prev.map(p => p.id === selectedPhoneForCustody.id ? { ...p, status: newStatus } : p))
        if (db.phones) await db.phones.update(selectedPhoneForCustody.id, { status: newStatus }).catch(() => {})
      } else {
        const newStatus = 'reserved'
        setPhones(prev => prev.map(p => p.id === selectedPhoneForCustody.id ? { ...p, status: newStatus } : p))
        if (db.phones) await db.phones.update(selectedPhoneForCustody.id, { status: newStatus })
      }
      setSelectedPhoneForCustody(null)
    } catch (err) {
      alert('Custody issue failed: ' + (err.message || String(err)))
    } finally {
      setSavingCustody(false)
    }
  }

  const handleReturnCustody = async (phone) => {
    const confirmReturn = window.confirm(`Kya aap "${phone.brand} ${phone.model}" ko wapas In-Stock karna chahte hain?`)
    if (!confirmReturn) return

    try {
      if (navigator.onLine) {
        const { data: custRecord } = await supabase
          .from('phone_custody')
          .select('id')
          .eq('phone_id', phone.id)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (custRecord?.id) {
          let rpcRes, rpcErr
          const primaryReturn = await supabase.rpc('return_phone_custody', {
            p_custody_id: custRecord.id,
            p_return_notes: 'Returned from Phone Inventory'
          })

          if (primaryReturn.error && (primaryReturn.error.code === 'PGRST202' || primaryReturn.error.message?.includes('schema cache'))) {
            console.warn('Falling back to alternate return_phone_custody signature...', primaryReturn.error.message)
            const fallbackReturn = await supabase.rpc('return_phone_custody', {
              p_phone_id: phone.id,
              p_notes: 'Returned from Phone Inventory'
            })
            rpcRes = fallbackReturn.data
            rpcErr = fallbackReturn.error
          } else {
            rpcRes = primaryReturn.data
            rpcErr = primaryReturn.error
          }

          if (rpcErr) throw rpcErr
          if (rpcRes && !rpcRes.success) throw new Error(rpcRes.error)
        } else {
          await supabase.from('phones').update({ status: 'in_stock', updated_at: new Date().toISOString() }).eq('id', phone.id)
        }
      }
      setPhones(prev => prev.map(p => p.id === phone.id ? { ...p, status: 'in_stock' } : p))
      if (db.phones) await db.phones.update(phone.id, { status: 'in_stock' }).catch(() => {})
    } catch (err) {
      alert('Return failed: ' + err.message)
    }
  }

  // Extract unique brands and storages from current inventory
  const availableBrands = useMemo(() => {
    const set = new Set(phones.map(p => p.brand).filter(Boolean))
    return Array.from(set).sort()
  }, [phones])

  const availableStorages = useMemo(() => {
    const set = new Set(phones.map(p => (p.storage || '').trim()).filter(Boolean))
    const standardOrder = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB']
    return Array.from(set).sort((a, b) => {
      const idxA = standardOrder.indexOf(a)
      const idxB = standardOrder.indexOf(b)
      if (idxA !== -1 && idxB !== -1) return idxA - idxB
      return a.localeCompare(b)
    })
  }, [phones])

  // Filtered dataset for IMEI devices
  const filtered = useMemo(() => {
    return phones.filter(p => {
      const q = search.trim().toLowerCase()
      let matchQuery = true
      if (q) {
        const imei1 = (p.imei_1 || '').toLowerCase()
        const imei2 = (p.imei_2 || '').toLowerCase()
        const brand = (p.brand || '').toLowerCase()
        const model = (p.model || '').toLowerCase()
        const color = (p.color || '').toLowerCase()
        const storage = (p.storage || '').toLowerCase()
        matchQuery = imei1.includes(q) || imei2.includes(q) || brand.includes(q) ||
          model.includes(q) || color.includes(q) || storage.includes(q)
      }

      const matchStatus = statusFilter === 'all' || p.status === statusFilter
      const ptaNorm = normalizePtaStatus(p.pta_status)
      const matchPta = ptaFilter === 'all' || ptaNorm === ptaFilter

      const storageVal = (p.storage || '').trim().toLowerCase()
      const matchStorage = storageFilter === 'all' || storageVal === storageFilter.toLowerCase()

      const matchBrand = brandFilter === 'all' || p.brand === brandFilter

      const condNorm = (p.condition || '').toLowerCase()
      const matchCondition = conditionFilter === 'all' || condNorm === conditionFilter.toLowerCase()

      return matchQuery && matchStatus && matchPta && matchStorage && matchBrand && matchCondition
    })
  }, [phones, search, statusFilter, ptaFilter, storageFilter, brandFilter, conditionFilter])

  // Active filter label description for print header & export
  const activeFilterDesc = useMemo(() => {
    const parts = []
    if (statusFilter !== 'all') {
      const statusMap = { in_stock: 'In Stock', reserved: 'Reserved', issued: 'Issued', sold: 'Sold' }
      parts.push(`Status: ${statusMap[statusFilter] || statusFilter}`)
    }
    if (ptaFilter !== 'all') {
      const ptaMap = { approved: 'PTA Approved', non_pta: 'Non-PTA', cpid: 'CPID / Patch', vip: 'VIP / Gevey' }
      parts.push(`PTA: ${ptaMap[ptaFilter] || ptaFilter}`)
    }
    if (storageFilter !== 'all') parts.push(`Storage: ${storageFilter}`)
    if (brandFilter !== 'all') parts.push(`Brand: ${brandFilter}`)
    if (conditionFilter !== 'all') parts.push(`Condition: ${conditionFilter}`)
    if (search.trim()) parts.push(`Search: "${search.trim()}"`)
    return parts.length > 0 ? parts.join(' | ') : 'All Devices'
  }, [statusFilter, ptaFilter, storageFilter, brandFilter, conditionFilter, search])

  // Model-level stock summary aggregation
  const modelSummaries = useMemo(() => {
    const groups = {}

    filtered.forEach(p => {
      const brand = p.brand || 'Other'
      const model = p.model || 'Unknown'
      const key = `${brand} ${model}`

      if (!groups[key]) {
        groups[key] = {
          key,
          brand,
          model,
          total: 0,
          inStock: 0,
          sold: 0,
          reservedOrIssued: 0,
          ptaApproved: 0,
          nonPta: 0,
          cpid: 0,
          otherPta: 0,
          storages: {},
          conditions: {},
          colors: new Set(),
          minSalePrice: Infinity,
          maxSalePrice: -Infinity,
          minCostPrice: Infinity,
          maxCostPrice: -Infinity,
          totalCost: 0,
          totalSale: 0,
          phones: []
        }
      }

      const g = groups[key]
      g.total += 1
      if (p.status === 'in_stock') g.inStock += 1
      else if (p.status === 'sold') g.sold += 1
      else g.reservedOrIssued += 1

      // PTA breakdown for in-stock units
      const ptaNorm = normalizePtaStatus(p.pta_status)
      if (ptaNorm === 'approved') g.ptaApproved += 1
      else if (ptaNorm === 'non_pta') g.nonPta += 1
      else if (ptaNorm === 'cpid') g.cpid += 1
      else g.otherPta += 1

      // Storage breakdown
      const st = (p.storage || 'Standard').trim().toUpperCase()
      g.storages[st] = (g.storages[st] || 0) + 1

      // Condition breakdown
      const cond = (p.condition || 'used').toLowerCase()
      g.conditions[cond] = (g.conditions[cond] || 0) + 1

      if (p.color) g.colors.add(p.color)

      const sPrice = parseFloat(p.sale_price) || 0
      const cPrice = parseFloat(p.cost_price) || 0
      if (sPrice > 0) {
        if (sPrice < g.minSalePrice) g.minSalePrice = sPrice
        if (sPrice > g.maxSalePrice) g.maxSalePrice = sPrice
      }
      if (cPrice > 0) {
        if (cPrice < g.minCostPrice) g.minCostPrice = cPrice
        if (cPrice > g.maxCostPrice) g.maxCostPrice = cPrice
      }
      g.totalSale += sPrice
      g.totalCost += cPrice
      g.phones.push(p)
    })

    return Object.values(groups).sort((a, b) => b.inStock - a.inStock || a.model.localeCompare(b.model))
  }, [filtered])

  // KPIs
  const inStockCount = phones.filter(p => p.status === 'in_stock').length
  const ptaApprovedInStock = phones.filter(p => p.status === 'in_stock' && normalizePtaStatus(p.pta_status) === 'approved').length
  const nonPtaInStock = phones.filter(p => p.status === 'in_stock' && normalizePtaStatus(p.pta_status) === 'non_pta').length
  const uniqueModelsCount = new Set(phones.filter(p => p.status === 'in_stock').map(p => `${p.brand} ${p.model}`)).size
  const inStockCostTotal = phones
    .filter(p => p.status === 'in_stock')
    .reduce((sum, p) => sum + (parseFloat(p.cost_price) || 0) + (parseFloat(p.additional_costs) || 0), 0)

  return (
    <div className="space-y-5">
      {/* KPI Cards Header */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white p-3.5 rounded-2xl border border-gray-100 shadow-sm">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">In Stock Phones</p>
          <p className="text-2xl font-black text-blue-600 mt-1">
            {inStockCount} <span className="text-xs font-normal text-gray-400">units</span>
          </p>
          <span className="text-[10px] text-gray-400 font-semibold">{uniqueModelsCount} Models</span>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-emerald-100/60 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider">PTA Approved</p>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <p className="text-2xl font-black text-emerald-700 mt-1">
            {ptaApprovedInStock} <span className="text-xs font-normal text-gray-400">units</span>
          </p>
          <span className="text-[10px] text-emerald-600 font-semibold">Official PTA Approved</span>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-rose-100/60 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-rose-600 uppercase tracking-wider">Non-PTA</p>
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
          </div>
          <p className="text-2xl font-black text-rose-600 mt-1">
            {nonPtaInStock} <span className="text-xs font-normal text-gray-400">units</span>
          </p>
          <span className="text-[10px] text-rose-500 font-semibold">Non-PTA Devices</span>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-gray-100 shadow-sm">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Reserved / Issued</p>
          <p className="text-2xl font-black text-amber-600 mt-1">
            {phones.filter(p => ['reserved', 'issued', 'personal'].includes(p.status)).length} <span className="text-xs font-normal text-gray-400">units</span>
          </p>
          <span className="text-[10px] text-amber-600 font-semibold">Reserved / Custody</span>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-gray-100 shadow-sm col-span-2 sm:col-span-1">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">In-Stock Valuation</p>
          <p className="text-xl font-black text-purple-700 mt-1 truncate">
            {canViewCost ? `Rs. ${inStockCostTotal.toLocaleString()}` : '••••••••'}
          </p>
          <span className="text-[10px] text-gray-400 font-semibold">Total Cost Valuation</span>
        </div>
      </div>

      {/* Primary View Switcher: Model Quantity Summary vs All IMEI Devices */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-2.5 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center gap-1.5 bg-gray-100/80 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setViewMode('model_summary')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer ${
              viewMode === 'model_summary'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Model Breakdown Summary</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              viewMode === 'model_summary' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'
            }`}>
              {modelSummaries.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('device_list')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer ${
              viewMode === 'device_list'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            <span>All Serialized IMEIs</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              viewMode === 'device_list' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'
            }`}>
              {filtered.length}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={() => setShowPrintModal(true)}
            className="px-3.5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-sm shadow-blue-500/20 cursor-pointer"
            title="Print Mobile Stock or Export PDF"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Stock / PDF</span>
          </button>

          <div className="text-xs text-gray-500 px-2 font-medium hidden sm:flex items-center gap-2">
            <span>Available:</span>
            <span className="font-bold text-gray-900 bg-gray-100 px-2 py-0.5 rounded-md">
              {filtered.length} units
            </span>
          </div>
        </div>
      </div>

      {/* Advanced Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Search Model (e.g. iPhone 14), Brand, Storage (128GB), IMEI 1, Color..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none placeholder:text-gray-400 font-medium"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Status Pills */}
          <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-100 overflow-x-auto max-w-full">
            {[
              { id: 'in_stock', label: 'In Stock' },
              { id: 'all', label: 'All Statuses' },
              { id: 'reserved', label: 'Reserved' },
              { id: 'issued', label: 'Issued' },
              { id: 'sold', label: 'Sold' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg font-bold transition whitespace-nowrap cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* PTA Filter (Specific user requirement) */}
          <select
            value={ptaFilter}
            onChange={e => setPtaFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-xl bg-white font-bold text-gray-700 outline-none hover:border-gray-300 transition"
          >
            <option value="all">🔍 PTA: All Statuses</option>
            <option value="approved">🟢 PTA Approved</option>
            <option value="non_pta">🔴 Non-PTA</option>
            <option value="cpid">🟡 CPID / Patch</option>
            <option value="vip">🟣 VIP / Gevey</option>
          </select>

          {/* Storage Filter (Specific user requirement) */}
          <select
            value={storageFilter}
            onChange={e => setStorageFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-xl bg-white font-bold text-gray-700 outline-none hover:border-gray-300 transition"
          >
            <option value="all">💾 Storage: All</option>
            {availableStorages.map(st => (
              <option key={st} value={st}>{st}</option>
            ))}
            {!availableStorages.includes('128GB') && <option value="128GB">128GB</option>}
            {!availableStorages.includes('256GB') && <option value="256GB">256GB</option>}
            {!availableStorages.includes('512GB') && <option value="512GB">512GB</option>}
          </select>

          {/* Brand Filter */}
          <select
            value={brandFilter}
            onChange={e => setBrandFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-xl bg-white font-bold text-gray-700 outline-none hover:border-gray-300 transition"
          >
            <option value="all">🏷️ Brand: All</option>
            {availableBrands.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>

          {/* Condition Filter */}
          <select
            value={conditionFilter}
            onChange={e => setConditionFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-xl bg-white font-bold text-gray-700 outline-none hover:border-gray-300 transition"
          >
            <option value="all">✨ Condition: All</option>
            <option value="brand_new">Brand New</option>
            <option value="used">Used</option>
            <option value="open_box">Open Box</option>
            <option value="refurbished">Refurbished</option>
          </select>

          {(search || ptaFilter !== 'all' || storageFilter !== 'all' || brandFilter !== 'all' || conditionFilter !== 'all' || statusFilter !== 'in_stock') && (
            <button
              onClick={() => {
                setSearch('')
                setPtaFilter('all')
                setStorageFilter('all')
                setBrandFilter('all')
                setConditionFilter('all')
                setStatusFilter('in_stock')
              }}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition cursor-pointer text-xs"
            >
              Reset Filters
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowPrintModal(true)}
            className="sm:ml-auto px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold rounded-xl transition cursor-pointer text-xs flex items-center gap-1.5 shadow-xs"
            title="Print or export current filtered mobile phones"
          >
            <FileText className="w-3.5 h-3.5 text-blue-600" />
            <span>Print Report ({filtered.length})</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="p-16 text-center text-gray-400 bg-white rounded-2xl border border-gray-100">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="font-bold text-gray-600">Loading Mobile Phone Inventory...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-16 text-center text-gray-400 bg-white rounded-2xl border border-gray-100">
          <Smartphone className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="font-bold text-gray-700 text-base">No Mobile Phones Found</p>
          <p className="text-xs text-gray-400 mt-1">No phones match your active search or filter criteria.</p>
        </div>
      ) : viewMode === 'model_summary' ? (
        /* =========================================================================
           VIEW 1: MODEL QUANTITY BREAKDOWN (Specific User Request)
           ========================================================================= */
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {modelSummaries.map(group => {
              const isExpanded = expandedModelKey === group.key
              const priceDisplay = group.minSalePrice !== Infinity
                ? group.minSalePrice === group.maxSalePrice
                  ? `Rs. ${group.minSalePrice.toLocaleString()}`
                  : `Rs. ${group.minSalePrice.toLocaleString()} - ${group.maxSalePrice.toLocaleString()}`
                : 'Price not set'

              return (
                <div
                  key={group.key}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden flex flex-col justify-between"
                >
                  {/* Card Header */}
                  <div className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                          <Smartphone className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-50/80 px-2 py-0.5 rounded-md">
                            {group.brand}
                          </span>
                          <h3 className="font-black text-gray-900 text-base leading-tight mt-0.5">
                            {group.model}
                          </h3>
                        </div>
                      </div>

                      {/* Prominent Quantity Badge */}
                      <div className="text-right shrink-0">
                        <div className="bg-blue-600 text-white px-3 py-1 rounded-xl text-center shadow-sm shadow-blue-500/20">
                          <p className="text-lg font-black leading-none">{group.inStock}</p>
                          <p className="text-[9px] uppercase tracking-wider font-bold">In Stock</p>
                        </div>
                        <p className="text-[10px] text-gray-400 font-semibold mt-0.5 text-center">
                          {group.inStock} Units In Stock
                        </p>
                      </div>
                    </div>

                    {/* PTA Breakdown Badges */}
                    <div className="pt-2 border-t border-gray-50">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-gray-400" /> PTA Status Breakdown
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {group.ptaApproved > 0 && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            {group.ptaApproved} PTA Approved
                          </span>
                        )}
                        {group.nonPta > 0 && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            <span className="w-2 h-2 rounded-full bg-rose-500" />
                            {group.nonPta} Non-PTA
                          </span>
                        )}
                        {group.cpid > 0 && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            <span className="w-2 h-2 rounded-full bg-amber-500" />
                            {group.cpid} CPID
                          </span>
                        )}
                        {group.otherPta > 0 && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-gray-50 text-gray-700 border border-gray-200">
                            {group.otherPta} Other
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Storage Breakdown Chips */}
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <HardDrive className="w-3 h-3 text-gray-400" /> Storage Breakdown
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(group.storages).map(([st, count]) => (
                          <span
                            key={st}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold bg-gray-100 text-gray-800 border border-gray-200"
                          >
                            <span>{st}:</span>
                            <span className="text-blue-600">{count} units</span>
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Conditions and Colors summary */}
                    <div className="flex items-center justify-between text-[11px] text-gray-500 pt-1">
                      <div className="flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-amber-500" />
                        <span>
                          {group.conditions['brand_new'] ? `${group.conditions['brand_new']} New` : ''}
                          {group.conditions['brand_new'] && group.conditions['used'] ? ' · ' : ''}
                          {group.conditions['used'] ? `${group.conditions['used']} Used` : ''}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-emerald-700 text-xs">
                          {priceDisplay}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card Action: Toggle Devices List */}
                  <div className="bg-gray-50/80 px-4 py-2.5 border-t border-gray-100 flex items-center justify-between">
                    {canViewCost && (
                      <span className="text-[10px] text-gray-500 font-medium">
                        Cost Value: <strong className="text-gray-800">Rs. {group.totalCost.toLocaleString()}</strong>
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedModelKey(isExpanded ? null : group.key)}
                      className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
                    >
                      <span>{isExpanded ? 'Hide IMEIs' : `Show ${group.phones.length} Serialized IMEIs`}</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {/* Accordion IMEI Device Breakdown */}
                  {isExpanded && (
                    <div className="p-3 bg-slate-50 border-t border-gray-100 space-y-2">
                      <p className="text-[11px] font-bold text-gray-700 px-1">
                        Available Serialized Devices ({group.model}):
                      </p>
                      <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                        {group.phones.map(phone => {
                          const badge = getPtaBadge(phone.pta_status)
                          return (
                            <div
                              key={phone.id}
                              className="bg-white p-2.5 rounded-xl border border-gray-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-2xs"
                            >
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-gray-900">{phone.imei_1}</span>
                                  <button
                                    onClick={() => handleCopyImei(phone.imei_1)}
                                    className="text-gray-400 hover:text-blue-600 cursor-pointer"
                                    title="Copy IMEI"
                                  >
                                    {copiedImei === phone.imei_1 ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                                  </button>
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${badge.color}`}>
                                    {badge.label}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-700">
                                    {phone.storage}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-[10px] text-gray-500 font-medium">
                                  {phone.color && <span>Color: {phone.color}</span>}
                                  {phone.battery_health && <span>· Battery: {phone.battery_health}%</span>}
                                  <span>· Condition: {phone.condition}</span>
                                </div>
                              </div>

                              <div className="flex items-center justify-between sm:justify-end gap-2 pt-1 sm:pt-0 border-t sm:border-t-0 border-gray-100">
                                <div className="text-right">
                                  <p className="font-bold text-emerald-700">Rs. {(parseFloat(phone.sale_price) || 0).toLocaleString()}</p>
                                  {canViewCost && (
                                    <p className="text-[10px] text-gray-400">Cost: Rs. {(parseFloat(phone.cost_price) || 0).toLocaleString()}</p>
                                  )}
                                </div>
                                {phone.status === 'in_stock' && (
                                  <button
                                    onClick={() => openCustodyModal(phone)}
                                    className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-[10px] font-bold cursor-pointer"
                                  >
                                    Issue
                                  </button>
                                )}
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
        </div>
      ) : (
        /* =========================================================================
           VIEW 2: DETAILED IMEI DEVICE LIST (Full Table + Mobile Cards)
           ========================================================================= */
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Desktop Table View (>= 768px) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 font-bold uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Phone Model</th>
                  <th className="py-3 px-4">IMEI Details</th>
                  <th className="py-3 px-4">Storage & Color</th>
                  <th className="py-3 px-4">PTA & Condition</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Sale Price</th>
                  <th className="py-3 px-4">{canViewCost ? 'Cost Price' : 'Purchase Cost'}</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 text-gray-700">
                {filtered.map(p => {
                  const ptaBadge = getPtaBadge(p.pta_status)
                  return (
                    <tr key={p.id} className="hover:bg-gray-50/70 transition">
                      <td className="py-3 px-4 font-bold text-gray-900">
                        <div className="flex items-center gap-2">
                          <Smartphone className="w-4 h-4 text-blue-600 shrink-0" />
                          <div>
                            <p className="font-bold text-gray-900">{p.brand} {p.model}</p>
                            <p className="text-[10px] text-gray-400 font-normal">
                              {p.battery_health ? `Battery: ${p.battery_health}%` : ''}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-gray-800">{p.imei_1}</span>
                          <button
                            onClick={() => handleCopyImei(p.imei_1)}
                            className="text-gray-400 hover:text-blue-600 cursor-pointer"
                            title="Copy IMEI 1"
                          >
                            {copiedImei === p.imei_1 ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        {p.imei_2 && (
                          <div className="flex items-center gap-1.5 text-gray-400 text-[10px]">
                            <span>IMEI 2: {p.imei_2}</span>
                            <button
                              onClick={() => handleCopyImei(p.imei_2)}
                              className="hover:text-blue-600 cursor-pointer"
                              title="Copy IMEI 2"
                            >
                              {copiedImei === p.imei_2 ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <div className="space-y-0.5">
                          <span className="font-bold text-gray-900 font-mono text-xs">{p.storage || '-'}</span>
                          {p.color && <p className="text-[11px] text-gray-500">{p.color}</p>}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border w-fit ${ptaBadge.color}`}>
                            {ptaBadge.label}
                          </span>
                          <span className="text-[10px] text-gray-500 font-medium capitalize">{p.condition?.replace('_', ' ')}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          p.status === 'in_stock'
                            ? 'bg-blue-50 text-blue-700'
                            : p.status === 'sold'
                            ? 'bg-gray-100 text-gray-600'
                            : 'bg-amber-50 text-amber-700'
                        }`}>
                          {p.status.replace('_', ' ')}
                        </span>
                      </td>

                      <td className="py-3 px-4 font-bold text-emerald-700">
                        Rs. {(parseFloat(p.sale_price) || 0).toLocaleString()}
                      </td>

                      <td className="py-3 px-4">
                        {canViewCost ? (
                          <div>
                            <span className="font-semibold text-gray-800">
                              Rs. {(parseFloat(p.cost_price) || 0).toLocaleString()}
                            </span>
                            {p.additional_costs > 0 && (
                              <span className="text-[10px] text-gray-500 block">
                                + Rs. {p.additional_costs} (Direct)
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400 font-mono">••••••••</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {p.status === 'in_stock' && (
                            <button
                              onClick={() => openCustodyModal(p)}
                              className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap"
                              title="Assign custody, reserve for customer, or dealer issue"
                            >
                              Issue / Reserve
                            </button>
                          )}
                          {['issued', 'reserved', 'personal'].includes(p.status) && (
                            <button
                              onClick={() => handleReturnCustody(p)}
                              className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap"
                              title="Return phone to in-stock inventory"
                            >
                              Return Stock
                            </button>
                          )}
                          <button
                            onClick={() => handleViewHistory(p)}
                            className="px-2.5 py-1 bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <History className="w-3.5 h-3.5" /> History
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View (< 768px) */}
          <div className="block md:hidden divide-y divide-gray-100">
            {filtered.map(p => {
              const ptaBadge = getPtaBadge(p.pta_status)
              return (
                <div key={p.id} className="p-4 space-y-2.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-bold text-gray-900 text-sm">{p.brand} {p.model}</p>
                      <p className="text-xs text-gray-500">{p.storage} {p.color ? `• ${p.color}` : ''}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      p.status === 'in_stock' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {p.status.replace('_', ' ')}
                    </span>
                  </div>

                  <div className="bg-gray-50 p-2.5 rounded-xl text-xs font-mono flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase font-sans">IMEI 1</p>
                      <p className="font-bold text-gray-800">{p.imei_1}</p>
                    </div>
                    <button
                      onClick={() => handleCopyImei(p.imei_1)}
                      className="p-1.5 bg-white border border-gray-200 rounded-lg text-gray-600"
                    >
                      {copiedImei === p.imei_1 ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${ptaBadge.color}`}>
                        {ptaBadge.label}
                      </span>
                      <span className="text-[10px] text-gray-500 capitalize">{p.condition?.replace('_', ' ')}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-gray-400 uppercase block">Sale Price</span>
                      <span className="font-bold text-emerald-700">Rs. {(parseFloat(p.sale_price) || 0).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-2 border-t border-gray-50">
                    <div className="text-xs">
                      {canViewCost ? (
                        <span className="text-gray-500 font-medium">
                          Cost: Rs. {(parseFloat(p.cost_price) || 0).toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-gray-400 font-mono">Cost: ••••••••</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {p.status === 'in_stock' && (
                        <button
                          onClick={() => openCustodyModal(p)}
                          className="px-2 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-[11px] font-bold"
                        >
                          Issue / Reserve
                        </button>
                      )}
                      {['issued', 'reserved', 'personal'].includes(p.status) && (
                        <button
                          onClick={() => handleReturnCustody(p)}
                          className="px-2 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-[11px] font-bold"
                        >
                          Return Stock
                        </button>
                      )}
                      <button
                        onClick={() => handleViewHistory(p)}
                        className="px-2.5 py-1 text-xs text-blue-600 font-bold hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <History className="w-3 h-3" /> Audit
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* History & Audit Trail Modal */}
      {selectedPhoneForHistory && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="font-bold text-gray-900 text-base">
                  {selectedPhoneForHistory.brand} {selectedPhoneForHistory.model}
                </h3>
                <p className="font-mono text-xs text-gray-500">IMEI: {selectedPhoneForHistory.imei_1}</p>
              </div>
              <button
                onClick={() => setSelectedPhoneForHistory(null)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 pr-1 custom-scrollbar space-y-3">
              {loadingHistory ? (
                <div className="text-center py-8 text-gray-400 text-xs">Loading audit trail...</div>
              ) : historyLogs.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-xs">
                  No status transition logs found for this phone yet.
                </div>
              ) : (
                <div className="relative border-l-2 border-blue-200 ml-3 space-y-4 py-1">
                  {historyLogs.map(log => (
                    <div key={log.id} className="relative pl-5">
                      <div className="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-blue-600 ring-4 ring-white" />
                      <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100 text-xs space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-gray-900 uppercase tracking-wider text-[10px]">
                            {log.action}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {new Date(log.created_at).toLocaleString()}
                          </span>
                        </div>
                        {log.to_status && (
                          <p className="text-gray-600">
                            Status changed to: <span className="font-bold text-blue-700">{log.to_status}</span>
                          </p>
                        )}
                        {log.details && (
                          <pre className="text-[10px] bg-white p-1.5 rounded border border-gray-100 overflow-x-auto text-gray-600 font-mono">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-gray-100 pt-3 flex justify-end">
              <button
                onClick={() => setSelectedPhoneForHistory(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custody Assignment Modal */}
      {selectedPhoneForCustody && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="font-bold text-gray-900 text-base">
                  Assign Custody / Issue Phone
                </h3>
                <p className="font-mono text-xs text-gray-500">
                  {selectedPhoneForCustody.brand} {selectedPhoneForCustody.model} · {selectedPhoneForCustody.imei_1}
                </p>
              </div>
              <button
                onClick={() => setSelectedPhoneForCustody(null)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleIssueCustody} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Issue Purpose / Type</label>
                <select
                  value={custodyForm.issue_type}
                  onChange={e => setCustodyForm(prev => ({ ...prev, issue_type: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                >
                  <option value="temporary_issue">🤝 Market / Dealer Issue (Condition / Pouch)</option>
                  <option value="customer_reservation">🏷️ Customer Reservation (Hold / Token Deposit)</option>
                  <option value="personal_use">👤 Personal / Owner Use</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Recipient Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Asif Mobile Plaza, Tariq Bhai"
                  value={custodyForm.recipient_name}
                  onChange={e => setCustodyForm(prev => ({ ...prev, recipient_name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Recipient Phone</label>
                  <input
                    type="text"
                    placeholder="0300..."
                    value={custodyForm.recipient_phone}
                    onChange={e => setCustodyForm(prev => ({ ...prev, recipient_phone: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Expected Return</label>
                  <input
                    type="date"
                    value={custodyForm.expected_return_date}
                    onChange={e => setCustodyForm(prev => ({ ...prev, expected_return_date: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Deposit / Advance Token (Rs.)</label>
                <input
                  type="number"
                  placeholder="0"
                  value={custodyForm.deposit_amount}
                  onChange={e => setCustodyForm(prev => ({ ...prev, deposit_amount: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Notes / Terms</label>
                <textarea
                  rows="2"
                  placeholder="e.g. In good condition, expected back by evening"
                  value={custodyForm.notes}
                  onChange={e => setCustodyForm(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setSelectedPhoneForCustody(null)}
                  className="flex-1 py-2 rounded-xl text-xs font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCustody}
                  className="flex-1 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {savingCustody ? 'Saving...' : 'Confirm Issue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Phone Stock Print / PDF Modal */}
      <PhoneStockPrintModal
        isOpen={showPrintModal}
        onClose={() => setShowPrintModal(false)}
        phones={phones}
        filteredPhones={filtered}
        activeFilterDesc={activeFilterDesc}
        canViewCost={canViewCost}
        shopId={user?.shop_id}
      />
    </div>
  )
}
