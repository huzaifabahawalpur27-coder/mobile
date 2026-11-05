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
    const baseCost = Number(it.cost_price ?? (ph?.cost_price ?? (it.unit_price ?? (it.price ?? 0))))
    const directCost = Number(it.additional_costs ?? (ph?.additional_costs ?? 0))
    const totalCost = baseCost + directCost
    const salePrice = Number(ph?.sale_price || ph?.selling_price || 0)
    const qty = Number(it.quantity || 1)

    return {
        ...it,
        phones: ph,
        display_name: name,
        specs,
        imei,
        imei2,
        status: ph?.status || null,
        base_cost: baseCost,
        direct_cost: directCost,
        total_cost: totalCost,
        sale_price: salePrice,
        unit_price: baseCost,
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
                let itemsForP = item.purchase_items && item.purchase_items.length > 0
                    ? item.purchase_items
                    : lItems.filter(i => i.purchase_id === item.id)
                if ((!itemsForP || itemsForP.length === 0) && lPhones && lPhones.length > 0) {
                    const matchedPhones = lPhones.filter(ph => ph.purchase_id === item.id)
                    if (matchedPhones.length > 0) {
                        itemsForP = matchedPhones.map(ph => ({
                            id: `ph-item-${ph.id}`,
                            purchase_id: item.id,
                            phone_id: ph.id,
                            product_name: `${ph.brand} ${ph.model}${ph.storage ? ` ${ph.storage}` : ''}`.trim(),
                            quantity: 1,
                            unit_price: ph.cost_price || 0,
                            cost_price: ph.cost_price || 0,
                            total_price: ph.cost_price || 0,
                            subtotal: ph.cost_price || 0,
                            phones: ph,
                            imei_list: [ph.imei_1]
                        }))
                    }
                }
                deduplicated.push({
                    ...item,
                    purchase_items: (itemsForP || []).map(it => normalizePurchaseItem(it, lPhones, lProducts))
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
                    let itemsForP = item.purchase_items && item.purchase_items.length > 0
                        ? item.purchase_items
                        : lItems.filter(i => i.purchase_id === item.id)
                    if ((!itemsForP || itemsForP.length === 0) && lPhones && lPhones.length > 0) {
                        const matchedPhones = lPhones.filter(ph => ph.purchase_id === item.id)
                        if (matchedPhones.length > 0) {
                            itemsForP = matchedPhones.map(ph => ({
                                id: `ph-item-${ph.id}`,
                                purchase_id: item.id,
                                phone_id: ph.id,
                                product_name: `${ph.brand} ${ph.model}${ph.storage ? ` ${ph.storage}` : ''}`.trim(),
                                quantity: 1,
                                unit_price: ph.cost_price || 0,
                                cost_price: ph.cost_price || 0,
                                total_price: ph.cost_price || 0,
                                subtotal: ph.cost_price || 0,
                                phones: ph,
                                imei_list: [ph.imei_1]
                            }))
                        }
                    }
                    deduplicated.push({
                        ...item,
                        purchase_items: (itemsForP || []).map(it => normalizePurchaseItem(it, lPhones, lProducts))
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
            let itemsToDisplay = data && data.length > 0 ? data : []

            if (itemsToDisplay.length === 0 && navigator.onLine) {
                try {
                    const { data: linkedPh } = await supabase.from('phones').select('*').eq('purchase_id', purchase.id)
                    if (linkedPh && linkedPh.length > 0) {
                        itemsToDisplay = linkedPh.map(ph => ({
                            id: `ph-item-${ph.id}`,
                            purchase_id: purchase.id,
                            phone_id: ph.id,
                            product_name: `${ph.brand} ${ph.model}${ph.storage ? ` ${ph.storage}` : ''}`.trim(),
                            quantity: 1,
                            unit_price: ph.cost_price || 0,
                            cost_price: ph.cost_price || 0,
                            total_price: ph.cost_price || 0,
                            subtotal: ph.cost_price || 0,
                            phones: ph,
                            imei_list: [ph.imei_1]
                        }))
                    }
                } catch (_) {}
            }

            if (itemsToDisplay.length > 0) {
                const cleanData = JSON.parse(JSON.stringify(itemsToDisplay)).map(it => normalizePurchaseItem(it))
                await db.purchase_items.bulkPut(cleanData).catch(() => {})
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

                // Handle phone items vs product items
                if (item.phone_id) {
                    // Mark phone as returned
                    await supabase.from('phones').update({ status: 'returned' }).eq('id', item.phone_id)
                    if (db.phones) await db.phones.update(item.phone_id, { status: 'returned' }).catch(() => {})
                } else if (item.product_id) {
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

                    // 2. Handle phone vs product stock
                    if (item.phone_id) {
                        // Mark phone as returned locally
                        if (db.phones) await db.phones.update(item.phone_id, { status: 'returned' }).catch(() => {})
                        await db.sync_queue.add({ table: 'phones', action: 'UPDATE', data: { id: item.phone_id, status: 'returned' }, timestamp: new Date().toISOString() })
                    } else if (item.product_id) {
                        // Update local stock (subtract for purchase return)
                        const localProd = await db.products.get(item.product_id)
                        const newStock = Math.max(0, (localProd?.stock_quantity || 0) - returnQty)
                        await db.products.update(item.product_id, { stock_quantity: newStock })
                        await db.sync_queue.add({ table: 'products', action: 'UPDATE', data: { id: item.product_id, stock_quantity: newStock }, timestamp: new Date().toISOString() })
                    }
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

                if (item.supplier_id) {
                    const unpaid = Math.max(0, Number(item.total_amount || 0) - Number(item.paid_amount || 0))
                    if (unpaid > 0) {
                        try {
                            const { data: curSup } = await supabase.from('suppliers').select('balance, outstanding_balance').eq('id', item.supplier_id).maybeSingle()
                            const baseBal = Number(curSup?.outstanding_balance ?? curSup?.balance ?? 0)
                            const newBal = Math.max(0, baseBal - unpaid)
                            if (navigator.onLine) {
                                await supabase.from('suppliers').update({ balance: newBal, outstanding_balance: newBal }).eq('id', item.supplier_id)
                            }
                            await db.suppliers?.update(Number(item.supplier_id), { balance: newBal, outstanding_balance: newBal }).catch(() => {})
                        } catch (_) {}
                    }
                }

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
    const cashCount = filtered.filter(p => (p.payment_type || '').toLowerCase() === 'cash').length
    const bankCount = filtered.filter(p => (p.payment_type || '').toLowerCase() === 'bank').length
    const creditCount = filtered.filter(p => (p.payment_type || '').toLowerCase() === 'credit').length

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
                        <div className="bg-white px-3 py-2 rounded-xl shadow-sm border border-gray-100 text-center min-w-[90px]">
                            <p className="text-[10px] text-gray-400 font-bold uppercase">Cash</p>
                            <p className="text-sm font-bold text-green-600">{cashCount}</p>
                        </div>
                        <div className="bg-white px-3 py-2 rounded-xl shadow-sm border border-gray-100 text-center min-w-[90px]">
                            <p className="text-[10px] text-gray-400 font-bold uppercase">Bank</p>
                            <p className="text-sm font-bold text-blue-600">{bankCount}</p>
                        </div>
                        <div className="bg-white px-3 py-2 rounded-xl shadow-sm border border-gray-100 text-center min-w-[90px]">
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
                            <option value="cash">💵 Cash Only</option>
                            <option value="bank">🏦 Bank Only</option>
                            <option value="credit">📒 Credit Only</option>
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
                                                <div className="mt-1 flex flex-wrap gap-1.5 items-center">
                                                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                                                        p.payment_type === 'cash'
                                                            ? 'bg-green-100 text-green-700'
                                                            : p.payment_type === 'bank'
                                                                ? 'bg-blue-100 text-blue-700'
                                                                : 'bg-orange-100 text-orange-700'
                                                    }`}>
                                                        {p.payment_type === 'cash' ? '💵 Cash' : p.payment_type === 'bank' ? '🏦 Bank' : '📒 Credit'}
                                                    </span>
                                                    {p.payment_type === 'bank' && (p.payment_details?.bank_name || p.remarks?.includes('[Paid via')) && (
                                                        <span className="text-[10px] font-bold text-blue-800 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                                                            {p.payment_details?.bank_name || p.remarks?.match(/\[Paid via ([^\]]+)\]/)?.[1] || 'Bank Transfer'}
                                                        </span>
                                                    )}
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
                                                    <span className="uppercase text-[10px] font-bold px-2 py-0.5 rounded-full bg-white border border-blue-200 text-blue-800">
                                                        {p.payment_type === 'bank' ? `🏦 Bank${p.payment_details?.bank_name ? ` (${p.payment_details.bank_name})` : ''}` : p.payment_type}
                                                    </span>
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
                                                                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100 text-[11px]">
                                                                    <div>
                                                                        <span className="text-gray-400 block text-[10px]">Purchase Price</span>
                                                                        <span className="font-semibold text-gray-700">Rs. {Number(it.base_cost || 0).toLocaleString()}</span>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-gray-400 block text-[10px]">Direct Cost (Courier)</span>
                                                                        <span className={`font-semibold ${Number(it.direct_cost) > 0 ? 'text-amber-600 font-bold' : 'text-gray-500'}`}>
                                                                            Rs. {Number(it.direct_cost || 0).toLocaleString()}
                                                                        </span>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-gray-400 block text-[10px]">Total Cost</span>
                                                                        <span className="font-bold text-gray-900">Rs. {Number(it.total_cost || 0).toLocaleString()}</span>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-gray-400 block text-[10px]">Target Sale Price</span>
                                                                        <span className="font-semibold text-blue-700">
                                                                            {it.sale_price > 0 ? `Rs. ${Number(it.sale_price).toLocaleString()}` : '—'}
                                                                        </span>
                                                                    </div>
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
                                                                            p.payment_type === 'cash' ? 'bg-green-100 text-green-700' : p.payment_type === 'bank' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                                                                        }`}>
                                                                            {p.payment_type === 'bank' ? `🏦 Bank${p.payment_details?.bank_name ? ` (${p.payment_details.bank_name})` : ''}` : p.payment_type}
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
                                                                                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100 text-xs">
                                                                                    <div>
                                                                                        <span className="text-gray-400 block text-[10px]">Purchase Price</span>
                                                                                        <span className="font-semibold text-gray-700">Rs. {Number(it.base_cost || 0).toLocaleString()}</span>
                                                                                    </div>
                                                                                    <div>
                                                                                        <span className="text-gray-400 block text-[10px]">Direct Cost (Courier)</span>
                                                                                        <span className={`font-semibold ${Number(it.direct_cost) > 0 ? 'text-amber-600 font-bold' : 'text-gray-500'}`}>
                                                                                            Rs. {Number(it.direct_cost || 0).toLocaleString()}
                                                                                        </span>
                                                                                    </div>
                                                                                    <div>
                                                                                        <span className="text-gray-400 block text-[10px]">Total Cost</span>
                                                                                        <span className="font-bold text-gray-900">Rs. {Number(it.total_cost || 0).toLocaleString()}</span>
                                                                                    </div>
                                                                                    <div>
                                                                                        <span className="text-gray-400 block text-[10px]">Target Sale Price</span>
                                                                                        <span className="font-semibold text-blue-700">
                                                                                            {it.sale_price > 0 ? `Rs. ${Number(it.sale_price).toLocaleString()}` : '—'}
                                                                                        </span>
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
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
                        <div className="bg-white/95 dark:bg-[#1c1c1e]/95 backdrop-blur-2xl rounded-[26px] shadow-[0_20px_60px_rgba(0,0,0,0.3)] border border-black/[0.08] dark:border-white/[0.12] w-full max-w-3xl max-h-[92dvh] overflow-y-auto flex flex-col p-4 sm:p-6 text-gray-900 dark:text-gray-100">
                            <div className="flex justify-between items-start mb-4 pb-3 border-b border-black/[0.06] dark:border-white/[0.08]">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-[14px] bg-[#ff9500]/12 text-[#ff9500] dark:bg-[#ff9500]/25 dark:text-[#ffaa33] flex items-center justify-center font-bold text-lg shrink-0 shadow-2xs">
                                        📦
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h2 className="text-base sm:text-lg font-black text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">
                                                Purchase Invoice PR-{String(selectedPurchase.id).slice(-8)}
                                            </h2>
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
                                                Inward Stock
                                            </span>
                                        </div>
                                        <p className="text-xs text-[#86868b] dark:text-[#98989d] mt-0.5 flex items-center gap-2 flex-wrap">
                                            <span>{new Date(selectedPurchase.created_at).toLocaleString("en-PK")}</span>
                                            <span>•</span>
                                            <span className="font-semibold text-gray-800 dark:text-gray-200">{selectedPurchase.suppliers?.name || "Direct / Walk-in Supplier"}</span>
                                            <span>•</span>
                                            <span className="font-bold text-[#ff9500] dark:text-[#ffaa33]">
                                                {selectedPurchase.payment_type?.toUpperCase()}
                                            </span>
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setSelectedPurchase(null)}
                                    className="w-8 h-8 rounded-full bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.1] dark:hover:bg-white/[0.15] text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-white flex items-center justify-center transition cursor-pointer text-lg font-bold shrink-0"
                                >
                                    ×
                                </button>
                            </div>

                            {/* Info Grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4 p-3.5 rounded-[18px] bg-slate-50/80 dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] text-xs">
                                <div>
                                    <span className="text-[#86868b] dark:text-gray-400 font-bold uppercase text-[10px] tracking-wider block">Supplier Info</span>
                                    <b className="text-gray-900 dark:text-white block mt-0.5">{selectedPurchase.suppliers?.name || "Direct / Walk-in Supplier"}</b>
                                    {selectedPurchase.suppliers?.phone && (
                                        <span className="text-[11px] text-[#0071e3] dark:text-[#3894ff] block font-medium mt-0.5">📞 {selectedPurchase.suppliers.phone}</span>
                                    )}
                                    {selectedPurchase.suppliers?.address && (
                                        <span className="text-[10px] text-[#86868b] block truncate mt-0.5">📍 {selectedPurchase.suppliers.address}</span>
                                    )}
                                </div>
                                <div>
                                    <span className="text-[#86868b] dark:text-gray-400 font-bold uppercase text-[10px] tracking-wider block">Purchase Date</span>
                                    <b className="text-gray-800 dark:text-gray-200 block mt-0.5">{new Date(selectedPurchase.created_at).toLocaleString("en-PK")}</b>
                                    {selectedPurchase.remarks && (
                                        <p className="text-[10px] text-[#86868b] italic mt-0.5 truncate" title={selectedPurchase.remarks}>
                                            Note: {selectedPurchase.remarks}
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <span className="text-[#86868b] dark:text-gray-400 font-bold uppercase text-[10px] tracking-wider block">Total Amount</span>
                                    <b className="text-sm font-black text-gray-900 dark:text-white block mt-0.5">Rs. {Number(selectedPurchase.total_amount).toLocaleString()}</b>
                                    {selectedPurchase.paid_amount != null && (
                                        <span className="text-[11px] text-[#86868b] block mt-0.5">
                                            Paid: Rs. {Number(selectedPurchase.paid_amount).toLocaleString()}
                                        </span>
                                    )}
                                </div>
                                <div>
                                    <span className="text-[#86868b] dark:text-gray-400 font-bold uppercase text-[10px] tracking-wider block">Payment Method</span>
                                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                        <span className={"uppercase px-2 py-0.5 rounded-full text-[10px] font-bold " + (
                                            selectedPurchase.payment_type === "cash"
                                                ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300"
                                                : selectedPurchase.payment_type === "bank"
                                                    ? "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300"
                                                    : "bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300"
                                        )}>
                                            {selectedPurchase.payment_type === "bank" ? "🏦 Bank" + (selectedPurchase.payment_details?.bank_name ? " (" + selectedPurchase.payment_details.bank_name + ")" : "") : selectedPurchase.payment_type}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setPurchaseToEditPayment(selectedPurchase)}
                                            className="px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-[10px] font-bold hover:bg-purple-200 transition cursor-pointer"
                                        >
                                            ✏️ Edit
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {loadingItems ? (
                                <div className="text-center py-12 flex flex-col items-center justify-center gap-2">
                                    <div className="w-8 h-8 border-2 border-[#ff9500] border-t-transparent rounded-full animate-spin" />
                                    <p className="text-xs text-[#86868b] font-medium">Loading purchase items...</p>
                                </div>
                            ) : (
                                <>
                                    <div className="overflow-x-auto rounded-[16px] border border-black/[0.06] dark:border-white/[0.08] mb-4">
                                        <table className="w-full text-xs">
                                            <thead className="bg-[#f5f5f7] dark:bg-white/[0.04] text-[#86868b] dark:text-gray-400 font-bold uppercase tracking-wider text-[10px]">
                                                <tr>
                                                    <th className="px-3.5 py-2.5 text-left whitespace-nowrap">Product / Item</th>
                                                    <th className="px-3.5 py-2.5 text-right whitespace-nowrap">Purchase Price</th>
                                                    <th className="px-3.5 py-2.5 text-right text-amber-600 dark:text-amber-400 whitespace-nowrap">Direct Cost</th>
                                                    <th className="px-3.5 py-2.5 text-right whitespace-nowrap">Total Cost</th>
                                                    <th className="px-3.5 py-2.5 text-right text-[#0071e3] dark:text-[#3894ff] whitespace-nowrap">Target Sale</th>
                                                    <th className="px-3.5 py-2.5 text-right whitespace-nowrap">Qty</th>
                                                    <th className="px-3.5 py-2.5 text-right whitespace-nowrap">Amount</th>
                                                    <th className="px-3.5 py-2.5 text-center whitespace-nowrap">Ret. Qty</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                                                {purchaseItems.map((item, idx) => {
                                                    const maxReturn = item.quantity - (item.returned_qty || 0)
                                                    return (
                                                        <tr key={idx} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                                                            <td className="px-3.5 py-2.5 text-gray-800 dark:text-gray-200">
                                                                <p className="font-bold text-gray-900 dark:text-gray-100">
                                                                    {item.display_name || item.product_name || (item.phones ? ((item.phones.brand && item.phones.brand !== "Unknown" ? item.phones.brand + " " : "") + (item.phones.model || "Phone")) : "Item")}
                                                                </p>
                                                                {item.specs && <p className="text-[11px] text-[#86868b] mt-0.5">{item.specs}</p>}
                                                                {(item.imei || item.phones?.imei_1) && (
                                                                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                                        <span className="font-mono text-[10px] bg-[#0071e3]/10 text-[#0071e3] dark:text-[#3894ff] border border-[#0071e3]/20 px-1.5 py-0.2 rounded-md font-semibold">
                                                                            IMEI: {item.imei || item.phones?.imei_1}
                                                                        </span>
                                                                        {(item.imei2 || item.phones?.imei_2) && (
                                                                            <span className="font-mono text-[10px] bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 border border-black/[0.08] dark:border-white/[0.1] px-1 py-0.2 rounded-md">
                                                                                IMEI 2: {item.imei2 || item.phones?.imei_2}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td className="px-3.5 py-2.5 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap font-medium">Rs. {Number(item.base_cost || item.unit_price || 0).toLocaleString()}</td>
                                                            <td className="px-3.5 py-2.5 text-right whitespace-nowrap font-medium text-amber-600 dark:text-amber-400">
                                                                {Number(item.direct_cost || 0) > 0 ? "Rs. " + Number(item.direct_cost).toLocaleString() : "—"}
                                                            </td>
                                                            <td className="px-3.5 py-2.5 text-right text-gray-900 dark:text-white whitespace-nowrap font-bold">Rs. {Number(item.total_cost || item.unit_price || 0).toLocaleString()}</td>
                                                            <td className="px-3.5 py-2.5 text-right text-[#0071e3] dark:text-[#3894ff] whitespace-nowrap font-bold">
                                                                {Number(item.sale_price || 0) > 0 ? "Rs. " + Number(item.sale_price).toLocaleString() : "—"}
                                                            </td>
                                                            <td className="px-3.5 py-2.5 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                                                {item.quantity}
                                                                {item.returned_qty > 0 && <span className="text-[10px] text-red-500 block">(-{item.returned_qty} ret)</span>}
                                                            </td>
                                                            <td className="px-3.5 py-2.5 text-right font-extrabold text-gray-900 dark:text-white whitespace-nowrap">Rs. {Number(item.total_price || item.line_total || ((item.total_cost || item.unit_price || 0) * item.quantity)).toFixed(0)}</td>
                                                            <td className="px-3.5 py-2.5 text-center whitespace-nowrap">
                                                                {maxReturn > 0 ? (
                                                                    <input
                                                                        type="number"
                                                                        min="0"
                                                                        max={maxReturn}
                                                                        value={returnQtys[item.id] || ""}
                                                                        onChange={e => setReturnQtys(prev => ({ ...prev, [item.id]: e.target.value }))}
                                                                        className="w-16 border border-black/[0.1] dark:border-white/[0.15] bg-white dark:bg-[#2c2c2e] rounded-lg px-2 py-1 text-center text-xs font-bold"
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
                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-t border-black/[0.06] dark:border-white/[0.08] pt-3 mt-2 gap-3">
                                        <div className="text-xs">
                                            <p className="text-[#86868b] dark:text-gray-400">
                                                Total Amount: <b className="text-sm font-black text-gray-900 dark:text-white ml-1">Rs. {Number(selectedPurchase.total_amount).toLocaleString()}</b>
                                            </p>
                                            {selectedPurchase.paid_amount != null && (
                                                <p className="text-[11px] text-[#86868b] dark:text-gray-400">
                                                    Paid Amount: <b className="text-gray-800 dark:text-gray-200">Rs. {Number(selectedPurchase.paid_amount).toLocaleString()}</b>
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                onClick={() => printPurchase(selectedPurchase, purchaseItems)}
                                                className="px-4 py-2 bg-[#0071e3] hover:bg-[#0077ed] text-white rounded-xl text-xs font-bold transition shadow-2xs active:scale-95 cursor-pointer flex items-center gap-1.5"
                                            >
                                                🖨️ Print Invoice
                                            </button>
                                            <button
                                                onClick={handleReturn}
                                                disabled={returning}
                                                className="px-4 py-2 bg-[#ff3b30] hover:bg-[#e0352b] text-white rounded-xl text-xs font-bold transition shadow-2xs active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                                            >
                                                {returning ? "Processing..." : "↩️ Process Return"}
                                            </button>
                                            <button
                                                onClick={() => setSelectedPurchase(null)}
                                                className="px-4 py-2 bg-black/[0.05] dark:bg-white/[0.1] hover:bg-black/[0.08] dark:hover:bg-white/[0.15] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer"
                                            >
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
