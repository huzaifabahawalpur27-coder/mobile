import React, { useEffect, useState } from 'react'
import { hasFeature } from '../utils/featureGate'
import UpgradeWall from '../components/UpgradeWall'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db, addToSyncQueue, moveToTrash } from '../services/db'
import { recordAuditLog } from '../services/auditService'
import PasswordModal from '../components/PasswordModal'
import * as XLSX from 'xlsx'
import { printHTML } from '../utils/printUtils'
import { buildBillHTML } from '../utils/billTemplates'
import EditPurchasePaymentModal from '../components/EditPurchasePaymentModal'

const normalizePurchaseItem = (it, phonesPool = [], productsPool = []) => {
    const ph = it.phones || (phonesPool || []).find(p => p.id === it.phone_id || (it.purchase_id && p.purchase_id === it.purchase_id))
    const prod = it.products || (productsPool || []).find(p => p.id === it.product_id)

    let name = (it.product_name && it.product_name.trim()) || (prod ? prod.name : null)
    if (!name && ph) {
        const brand = ph.brand && ph.brand !== 'Unknown' ? ph.brand + ' ' : ''
        name = `${brand}${ph.model || 'Smartphone'}`.trim()
    }
    if (!name) name = 'Item'

    const specs = ph ? [ph.storage, ph.color, ph.pta_status ? ph.pta_status.toUpperCase() : null, ph.condition ? ph.condition.toUpperCase() : null].filter(Boolean).join(' • ') : null
    const imei = ph ? (ph.imei_1 || ph.imei || ph.imei1 || null) : null
    const imei2 = ph ? (ph.imei_2 || ph.imei2 || null) : null
    const price = it.unit_price ?? (it.cost_price ?? (it.price ?? 0))
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

function PurchaseHistory() {
    const { user } = useAuth()
    const [purchases, setPurchases] = useState([])
    const [loading, setLoading] = useState(true)
    const [selectedPurchase, setSelectedPurchase] = useState(null)
    const [purchaseItems, setPurchaseItems] = useState([])
    const [loadingItems, setLoadingItems] = useState(false)
    const [purchaseToEditPayment, setPurchaseToEditPayment] = useState(null)
    const [expandedPurchases, setExpandedPurchases] = useState(new Set())
    const [search, setSearch] = useState('')
    const [filterType, setFilterType] = useState('')
    const [paymentFilter, setPaymentFilter] = useState('all')
    const [dateFilter, setDateFilter] = useState('')
    const [selected, setSelected] = useState([])
    const [showPasswordModal, setShowPasswordModal] = useState(false)
    const [pendingDeleteIds, setPendingDeleteIds] = useState([])

    const [shopSettings, setShopSettings] = useState({})

    // Return feature state
    const [returnQtys, setReturnQtys] = useState({})
    const [returning, setReturning] = useState(false)

    useEffect(() => {
        if (user?.shop_id) {
            fetchPurchases()
            fetchShopSettings()
        }
    }, [user?.shop_id])

    const fetchShopSettings = async () => {
        // Load from shop-scoped localStorage first, then refresh from Supabase
        const sid = user?.shop_id
        const cached = sid ? localStorage.getItem(`shop_settings_${sid}`) : null
        if (cached) { try { setShopSettings(JSON.parse(cached)) } catch (_) {} }
        try {
            if (!navigator.onLine) throw new Error('Offline')
            const { data } = await supabase.from('shops').select('*').eq('id', user.shop_id).maybeSingle()
            if (data) setShopSettings(prev => ({ ...prev, ...data }))
        } catch (e) {
            console.log('PurchaseHistory: Using cached settings')
        }
    }

    const toggleExpand = (id) => {
        setExpandedPurchases(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const fetchPurchases = async () => {
        setLoading(true)
        try {
            if (!navigator.onLine) throw new Error('Offline');
            const fetchPromise = supabase
                .from('purchases')
                .select('*, suppliers(name), purchase_items(*, phones(*), products(name))')
                .eq('shop_id', user.shop_id)
                .order('created_at', { ascending: false })

            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 4000))

            const { data, error } = await Promise.race([fetchPromise, timeoutPromise])

            if (error) throw error
            if (data) {
                const cleanData = JSON.parse(JSON.stringify(data)).map(p => ({
                    ...p,
                    purchase_items: (p.purchase_items || []).map(it => normalizePurchaseItem(it))
                }))
                await db.purchases.bulkPut(cleanData)
                // Cache purchase items into local DB
                const allItems = cleanData.flatMap(p => p.purchase_items || [])
                if (allItems.length > 0) {
                    await db.purchase_items.bulkPut(allItems).catch(() => {})
                }
                // Remove any stale local UUID purchases that have already been synced
                try {
                    const pendingQueue = await db.sync_queue.where('table').equals('purchases').toArray().catch(() => [])
                    const pendingIds = new Set(pendingQueue.map(q => q.data?.id).filter(Boolean))
                    const allLocal = await db.purchases.toArray()
                    const staleLocals = allLocal.filter(p => typeof p.id === 'string' && p.id.includes('-') && !pendingIds.has(p.id))
                    if (staleLocals.length > 0) {
                        await db.purchases.bulkDelete(staleLocals.map(p => p.id))
                    }
                } catch (cleanupErr) {
                    console.warn('PurchaseHistory cleanup error:', cleanupErr)
                }
            }

            // Always render from local DB to include pending items
            const [localData, lItems, lPhones, lProducts] = await Promise.all([
                db.purchases.toArray(),
                db.purchase_items ? db.purchase_items.toArray() : [],
                db.phones ? db.phones.toArray() : [],
                db.products ? db.products.toArray() : []
            ])
            const sid = String(user.shop_id)
            const filtered = localData.filter(x => String(x.shop_id) === sid)
            const sorted = filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))

            // Deduplicate offline copies
            const seenKeys = new Set()
            const deduplicated = []
            for (const item of sorted) {
                const timeKey = item.created_at ? Math.floor(new Date(item.created_at).getTime() / 5000) : item.id
                const dupKey = `${item.supplier_id}_${item.total_amount}_${timeKey}`
                if (typeof item.id === 'string' && item.id.includes('-') && seenKeys.has(dupKey)) {
                    continue
                }
                seenKeys.add(dupKey)
                const itemsForP = item.purchase_items && item.purchase_items.length > 0
                    ? item.purchase_items
                    : lItems.filter(i => i.purchase_id === item.id)
                deduplicated.push({
                    ...item,
                    purchase_items: itemsForP.map(it => normalizePurchaseItem(it, lPhones, lProducts))
                })
            }
            setPurchases(deduplicated)
        } catch (e) {
            console.log('Purchases: Fetching from local DB (Offline Fallback)')
            try {
                const [localData, lItems, lPhones, lProducts] = await Promise.all([
                    db.purchases.toArray(),
                    db.purchase_items ? db.purchase_items.toArray() : [],
                    db.phones ? db.phones.toArray() : [],
                    db.products ? db.products.toArray() : []
                ])
                const sorted = localData.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
                const filtered = sorted.filter(x => String(x.shop_id) === String(user.shop_id))
                const seenKeys = new Set()
                const deduplicated = []
                for (const item of filtered) {
                    const timeKey = item.created_at ? Math.floor(new Date(item.created_at).getTime() / 5000) : item.id
                    const dupKey = `${item.supplier_id}_${item.total_amount}_${timeKey}`
                    if (typeof item.id === 'string' && item.id.includes('-') && seenKeys.has(dupKey)) {
                        continue
                    }
                    seenKeys.add(dupKey)
                    const itemsForP = item.purchase_items && item.purchase_items.length > 0
                        ? item.purchase_items
                        : lItems.filter(i => i.purchase_id === item.id)
                    deduplicated.push({
                        ...item,
                        purchase_items: itemsForP.map(it => normalizePurchaseItem(it, lPhones, lProducts))
                    })
                }
                setPurchases(deduplicated)
            } catch (err) { console.error('Local DB PurchaseHistory Error:', err) }
        } finally {
            setLoading(false)
        }
    }

    const openPurchase = async (purchase) => {
        setSelectedPurchase(purchase)
        setReturnQtys({})
        setLoadingItems(true)
        try {
            if (!navigator.onLine) throw new Error('Offline')
            const fetchPromise = supabase
                .from('purchase_items')
                .select('*, products(name, stock_quantity), phones(*)')
                .eq('purchase_id', purchase.id)

            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
            const { data, error } = await Promise.race([fetchPromise, timeoutPromise])

            if (error) throw error
            if (data) {
                const cleanData = JSON.parse(JSON.stringify(data)).map(it => normalizePurchaseItem(it))
                await db.purchase_items.bulkPut(cleanData)
                setPurchaseItems(cleanData)
            } else {
                setPurchaseItems((purchase.purchase_items || []).map(it => normalizePurchaseItem(it)))
            }
        } catch (e) {
            console.log('Purchase Items: Fetching from local DB')
            const localItems = await db.purchase_items.where({ purchase_id: purchase.id }).toArray().catch(() => [])
            const localPhones = db.phones ? await db.phones.toArray().catch(() => []) : []
            const rawItems = localItems.length > 0 ? localItems : (purchase.purchase_items || [])
            setPurchaseItems(rawItems.map(it => normalizePurchaseItem(it, localPhones)))
        }
        setLoadingItems(false)
    }

    // Handle purchase return (supplier return / stock out)
    const handleReturn = async () => {
        const itemsToReturn = purchaseItems.filter(i => returnQtys[i.id] > 0)
        if (itemsToReturn.length === 0) { alert('Return karne ke liye qty enter karo!'); return }

        for (const item of itemsToReturn) {
            const returnQty = parseInt(returnQtys[item.id]) || 0
            const alreadyReturned = item.returned_qty || 0
            const maxReturn = item.quantity - alreadyReturned
            if (returnQty > maxReturn) { alert(`${item.product_name}: max ${maxReturn} return ho sakta hai`); return }
        }

        setReturning(true)
        let totalReturnAmount = 0

        try {
            for (const item of itemsToReturn) {
                const returnQty = parseInt(returnQtys[item.id]) || 0
                const returnAmount = item.unit_price * returnQty
                totalReturnAmount += returnAmount

                // Update returned_qty on purchase_item
                await supabase.from('purchase_items')
                    .update({ returned_qty: (item.returned_qty || 0) + returnQty })
                    .eq('id', item.id)

                // Reduce stock — fetch live stock first
                const { data: liveProduct } = await supabase.from('products').select('stock_quantity').eq('id', item.product_id).maybeSingle()
                const currentStock = liveProduct?.stock_quantity ?? 0
                const newStock = Math.max(0, currentStock - returnQty)
                await supabase.from('products')
                    .update({ stock_quantity: newStock })
                    .eq('id', item.product_id)
                // Keep local DB in sync
                await db.products.update(item.product_id, { stock_quantity: newStock })
            }

            // Update purchase record total
            const newPurchaseTotal = Math.max(0, (selectedPurchase.total_amount || 0) - totalReturnAmount)
            await supabase.from('purchases').update({ total_amount: newPurchaseTotal }).eq('id', selectedPurchase.id)

            // If credit purchase, reduce supplier balance
            if (selectedPurchase.payment_type === 'credit' && selectedPurchase.supplier_id) {
                const { data: sup } = await supabase.from('suppliers').select('outstanding_balance').eq('id', selectedPurchase.supplier_id).maybeSingle()
                const newBal = Math.max(0, (sup?.outstanding_balance || 0) - totalReturnAmount)
                await supabase.from('suppliers').update({ outstanding_balance: newBal }).eq('id', selectedPurchase.supplier_id)

                // Log payment return in supplier_payments
                const returnPaymentPayload = {
                    shop_id: user.shop_id,
                    supplier_id: selectedPurchase.supplier_id,
                    amount: -totalReturnAmount,
                    payment_type: 'return',
                    note: `Return from Purchase PR-${String(selectedPurchase.id).slice(-6)}`
                }
                const { error: spErr } = await supabase.from('supplier_payments').insert([returnPaymentPayload])
                if (spErr && (spErr.code === 'PGRST204' || spErr.code === '42703' || String(spErr.status) === '400' || spErr.message?.includes('column') || spErr.message?.includes('schema cache'))) {
                    await supabase.from('supplier_payments').insert([{
                        shop_id: user.shop_id,
                        supplier_id: selectedPurchase.supplier_id,
                        amount: -totalReturnAmount,
                        description: `Return from Purchase PR-${String(selectedPurchase.id).slice(-6)}`
                    }])
                }
            }

            // Audit Log
            await recordAuditLog(
                'PURCHASE_RETURN',
                'purchases',
                selectedPurchase.id,
                {
                    purchase: selectedPurchase.id,
                    returned_amount: totalReturnAmount,
                    items: itemsToReturn.map(it => ({ name: it.product_name, qty: returnQtys[it.id] }))
                },
                user.id,
                user.shop_id
            )

            alert('Return successful! Purchase invoice updated.')
            setReturning(false)
            setReturnQtys({})

            // Re-fetch updated purchase
            const { data: updatedPurchase } = await supabase.from('purchases').select('*, suppliers(name)').eq('id', selectedPurchase.id).maybeSingle()
            if (updatedPurchase) setSelectedPurchase(updatedPurchase)
            fetchPurchases()
        } catch (err) {
            const errMsg = err?.message || String(err)
            if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
                // OFFLINE RETURN LOGIC
                totalReturnAmount = 0
                for (const item of itemsToReturn) {
                    const returnQty = parseInt(returnQtys[item.id]) || 0
                    totalReturnAmount += item.unit_price * returnQty

                    // 1. Update local purchase_item
                    const newRetQty = (item.returned_qty || 0) + returnQty
                    await db.purchase_items.update(item.id, { returned_qty: newRetQty })
                    await db.sync_queue.add({ table: 'purchase_items', action: 'UPDATE', data: { id: item.id, returned_qty: newRetQty }, timestamp: new Date().toISOString() })

                    // 2. Update local stock (subtract for purchase return)
                    const localProd = await db.products.get(item.product_id)
                    const newStock = Math.max(0, (localProd?.stock_quantity || 0) - returnQty)
                    await db.products.update(item.product_id, { stock_quantity: newStock })
                    await db.sync_queue.add({ table: 'products', action: 'UPDATE', data: { id: item.product_id, stock_quantity: newStock }, timestamp: new Date().toISOString() })
                }

                // Update local purchase total
                const newPurchaseTotal = Math.max(0, (selectedPurchase.total_amount || 0) - totalReturnAmount)
                await db.purchases.update(selectedPurchase.id, { total_amount: newPurchaseTotal })
                await db.sync_queue.add({ table: 'purchases', action: 'UPDATE', data: { id: selectedPurchase.id, total_amount: newPurchaseTotal }, timestamp: new Date().toISOString() })

                alert('Offline mode: Return processed locally. Stock and Invoice updated! 🔄')
                setReturning(false)
                setReturnQtys({})
                setSelectedPurchase({ ...selectedPurchase, total_amount: newPurchaseTotal })
                fetchPurchases()
            } else {
                alert('Error processing return: ' + errMsg)
                setReturning(false)
            }
        }
    }

    const handleExport = () => {
        const data = filtered.map(p => ({
            'ID': `PR-${String(p.id).slice(-6)}`,
            'Supplier': p.suppliers?.name || 'Unknown',
            'Phone / Items': (p.purchase_items || []).map(i => {
                const name = i.display_name || i.product_name || 'Item'
                const sp = i.specs ? ` (${i.specs})` : ''
                const im = i.imei ? ` [IMEI: ${i.imei}]` : ''
                return `${name}${sp}${im}`
            }).join('; ') || 'Direct Purchase',
            'Total Amount': p.total_amount,
            'Paid Amount': p.paid_amount,
            'Payment Type': p.payment_type.toUpperCase(),
            'Date': new Date(p.created_at).toLocaleDateString('en-PK')
        }))
        const ws = XLSX.utils.json_to_sheet(data)
        ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 38 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Purchases')
        XLSX.writeFile(wb, `PurchaseHistory_${new Date().toISOString().slice(0, 10)}.xlsx`)
    }

    const printPurchase = (p, items) => {
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
            const ph = i.phones
            const baseName = i.display_name || i.product_name || i.products?.name || (ph ? `${ph.brand && ph.brand !== 'Unknown' ? ph.brand + ' ' : ''}${ph.model || 'Phone'}` : 'Item')
            const returnNote = returnedQty > 0 ? ` (Returned: ${returnedQty})` : ''
            return {
                name: baseName + returnNote,
                qty: netQty,
                price: Number(i.unit_price || i.price || 0),
                sku: i.products?.sku || '',
                brand: ph?.brand || i.products?.brand || '',
                imei_1: i.imei || ph?.imei_1 || null
            }
        }).filter(i => i.qty > 0)

        const subtotal = items.reduce((sum, item) => sum + (Number(item.unit_price || item.price || 0) * (item.quantity - (item.returned_qty || 0))), 0)
        const discount = Number(p.discount || 0)
        const total = Math.max(0, subtotal - discount)

        // Construct supplier object matching billTemplates customer expectations
        const supplier = p.suppliers ? {
            name: p.suppliers.name,
            phone: p.suppliers.phone || '',
            address: p.suppliers.address || ''
        } : null

        const payload = {
            sale: {
                id: p.id,
                created_at: p.created_at,
                paid_amount: p.paid_amount,
                created_by: p.users?.username || 'Staff',
                payment_type: p.payment_type || p.payment_method
            },
            customer: supplier,
            walkInName: !supplier ? 'Unknown Supplier' : null,
            items: formattedItems,
            subtotal,
            totalDiscount: discount,
            total,
            change: 0
        }

        const html = buildBillHTML(payload, false, mergedSettings, true)
        printHTML(html)
    }

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
            const item = purchases.find(p => p.id === id)
            if (!item) continue
            try {
                if (navigator.onLine) {
                    const { error } = await supabase.from('purchases').delete().eq('id', id)
                    if (error) {
                        console.error('Delete failed:', error)
                        failCount++
                        continue
                    }
                } else {
                    await addToSyncQueue('purchases', 'DELETE', { id })
                }

                await moveToTrash('purchases', id, item, user.id, user.shop_id)
                await db.purchases.delete(id)
                successfulIds.push(id)
                successCount++
            } catch (err) {
                console.error('Delete error:', err)
                failCount++
            }
        }

        setPurchases(prev => prev.filter(p => !successfulIds.includes(p.id)))
        setSelected([])

        if (failCount > 0) {
            alert(`⚠️ Partially completed.\n✅ Deleted: ${successCount}\n❌ Failed: ${failCount}\n\n👉 Yeh purchases mein ledger entries linked hain.\n\nSahi order:\n1. Pehle Purchase Items delete karein (Trash Bin > Purchase Items filter)\n2. Phir yeh purchases delete ho jayenge`)
        } else if (successCount > 0) {
            alert(`🗑️ ${successCount} purchase(s) moved to Trash!`)
        }
        fetchPurchases()
    }

    const toggleSelect = (id) => {
        setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    }

    const toggleSelectAll = () => {
        if (selected.length === filtered.length) setSelected([])
        else setSelected(filtered.map(x => x.id))
    }

    const filtered = purchases.filter(p => {
        const q = search.trim().toLowerCase()
        const matchSearch = !q ||
            (p.suppliers?.name || '').toLowerCase().includes(q) ||
            String(p.id).toLowerCase().includes(q) ||
            `pr-${String(p.id).slice(-6)}`.toLowerCase().includes(q) ||
            (p.purchase_items || []).some(i => {
                const name = (i.display_name || i.product_name || i.phones?.model || i.phones?.brand || '').toLowerCase()
                const imei = (i.imei || i.phones?.imei_1 || '').toLowerCase()
                const imei2 = (i.imei2 || i.phones?.imei_2 || '').toLowerCase()
                return name.includes(q) || imei.includes(q) || imei2.includes(q)
            })
        const matchPayment = paymentFilter !== 'all' ? p.payment_type === paymentFilter : true
        const matchDate = dateFilter ? p.created_at?.startsWith(dateFilter) : true
        return matchSearch && matchPayment && matchDate
    })

    // Summary stats
    const totalPurchaseValue = filtered.reduce((sum, p) => sum + Number(p.total_amount || 0), 0)
    const cashCount = filtered.filter(p => p.payment_type === 'cash').length
    const creditCount = filtered.filter(p => p.payment_type === 'credit').length

    if (!hasFeature('purchases')) return <UpgradeWall feature="purchases" />

    return (
        <>
            <div>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800">📦 Purchase History</h1>
                        <p className="text-gray-500 text-sm">View and manage previous stock-in records</p>
                    </div>
                    <div className="flex gap-3 items-center overflow-x-auto pb-1 max-w-full">
                        {/* Summary cards */}
                        <div className="bg-white px-4 py-2 rounded-xl shadow-sm border border-gray-100 text-center min-w-[100px]">
                            <p className="text-[10px] text-gray-400 font-bold uppercase">Total</p>
                            <p className="text-sm font-bold text-blue-600">Rs. {totalPurchaseValue.toLocaleString()}</p>
                        </div>
                        <div className="bg-white px-3 py-2 rounded-xl shadow-sm border border-gray-100 text-center min-w-[100px]">
                            <p className="text-[10px] text-gray-400 font-bold uppercase">Cash</p>
                            <p className="text-sm font-bold text-green-600">{cashCount}</p>
                        </div>
                        <div className="bg-white px-3 py-2 rounded-xl shadow-sm border border-gray-100 text-center min-w-[100px]">
                            <p className="text-[10px] text-gray-400 font-bold uppercase">Credit</p>
                            <p className="text-sm font-bold text-orange-600">{creditCount}</p>
                        </div>
                    </div>
                    {selected.length > 0 && (
                        <button onClick={() => requestDelete(selected)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl transition font-bold text-sm">
                            🗑️ Delete Selected ({selected.length})
                        </button>
                    )}
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col sm:flex-row gap-4 items-start sm:items-center flex-wrap">
                    <input
                        type="text"
                        placeholder="Search PR- ID or Supplier..."
                        className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none w-full sm:w-auto"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                    <div className="flex gap-2 w-full sm:w-auto overflow-x-auto pb-1 items-center">
                        <select
                            className="px-4 py-2 border rounded-lg outline-none flex-shrink-0"
                            value={paymentFilter}
                            onChange={e => setPaymentFilter(e.target.value)}
                        >
                            <option value="all">All Payments</option>
                            <option value="cash">Cash Only</option>
                            <option value="credit">Credit Only</option>
                        </select>
                        <input
                            type="date"
                            className="px-4 py-2 border rounded-lg outline-none w-[140px] flex-shrink-0"
                            value={dateFilter}
                            onChange={e => setDateFilter(e.target.value)}
                        />
                        <button
                            onClick={handleExport}
                            className="px-4 py-2 bg-green-50 text-green-700 hover:bg-green-100 font-bold rounded-lg border border-green-200 transition text-sm flex-shrink-0"
                        >
                            📤 Export Excel
                        </button>
                        <button
                            onClick={fetchPurchases}
                            className="p-2 text-gray-400 hover:text-blue-600 transition flex-shrink-0"
                            title="Refresh Data"
                        >
                            🔄
                        </button>
                    </div>
                </div>

                {loading ? (
                    <p className="text-gray-500 italic">Loading purchase records...</p>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-12"><p className="text-gray-400 text-lg">No purchases found.</p></div>
                ) : (
                    <div className="bg-white rounded-xl shadow overflow-hidden">
                        <div className="divide-y divide-gray-100 md:hidden">
                            {filtered.map(p => {
                                const isExpanded = expandedPurchases.has(p.id)
                                const items = p.purchase_items || []
                                const firstItem = items[0]
                                const firstPhoneName = firstItem ? (firstItem.display_name || firstItem.product_name || (firstItem.phones ? `${firstItem.phones.brand && firstItem.phones.brand !== 'Unknown' ? firstItem.phones.brand + ' ' : ''}${firstItem.phones.model || 'Phone'}` : 'Item')) : null

                                return (
                                    <div key={p.id} className={`p-4 ${selected.includes(p.id) ? 'bg-blue-50/60' : ''}`}>
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="font-mono text-xs font-bold text-gray-500 font-black">
                                                    PR-{String(p.id).slice(-6)}
                                                </p>
                                                <p className="mt-1 truncate font-bold text-gray-900">
                                                    {p.suppliers?.name || 'Unknown'}
                                                </p>
                                                {firstPhoneName && (
                                                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                                        <span className="text-xs font-bold text-blue-900 bg-blue-50 border border-blue-200/60 px-2 py-0.5 rounded-md">
                                                            📱 {firstPhoneName}
                                                            {items.length > 1 && ` (+${items.length - 1})`}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleExpand(p.id)}
                                                            className="text-[11px] text-blue-600 font-bold hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                                                        >
                                                            <span>{isExpanded ? 'Hide' : 'Details'}</span>
                                                            <span className={`text-[9px] transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                                                        </button>
                                                    </div>
                                                )}
                                                <p className="mt-1 text-xs text-gray-400">{new Date(p.created_at).toLocaleDateString('en-PK')}</p>
                                            </div>
                                            <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggleSelect(p.id)} className="mt-1 h-4 w-4 rounded cursor-pointer" />
                                        </div>
                                        <div className="mt-3 flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-lg font-black text-gray-900">
                                                    Rs. {Number(p.total_amount).toLocaleString()}
                                                </p>
                                                <div className="mt-1 flex flex-wrap gap-1.5">
                                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${p.payment_type === 'cash' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                                                        {p.payment_type === 'cash' ? '💵 Cash' : '📒 Credit'}
                                                    </span>
                                                    {p.paid_amount != null && Number(p.paid_amount) < Number(p.total_amount) && (
                                                        <span className="bg-orange-50 text-orange-600 border border-orange-200 px-2 py-0.5 rounded text-[10px] font-bold">
                                                            Paid: {Number(p.paid_amount).toLocaleString()}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={() => setPurchaseToEditPayment(p)} className="rounded-lg bg-purple-50 px-2.5 py-2 text-xs font-bold text-purple-700 hover:bg-purple-100 transition cursor-pointer">Payment</button>
                                                <button onClick={() => openPurchase(p)} className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-bold text-blue-600">View</button>
                                                <button onClick={() => requestDelete([p.id])} className="rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600">Delete</button>
                                            </div>
                                        </div>

                                        {isExpanded && items.length > 0 && (
                                            <div className="mt-3 bg-blue-50/70 p-3 rounded-xl border border-blue-100 flex flex-col gap-2">
                                                <div className="flex items-center justify-between text-xs font-bold text-blue-900 border-b border-blue-200/60 pb-1.5">
                                                    <span>📱 Phone List ({items.length})</span>
                                                    <span className="uppercase text-[10px] text-gray-500 font-semibold">{p.payment_type}</span>
                                                </div>
                                                <div className="flex flex-col gap-2">
                                                    {items.map((it, iidx) => {
                                                        const ph = it.phones
                                                        const name = it.display_name || it.product_name || (ph ? `${ph.brand && ph.brand !== 'Unknown' ? ph.brand + ' ' : ''}${ph.model || 'Phone'}` : 'Item')
                                                        const specs = it.specs || (ph ? [ph.storage, ph.color, ph.pta_status ? ph.pta_status.toUpperCase() : null, ph.condition ? ph.condition.toUpperCase() : null].filter(Boolean).join(' • ') : null)
                                                        const imei = it.imei || ph?.imei_1 || null
                                                        const imei2 = it.imei2 || ph?.imei_2 || null
                                                        const cost = it.unit_price || it.cost_price || 0
                                                        const qty = it.quantity || 1
                                                        const status = it.status || ph?.status

                                                        return (
                                                            <div key={iidx} className="bg-white p-2.5 rounded-lg border border-blue-100/80 shadow-2xs text-xs space-y-1">
                                                                <div className="flex items-start justify-between gap-1">
                                                                    <p className="font-bold text-gray-900">{name}</p>
                                                                    {status && (
                                                                        <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-bold uppercase shrink-0 ${
                                                                            status === 'in_stock' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                                                                        }`}>
                                                                            {status.replace('_', ' ')}
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
                                                                    <span className="text-gray-400">Qty: {qty}</span>
                                                                    <span className="font-bold text-gray-900">Rs. {Number(cost).toLocaleString()}</span>
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
                        <div className="hidden overflow-x-auto md:block">
                            <table className="w-full">
                                <thead className="bg-gray-50 border-b">
                                    <tr>
                                        <th className="px-4 py-4 w-10"><input type="checkbox" checked={selected.length === filtered.length && filtered.length > 0} onChange={toggleSelectAll} className="w-4 h-4 rounded cursor-pointer" /></th>
                                        <th className="px-5 py-4 text-left text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Invoice ID</th>
                                        <th className="px-5 py-4 text-left text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Supplier</th>
                                        <th className="px-5 py-4 text-left text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Phone / Items</th>
                                        <th className="px-5 py-4 text-left text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Total</th>
                                        <th className="px-5 py-4 text-left text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Payment</th>
                                        <th className="px-5 py-4 text-left text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Date</th>
                                        <th className="px-5 py-4 text-left text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {filtered.map(p => {
                                        const isExpanded = expandedPurchases.has(p.id)
                                        const items = p.purchase_items || []
                                        const firstItem = items[0]
                                        const firstPhoneName = firstItem ? (firstItem.display_name || firstItem.product_name || (firstItem.phones ? `${firstItem.phones.brand && firstItem.phones.brand !== 'Unknown' ? firstItem.phones.brand + ' ' : ''}${firstItem.phones.model || 'Phone'}` : 'Item')) : null

                                        return (
                                            <React.Fragment key={p.id}>
                                                <tr className={`hover:bg-gray-50 transition ${selected.includes(p.id) ? 'bg-blue-50/60' : ''}`}>
                                                    <td className="px-4 py-3"><input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggleSelect(p.id)} className="w-4 h-4 rounded cursor-pointer" /></td>
                                                    <td className="px-5 py-3 font-mono text-xs text-blue-600 font-bold whitespace-nowrap">PR-{String(p.id).slice(-6)}</td>
                                                    <td className="px-5 py-3 text-gray-800 font-medium whitespace-nowrap">{p.suppliers?.name || <span className="text-gray-400 italic">Unknown</span>}</td>
                                                    <td className="px-5 py-3">
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
                                                                    onClick={() => toggleExpand(p.id)}
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
                                                            <span className="text-gray-400 text-xs italic">Direct Purchase</span>
                                                        )}
                                                    </td>
                                                    <td className="px-5 py-3 font-medium text-gray-800 whitespace-nowrap">
                                                        Rs. {Number(p.total_amount).toLocaleString()}
                                                        {p.paid_amount != null && Number(p.paid_amount) < Number(p.total_amount) && (
                                                            <span className="text-xs text-orange-500 ml-1">(Paid: {Number(p.paid_amount).toLocaleString()})</span>
                                                        )}
                                                    </td>
                                                    <td className="px-5 py-3 whitespace-nowrap">
                                                        <div className="flex flex-col gap-1">
                                                            <span className={`px-2 py-1 rounded-full text-xs font-medium w-fit ${p.payment_type === 'cash' ? 'bg-green-100 text-green-700' : p.payment_type === 'bank' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                                                                {p.payment_type === 'cash' ? '💵 Cash' : p.payment_type === 'bank' ? '🏦 Bank' : '📒 Credit'}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-5 py-3 text-gray-500 text-sm whitespace-nowrap">{new Date(p.created_at).toLocaleDateString('en-PK')}</td>
                                                    <td className="px-5 py-3 whitespace-nowrap">
                                                        <div className="flex gap-2">
                                                            <button onClick={() => setPurchaseToEditPayment(p)}
                                                                className="text-purple-600 hover:text-purple-800 text-sm font-medium cursor-pointer">Edit Payment</button>
                                                            <button onClick={() => openPurchase(p)}
                                                                className="text-blue-500 hover:text-blue-700 text-sm font-medium cursor-pointer">View</button>
                                                            <button onClick={() => requestDelete([p.id])}
                                                                className="text-red-500 hover:text-red-700 text-sm font-medium cursor-pointer">Delete</button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {isExpanded && (
                                                    <tr className="bg-gradient-to-r from-blue-50/70 via-indigo-50/40 to-blue-50/70 border-b border-blue-200/80">
                                                        <td colSpan="8" className="px-6 py-4">
                                                            <div className="flex flex-col gap-3">
                                                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-200/60 pb-2">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-xs font-black uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
                                                                            📱 Phones in PR-{String(p.id).slice(-6)}
                                                                        </span>
                                                                        <span className="text-xs bg-white text-blue-800 px-2 py-0.5 rounded-full border border-blue-200 font-bold shadow-2xs">
                                                                            {items.length} unit(s)
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2 text-xs">
                                                                        <span className="text-gray-500 font-medium">Payment:</span>
                                                                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase ${
                                                                            p.payment_type === 'cash' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                                                                        }`}>
                                                                            {p.payment_type}
                                                                        </span>
                                                                        {p.paid_amount != null && (
                                                                            <span className="text-gray-500 font-medium">
                                                                                (Paid: Rs. {Number(p.paid_amount).toLocaleString()})
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                                                    {items.map((it, iidx) => {
                                                                        const ph = it.phones
                                                                        const name = it.display_name || it.product_name || (ph ? `${ph.brand && ph.brand !== 'Unknown' ? ph.brand + ' ' : ''}${ph.model || 'Phone'}` : 'Item')
                                                                        const specs = it.specs || (ph ? [ph.storage, ph.color, ph.pta_status ? ph.pta_status.toUpperCase() : null, ph.condition ? ph.condition.toUpperCase() : null].filter(Boolean).join(' • ') : null)
                                                                        const imei = it.imei || ph?.imei_1 || null
                                                                        const imei2 = it.imei2 || ph?.imei_2 || null
                                                                        const cost = it.unit_price || it.cost_price || 0
                                                                        const qty = it.quantity || 1
                                                                        const status = it.status || ph?.status

                                                                        return (
                                                                            <div key={iidx} className="bg-white rounded-xl p-3 border border-blue-100 shadow-2xs hover:shadow-xs transition flex flex-col justify-between gap-2">
                                                                                <div>
                                                                                    <div className="flex items-start justify-between gap-2">
                                                                                        <h4 className="font-bold text-gray-900 text-xs sm:text-sm">{name}</h4>
                                                                                        {status && (
                                                                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 ${
                                                                                                status === 'in_stock'
                                                                                                    ? 'bg-green-100 text-green-700'
                                                                                                    : status === 'sold'
                                                                                                    ? 'bg-blue-100 text-blue-700'
                                                                                                    : 'bg-gray-100 text-gray-600'
                                                                                            }`}>
                                                                                                {status.replace('_', ' ')}
                                                                                            </span>
                                                                                        )}
                                                                                    </div>
                                                                                    {specs && (
                                                                                        <p className="text-[11px] text-gray-500 mt-1 font-medium">{specs}</p>
                                                                                    )}
                                                                                    {(imei || imei2) && (
                                                                                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                                                                            {imei && (
                                                                                                <span className="font-mono text-[11px] font-bold bg-blue-50 text-blue-800 border border-blue-200/80 px-2 py-0.5 rounded">
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
                                                                                <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-xs">
                                                                                    <span className="text-gray-400 font-medium">Qty: {qty}</span>
                                                                                    <div className="text-right">
                                                                                        <span className="text-gray-400 text-[10px] mr-1">Cost:</span>
                                                                                        <span className="font-black text-gray-900">Rs. {Number(cost).toLocaleString()}</span>
                                                                                    </div>
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
                )}

                {/* Detail Modal */}
                {selectedPurchase && (
                    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-start sm:items-center justify-center z-50 overflow-y-auto py-4 px-2 sm:px-4">
                        <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-2xl max-h-[90dvh] overflow-y-auto">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h2 className="text-lg font-bold text-gray-800">
                                        Purchase Invoice PR-{String(selectedPurchase.id).slice(-8)}
                                    </h2>
                                    <p className="text-sm text-gray-500">
                                        {new Date(selectedPurchase.created_at).toLocaleString('en-PK')} |
                                        {' '}{selectedPurchase.suppliers?.name || 'Unknown'} |
                                        <span className={selectedPurchase.payment_type === 'cash' ? ' text-green-600' : ' text-orange-600'}>
                                            {' '}{selectedPurchase.payment_type?.toUpperCase()}
                                        </span>
                                    </p>
                                </div>
                                <button onClick={() => setSelectedPurchase(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
                            </div>

                            {/* Info Grid */}
                            <div className="grid grid-cols-2 gap-4 mb-4 bg-gray-50 p-4 rounded-xl border border-gray-100 text-sm">
                                <p><span className="text-gray-400 font-medium uppercase text-[10px] block">Supplier</span> <b>{selectedPurchase.suppliers?.name || 'Unknown'}</b></p>
                                <p><span className="text-gray-400 font-medium uppercase text-[10px] block">Date</span> <b>{new Date(selectedPurchase.created_at).toLocaleString('en-PK')}</b></p>
                                <p><span className="text-gray-400 font-medium uppercase text-[10px] block">Total Amount</span> <b className="text-lg">Rs. {Number(selectedPurchase.total_amount).toLocaleString()}</b></p>
                                <p><span className="text-gray-400 font-medium uppercase text-[10px] block">Payment Type</span>
                                    <span className="flex items-center gap-2 mt-0.5">
                                        <b className="uppercase">{selectedPurchase.payment_type}</b>
                                        <button
                                            type="button"
                                            onClick={() => setPurchaseToEditPayment(selectedPurchase)}
                                            className="px-2 py-0.5 rounded bg-purple-50 text-purple-700 text-xs font-bold border border-purple-200 hover:bg-purple-100 transition cursor-pointer"
                                        >
                                            ✏️ Change Method
                                        </button>
                                    </span>
                                    {selectedPurchase.paid_amount != null && <span className="text-xs text-gray-400 ml-2">(Paid: Rs. {Number(selectedPurchase.paid_amount).toLocaleString()})</span>}
                                </p>
                            </div>

                            {loadingItems ? (
                                <p className="text-center py-8 text-gray-500">Loading items...</p>
                            ) : (
                                <>
                                    <div className="overflow-x-auto">
                                        <table className="w-full mb-6">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-4 py-3 text-left text-xs text-gray-500 uppercase font-bold whitespace-nowrap">Product</th>
                                                    <th className="px-4 py-3 text-right text-xs text-gray-500 uppercase font-bold whitespace-nowrap">Qty</th>
                                                    <th className="px-4 py-3 text-right text-xs text-gray-500 uppercase font-bold whitespace-nowrap">Rate</th>
                                                    <th className="px-4 py-3 text-right text-xs text-gray-500 uppercase font-bold whitespace-nowrap">Amount</th>
                                                    <th className="px-4 py-3 text-center text-xs text-gray-500 uppercase font-bold bg-orange-50 whitespace-nowrap">Ret. Qty</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {purchaseItems.map((item, idx) => {
                                                    const maxReturn = item.quantity - (item.returned_qty || 0)
                                                    return (
                                                        <tr key={idx} className="hover:bg-gray-50">
                                                            <td className="px-4 py-3 text-gray-800">
                                                                <p className="font-bold text-gray-900 text-sm">
                                                                    {item.display_name || item.product_name || (item.phones ? `${item.phones.brand && item.phones.brand !== 'Unknown' ? item.phones.brand + ' ' : ''}${item.phones.model || 'Phone'}` : 'Item')}
                                                                </p>
                                                                {item.specs && <p className="text-xs text-gray-500 mt-0.5">{item.specs}</p>}
                                                                {(item.imei || item.phones?.imei_1) && (
                                                                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                                        <span className="font-mono text-[11px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.2 rounded font-semibold">
                                                                            IMEI: {item.imei || item.phones?.imei_1}
                                                                        </span>
                                                                        {(item.imei2 || item.phones?.imei_2) && (
                                                                            <span className="font-mono text-[10px] bg-gray-50 text-gray-600 border border-gray-200 px-1 py-0.2 rounded">
                                                                                IMEI 2: {item.imei2 || item.phones?.imei_2}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">
                                                                {item.quantity}
                                                                {item.returned_qty > 0 && <span className="text-xs text-red-500 ml-1 block">(-{item.returned_qty} ret)</span>}
                                                            </td>
                                                            <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">Rs. {Number(item.unit_price).toFixed(0)}</td>
                                                            <td className="px-4 py-3 text-right font-medium text-gray-800 whitespace-nowrap">Rs. {Number(item.total_price || item.line_total).toFixed(0)}</td>
                                                            <td className="px-4 py-3 text-center align-middle whitespace-nowrap">
                                                                {maxReturn > 0 ? (
                                                                    <input
                                                                        type="number"
                                                                        min="0"
                                                                        max={maxReturn}
                                                                        value={returnQtys[item.id] || ''}
                                                                        onChange={e => setReturnQtys(prev => ({ ...prev, [item.id]: e.target.value }))}
                                                                        className="w-16 border rounded px-2 py-1 text-center text-sm shadow-inner"
                                                                        placeholder="0"
                                                                    />
                                                                ) : (
                                                                    <span className="text-xs text-gray-400 italic">Fully Ret</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-t border-gray-100 pt-4 mt-4 gap-4">
                                        <div className="text-sm">
                                            <p className="text-gray-500">Total Amount: <b className="text-gray-800 text-lg">Rs. {Number(selectedPurchase.total_amount).toLocaleString()}</b></p>
                                            {selectedPurchase.paid_amount != null && <p className="text-gray-500">Paid Amount: <b className="text-gray-800">Rs. {Number(selectedPurchase.paid_amount).toLocaleString()}</b></p>}
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button onClick={() => printPurchase(selectedPurchase, purchaseItems)}
                                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition">
                                                🖨️ Print Invoice
                                            </button>
                                            <button onClick={handleReturn} disabled={returning}
                                                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm transition disabled:opacity-50">
                                                {returning ? 'Processing...' : '↩️ Process Return'}
                                            </button>
                                            <button onClick={() => setSelectedPurchase(null)}
                                                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition">
                                                Close
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {
                showPasswordModal && (
                    <PasswordModal
                        title="Delete Purchase(s)"
                        message={`${pendingDeleteIds.length} purchase(s) will be moved to Trash`}
                        onConfirm={executeDelete}
                        onCancel={() => { setShowPasswordModal(false); setPendingDeleteIds([]) }}
                    />
                )
            }

            {/* Edit Purchase Payment Method Modal */}
            <EditPurchasePaymentModal
                isOpen={!!purchaseToEditPayment}
                onClose={() => setPurchaseToEditPayment(null)}
                purchase={purchaseToEditPayment}
                onUpdated={async () => {
                    await fetchPurchases()
                    if (selectedPurchase && purchaseToEditPayment?.id === selectedPurchase.id) {
                        try {
                            const { data } = await supabase.from('purchases').select('*, suppliers(name)').eq('id', selectedPurchase.id).maybeSingle()
                            if (data) setSelectedPurchase(data)
                        } catch (_) {}
                    }
                }}
            />
        </>
    )
}

export default PurchaseHistory
