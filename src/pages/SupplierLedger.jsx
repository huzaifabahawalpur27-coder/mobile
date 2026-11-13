import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db, addToSyncQueue } from '../services/db'
import { adjustSupplierBalance, adjustProductStock, releasePhoneFromPurchase } from '../services/atomicOps'
import { getBankAccounts, creditBankBalance, deductBankBalance } from '../services/bankService'
import { supplierLedgerEffect, netAmount, paidAmount, unusualAmount, isCashName } from '../utils/moneyMath'
import { applyMoneyOp, accountForMode, deleteBillPayments } from '../services/moneyOps'
import EditLedgerEntryModal from '../components/EditLedgerEntryModal'
import { hasFeature } from '../utils/featureGate'
import UpgradeWall from '../components/UpgradeWall'
import EditPurchasePaymentModal from '../components/EditPurchasePaymentModal'
import PhoneReturnModal from '../components/PhoneReturnModal'
import { printHTML, getShopBranding, brandedA4Header } from '../utils/printUtils'
import { getPtaBadge } from '../components/PhoneInventoryView'
import {
    Smartphone, Search, Copy, Check, Filter,
    Layers, HardDrive, Sparkles, Tag,
    Printer, FileText, RotateCcw, CreditCard, ChevronDown, ChevronUp
} from 'lucide-react'
import { notify } from '../utils/toast'
import { confirmDialog, confirmUnusualAmount } from '../utils/dialog'

function SupplierLedger() {
    const { id } = useParams()
    const { user } = useAuth()
    const navigate = useNavigate()
    const location = useLocation()
    const importRef = useRef()

    const [supplier, setSupplier] = useState(null)
    const [loading, setLoading] = useState(true)
    const [ledger, setLedger] = useState([])
    const [showModal, setShowModal] = useState(false)
    const [saving, setSaving] = useState(false)
    const [expandedBill, setExpandedBill] = useState(null)
    const [selectedIds, setSelectedIds] = useState(new Set())

    // Tabs: 'statement' | 'purchases' | 'phones'
    const [activeTab, setActiveTab] = useState('statement')
    const [supplierPhones, setSupplierPhones] = useState([])
    const [purchasesList, setPurchasesList] = useState([])

    // Modals
    const [purchaseToEditPayment, setPurchaseToEditPayment] = useState(null)
    const [phoneForReturn, setPhoneForReturn] = useState(null)
    const [copiedImei, setCopiedImei] = useState(null)

    // Phones search and status filter
    const [phoneSearch, setPhoneSearch] = useState('')
    const [phoneStatusFilter, setPhoneStatusFilter] = useState('all') // all | in_stock | sold | returned

    // Filters
    const [search, setSearch] = useState('')
    const [filterType, setFilterType] = useState('all')   // all | debit | payment | purchase | return
    const [filterFrom, setFilterFrom] = useState('')
    const [filterTo, setFilterTo] = useState('')

    // Transaction entry form
    const [txMode, setTxMode] = useState('both') // 'purchase' | 'payment' | 'both'
    const [txForm, setTxForm] = useState({
        bill_number: '',
        date: new Date().toISOString().slice(0, 10),
        purchase_amount: '',
        paid_amount: '',
        details: '',
        payment_mode: 'cash',
        transaction_ref: '',
        note: ''
    })

    useEffect(() => {
        if (id && user?.shop_id) fetchSupplierData()
    }, [id, user?.shop_id])

    const fetchSupplierData = async () => {
        setLoading(true)
        try {
            if (!navigator.onLine) throw new Error('Offline')

            const fetchPromise = Promise.all([
                supabase.from('suppliers').select('*').eq('id', id).maybeSingle(),
                supabase.from('purchases').select('*, purchase_items(*, phones(*))').eq('supplier_id', id).order('created_at', { ascending: false }),
                supabase.from('supplier_payments').select('*').eq('supplier_id', id).order('created_at', { ascending: false }),
                supabase.from('phones').select('*').eq('supplier_id', id).order('created_at', { ascending: false })
            ])
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 4000))
            const [supRes, purchasesRes, paymentsRes, phonesRes] = await Promise.race([fetchPromise, timeoutPromise])

            setSupplier(supRes.data)
            setPurchasesList(purchasesRes.data || [])
            setSupplierPhones(phonesRes.data || [])
            buildLedger(purchasesRes.data || [], paymentsRes.data || [], phonesRes.data || [])
        } catch (e) {
            console.log('SupplierLedger: Reconstructing from local DB (Offline)')
            try {
                const [lSups, lPurchases, lItems, lPayments, lPhones] = await Promise.all([
                    db.suppliers.toArray(),
                    db.purchases.toArray(),
                    db.purchase_items.toArray(),
                    db.supplier_payments.toArray(),
                    db.phones ? db.phones.toArray() : []
                ])
                const sup = lSups.find(s => String(s.id) === String(id))
                if (sup) setSupplier(sup)
                const myPurchases = lPurchases.filter(p => String(p.supplier_id) === String(id))
                const myPayments = lPayments.filter(p => String(p.supplier_id) === String(id))
                const myPhones = (lPhones || []).filter(p => String(p.supplier_id) === String(id))
                setPurchasesList(myPurchases)
                setSupplierPhones(myPhones)
                buildLedger(
                    myPurchases.map(p => ({
                        ...p,
                        purchase_items: lItems.filter(i => i.purchase_id === p.id).map(it => {
                            const ph = myPhones.find(ph => ph.id === it.phone_id || ph.purchase_id === p.id)
                            return { ...it, phones: it.phones || ph }
                        })
                    })),
                    myPayments,
                    myPhones
                )
            } catch (err) { console.error('SupplierLedger Fallback Error:', err) }
        } finally { setLoading(false) }
    }

    const buildLedger = (purchases, payments, currentPhones = []) => {
        const phonesPool = currentPhones.length > 0 ? currentPhones : supplierPhones
        const combined = [
            ...purchases.map(p => ({
                id: p.id,
                date: p.created_at,
                type: 'purchase',
                payment_type: p.payment_type,
                bill_number: '',
                // Bill after discount: that is what the supplier is owed for it
                amount: netAmount(p),
                paid_amount: paidAmount(p),
                note: `Bill #${String(p.id).slice(-8)}`,
                items: (p.purchase_items || []).map(it => {
                    const ph = it.phones || (phonesPool || []).find(sp => sp.id === it.phone_id || sp.purchase_id === p.id)
                    const name = it.product_name || (ph ? `${ph.brand && ph.brand !== 'Unknown' ? ph.brand + ' ' : ''}${ph.model || 'Smartphone'}` : 'Item')
                    const specs = ph ? [ph.storage, ph.color, ph.pta_status ? ph.pta_status.toUpperCase() : null].filter(Boolean).join(' • ') : null
                    const imei = ph ? (ph.imei_1 || ph.imei1 || ph.imei) : null
                    const price = it.unit_price || it.cost_price || it.subtotal || 0
                    const qty = it.quantity || 1
                    return {
                        ...it,
                        phones: ph,
                        display_name: name,
                        specs,
                        imei,
                        unit_price: price,
                        quantity: qty
                    }
                })
            })),
            ...payments.filter(p => {
                const desc = `${p.note || ''} ${p.description || ''} ${p.details || ''}`.toLowerCase()
                return !desc.includes('(credit)')
            }).map(p => {
                const billFromNote = p.note?.match(/\[Bill #([^\]]+)\]/)?.[1] || ''
                return {
                    id: p.id,
                    date: p.created_at,
                    type: p.payment_type === 'debit' ? 'debit' : p.payment_type === 'return' ? 'return' : 'payment',
                    payment_type: p.payment_type,
                    bill_number: p.bill_number || billFromNote || '',
                    amount: p.amount,
                    note: p.note || (p.payment_type === 'debit' ? 'Manual Purchase Entry' : 'Cash Payment'),
                    details: p.details || null,
                    payment_mode: p.payment_mode || null,
                    transaction_ref: p.transaction_ref || null,
                    items: []
                }
            })
        ]
        combined.sort((a, b) => new Date(a.date) - new Date(b.date))

        // Check for opening dues / payable difference
        const currentSupDue = Number(supplier?.outstanding_balance ?? supplier?.balance ?? 0)
        const netTx = combined.reduce((acc, item) => acc + supplierLedgerEffect(item), 0)
        const openingSupDues = currentSupDue - netTx
        if (Math.abs(openingSupDues) >= 1) {
            combined.unshift({
                id: 'opening-balance',
                date: supplier?.created_at || (combined[0]?.date ? new Date(new Date(combined[0].date).getTime() - 60000).toISOString() : new Date().toISOString()),
                type: openingSupDues > 0 ? 'debit' : 'payment',
                payment_type: openingSupDues > 0 ? 'debit' : 'payment',
                amount: Math.abs(openingSupDues),
                note: openingSupDues > 0 ? 'Opening Balance (Previous Supplier Payable)' : 'Opening Credit (Advance Paid)',
                items: []
            })
        }

        let running = 0
        const withBalance = combined.map(item => {
            running += supplierLedgerEffect(item)
            return { ...item, balance: running }
        })
        setLedger(withBalance.reverse())
    }

    // ── Computed preview for transaction entry ──────────────────────────────────
    const prevBalance = ledger.length > 0 ? ledger[0].balance : (supplier?.outstanding_balance || 0)
    const rawPurchaseAmt = parseFloat(txForm.purchase_amount) || 0
    const rawPaidAmt = parseFloat(txForm.paid_amount) || 0
    const purchaseAmt = txMode === 'payment' ? 0 : rawPurchaseAmt
    const paidAmt = txMode === 'purchase' ? 0 : rawPaidAmt
    const newBalance = prevBalance + purchaseAmt - paidAmt

    // Balance changes are sent as amounts the database adds (queued when offline), so two
    // devices or a stale screen cannot overwrite the supplier's balance.
    const changeBalance = async (delta) => {
        const d = Number(delta) || 0
        if (d === 0) return true
        const res = await adjustSupplierBalance(id, d)
        if (!res.ok) {
            console.error('Supplier balance not updated:', res.error)
            notify(`Saved, but the supplier's balance could not be changed by Rs. ${d.toLocaleString()} (${res.error}). Please check it.`)
            return false
        }
        setSupplier(sup => sup ? { ...sup, outstanding_balance: (Number(sup.outstanding_balance) || 0) + d, balance: (Number(sup.outstanding_balance) || 0) + d } : sup)
        return true
    }

    // Deleting a purchase takes its stock out again and marks its phones returned (only
    // phones still from this purchase and in stock; a sold or re-bought phone is left alone)
    const rollbackPurchaseInventory = async (item) => {
        let pItems = []
        if (navigator.onLine) {
            const { data } = await supabase.from('purchase_items').select('*').eq('purchase_id', item.id)
            pItems = data || []
        } else {
            const localPItems = await db.purchase_items.toArray()
            pItems = localPItems.filter(i => String(i.purchase_id) === String(item.id))
        }
        for (const pi of pItems) {
            if (pi.phone_id) {
                if (navigator.onLine) {
                    const phoneRes = await releasePhoneFromPurchase(pi.phone_id, item.id, { status: 'returned', purchase_id: null })
                    if (phoneRes.skipped) console.warn('Delete purchase: phone left unchanged -', phoneRes.skipped)
                } else if (db.phones) {
                    await db.phones.update(pi.phone_id, { status: 'returned', purchase_id: null }).catch(() => {})
                }
            }
            if (pi.product_id) {
                const qty = (Number(pi.quantity ?? 1) || 0) - (Number(pi.returned_qty) || 0)
                const stockRes = await adjustProductStock(pi.product_id, -qty)
                if (!stockRes.ok) console.warn('Delete purchase: stock not reduced for product', pi.product_id, stockRes.error)
            }
        }
    }

    // The computed "opening balance" row is not a stored entry
    const isOpeningRow = (item) => String(item?.id ?? '').startsWith('opening')

    // ── Correct a manual entry (payment / debit) without deleting it ──────────
    const [editEntry, setEditEntry] = useState(null)
    const [savingEdit, setSavingEdit] = useState(false)
    const canEditEntry = (item) =>
        !isOpeningRow(item) && /^\d+$/.test(String(item.id)) &&
        // a payment saved with a purchase bill is corrected from the bill (Edit Payment), not here
        !/\[Paid via|\[Credit Purchase|Payment for Phone Purchase/i.test(item.note || '') &&
        (item.type === 'debit' || (item.type === 'payment' && (item.payment_type === 'payment' || !item.payment_type)))

    const handleSaveEntryEdit = async ({ amount, note, reason }) => {
        const item = editEntry
        if (!item) return
        const oldAmount = Math.abs(Number(item.amount) || 0)
        const diff = Math.round((amount - oldAmount) * 100) / 100
        const isPayment = item.type === 'payment'
        setSavingEdit(true)
        try {
            let account = null
            if (isPayment && diff !== 0) {
                try { account = accountForMode(await getBankAccounts(user.shop_id), item.payment_mode) } catch (_) { /* no accounts set up */ }
            }
            const stamp = new Date().toISOString().slice(0, 10)
            const newNote = `${note || item.note || ''} [Corrected ${stamp}: was Rs. ${oldAmount.toLocaleString()}. Reason: ${reason}]`.trim()
            // Entry, balance and account change together: all or nothing
            const res = await applyMoneyOp({
                shop_id: user.shop_id,
                updates: [{ table: 'supplier_payments', id: item.id, set: { amount, note: newNote } }],
                // a debit adds to the balance, a payment takes off it
                supplier: { id, delta: isPayment ? -diff : diff },
                accounts: account ? [{
                    account_id: account.id,
                    delta: -diff,
                    reference_type: 'SUPPLIER_PAYMENT_EDIT',
                    reference_id: String(item.id),
                    description: `Corrected payment: ${supplier?.name || 'Supplier'} (was Rs. ${oldAmount.toLocaleString()}, now Rs. ${amount.toLocaleString()})`
                }] : []
            })
            if (!res.ok) throw new Error(res.error || 'Could not save the correction')
            setEditEntry(null)
            fetchSupplierData()
            if (res.queued) notify('Offline: correction saved on this device and will sync when online.')
        } catch (err) {
            notify('Correction not saved: ' + (err?.message || String(err)))
        } finally {
            setSavingEdit(false)
        }
    }


    // Balance effect of removing a ledger entry. Deleting a purchase gives the money paid
    // for it back to the shop's account (see refundPurchasePayment), so only the unpaid
    // part of the bill comes off what the shop owes.
    const deletionDelta = (item) => {
        if (item.type === 'purchase') return -(Number(item.amount || 0) - Number(item.paid_amount || 0))
        return -supplierLedgerEffect(item)
    }

    // Money paid for a purchase goes back into the cash / bank account when it is deleted
    const refundPurchasePayment = async (item) => {
        const paid = Number(item.paid_amount || 0)
        if (!(paid > 0)) return
        const accounts = await getBankAccounts(user.shop_id)
        const method = String(item.payment_type || item.payment_mode || 'cash').toLowerCase()
        const isBank = method === 'bank' || method === 'online'
        const targetAcc = accounts.find(a =>
            isBank
                ? (!isCashName(a.bank_name) && !isCashName(a.account_name))
                : (isCashName(a.bank_name) || isCashName(a.account_name))
        ) || accounts[0]
        if (targetAcc) {
            await creditBankBalance({
                shopId: user.shop_id,
                accountId: targetAcc.id,
                amount: paid,
                referenceType: 'PURCHASE_DELETION',
                referenceId: String(item.id),
                description: `Purchase Deletion Refund (${item.id})`
            })
        }
    }

    // ── Submit transaction ──────────────────────────────────────────────────────
    const handleSubmitTransaction = async (e) => {
        e.preventDefault()
        if (purchaseAmt === 0 && paidAmt === 0) {
            notify('Enter a purchase amount, a paid amount, or both.')
            return
        }

        // Catch an extra digit before it is saved
        const pastAmounts = (kind) => ledger.filter(l => l.type === kind).map(l => l.amount)
        if (!await confirmUnusualAmount(purchaseAmt, unusualAmount(purchaseAmt, pastAmounts('debit').concat(pastAmounts('purchase'))), 'Purchase amount')) return
        if (!await confirmUnusualAmount(paidAmt, unusualAmount(paidAmt, pastAmounts('payment')), 'Payment to supplier')) return
        setSaving(true)
        const now = txForm.date ? new Date(txForm.date + 'T12:00:00').toISOString() : new Date().toISOString()

        try {
            const commonFields = {
                supplier_id: id,
                bill_number: txForm.bill_number.trim() || null,
                details: txForm.details.trim() || null,
                payment_mode: txForm.payment_mode || null,
                transaction_ref: txForm.transaction_ref.trim() || null,
                created_at: now
            }
            const rows = []
            if (purchaseAmt > 0) rows.push({ ...commonFields, amount: purchaseAmt, payment_type: 'debit', note: txForm.note.trim() || 'Purchase Entry' })
            if (paidAmt > 0) rows.push({ ...commonFields, amount: paidAmt, payment_type: 'payment', note: txForm.note.trim() || 'Payment to Supplier' })

            // Money paid leaves the cash / bank account for its payment mode
            let account = null
            if (paidAmt > 0) {
                try { account = accountForMode(await getBankAccounts(user.shop_id), txForm.payment_mode) } catch (_) { /* no accounts set up */ }
            }
            // Entry, supplier balance and account are saved together: all or nothing
            const res = await applyMoneyOp({
                shop_id: user.shop_id,
                inserts: rows.map(r => ({
                    table: 'supplier_payments',
                    row: r,
                    // older databases keep only a description column
                    fallbackRow: {
                        shop_id: user.shop_id,
                        supplier_id: r.supplier_id,
                        amount: r.amount,
                        description: [r.bill_number ? `[Bill #${r.bill_number}]` : '', r.payment_type ? `[${r.payment_type}]` : '', r.note, r.details].filter(Boolean).join(' ') || 'Transaction',
                        created_at: r.created_at
                    }
                })),
                supplier: { id, delta: purchaseAmt - paidAmt },
                accounts: account ? [{
                    account_id: account.id,
                    delta: -paidAmt,
                    reference_type: 'SUPPLIER_PAYMENT',
                    reference_id: String(id),
                    description: `Supplier Payment: ${supplier?.name || 'Supplier'} (Bill: ${txForm.bill_number || 'Ledger'})`
                }] : []
            })
            if (!res.ok) throw new Error(res.error || 'Could not save the transaction')
            setSupplier(sup => sup ? { ...sup, outstanding_balance: (Number(sup.outstanding_balance) || 0) + purchaseAmt - paidAmt, balance: (Number(sup.outstanding_balance) || 0) + purchaseAmt - paidAmt } : sup)
            if (res.queued) notify('Saved on this device. It syncs when you are back online.', 'info')
            else if (res.problems?.length) notify(`Saved, but please check:\n${res.problems.join('\n')}`)
            else notify('Transaction saved.', 'success')
            resetForm()
            fetchSupplierData()
        } catch (error) {
            notify('Error: ' + (error?.message || String(error)))
        } finally { setSaving(false) }
    }

    const resetForm = () => {
        setTxForm({ bill_number: '', date: new Date().toISOString().slice(0, 10), purchase_amount: '', paid_amount: '', details: '', payment_mode: 'cash', transaction_ref: '', note: '' })
        setTxMode('both')
        setShowModal(false)
    }

    // ── Delete Transaction ──────────────────────────────────────────────────────
    const handleDeleteTransaction = async (item) => {
        if (isOpeningRow(item)) { notify('The opening balance row cannot be deleted. Use Reconcile to change it.'); return }
        const typeLabel = item.type === 'purchase' ? 'Purchase Order'
            : item.type === 'debit' ? 'Debit Entry'
            : item.type === 'payment' ? 'Payment'
            : 'Return'
        const confirmed = await confirmDialog(
            `Delete this ${typeLabel.toLowerCase()}?\nAmount: Rs. ${Number(item.amount).toLocaleString()}\nNote: ${item.note}\n\nThe supplier balance is adjusted to match.`, { confirmLabel: 'Delete entry', danger: true }
        )
        if (!confirmed) return

        try {
            if (item.type === 'purchase') {
                // 1. Rollback inventory and accounts before deleting purchase
                try {
                    await rollbackPurchaseInventory(item)
                    // Reverse Cash / Bank payment made for this purchase
                    await refundPurchasePayment(item)
                } catch (rollbackErr) {
                    console.warn('Rollback warning on purchase deletion:', rollbackErr)
                }

                // Cascade: delete purchase_items first, then purchase
                if (navigator.onLine) {
                    await supabase.from('purchase_items').delete().eq('purchase_id', item.id)
                    const { error } = await supabase.from('purchases').delete().eq('id', item.id)
                    if (error) throw error
                    // Payment / refund rows saved with this bill go with it
                    await deleteBillPayments(item.id).catch(() => {})
                } else {
                    const lItems = await db.purchase_items.toArray()
                    const toDelIds = lItems.filter(i => String(i.purchase_id) === String(item.id)).map(i => i.id)
                    await db.purchase_items.bulkDelete(toDelIds)
                    await db.purchases.delete(item.id)
                    await addToSyncQueue('purchases', 'DELETE', { id: item.id })
                }
            } else {
                // debit / payment / return — from supplier_payments table
                if (item.type === 'payment') {
                    const payAmt = Math.abs(Number(item.amount || 0))
                    if (payAmt > 0) {
                        try {
                            const accounts = await getBankAccounts(user.shop_id)
                            const mode = String(item.payment_mode || 'cash').toLowerCase()
                            const isBank = ['online', 'bank', 'jazzcash', 'easypaisa', 'sadapay', 'nayapay'].includes(mode)
                            const targetAcc = accounts.find(a =>
                                isBank
                                    ? (!isCashName(a.bank_name) && !isCashName(a.account_name))
                                    : (isCashName(a.bank_name) || isCashName(a.account_name))
                            ) || accounts[0]
                            if (targetAcc) {
                                await creditBankBalance({
                                    shopId: user.shop_id,
                                    accountId: targetAcc.id,
                                    amount: payAmt,
                                    referenceType: 'PAYMENT_DELETION',
                                    referenceId: String(item.id),
                                    description: `Deleted Supplier Payment Refund (${supplier?.name || 'Supplier'})`
                                })
                            }
                        } catch (accErr) {
                            console.warn('Could not refund deleted supplier payment:', accErr)
                        }
                    }
                }

                if (navigator.onLine) {
                    const { error } = await supabase.from('supplier_payments').delete().eq('id', item.id)
                    if (error) throw error
                } else {
                    await db.supplier_payments.delete(item.id)
                    await addToSyncQueue('supplier_payments', 'DELETE', { id: item.id })
                }
            }

            await changeBalance(deletionDelta(item))
            fetchSupplierData()
        } catch (err) {
            notify('Not deleted: ' + err.message, 'error')
        }
    }

    // ── Excel Export ────────────────────────────────────────────────────────────
    const handleExport = () => {
        const rows = [...ledger].reverse().map((item, idx) => ({
            'Sr#': idx + 1,
            'Date': new Date(item.date).toLocaleDateString('en-PK'),
            'Bill #': item.bill_number || (item.type === 'purchase' ? String(item.id).slice(-8) : ''),
            'Description': item.note,
            'Items': (item.items || []).map(i => {
                const name = i.display_name || i.product_name || 'Item'
                const sp = i.specs ? ` (${i.specs})` : ''
                const im = i.imei ? ` [IMEI: ${i.imei}]` : ''
                return `${name}${sp}${im}`
            }).join('; ') || item.details || '',
            'Type': item.type === 'purchase' || item.type === 'debit' ? 'Purchase/Debit' : item.type === 'payment' ? 'Payment' : 'Return',
            'Debit (Purchase)': (item.type === 'purchase' || item.type === 'debit') ? Number(item.amount) : '',
            'Credit (Payment)': (item.type !== 'purchase' && item.type !== 'debit') ? Math.abs(Number(item.amount)) : '',
            'Balance': Number(item.balance)
        }))
        const ws = XLSX.utils.json_to_sheet(rows)
        ws['!cols'] = [{ wch: 5 }, { wch: 14 }, { wch: 14 }, { wch: 25 }, { wch: 35 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 14 }]
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Ledger')
        const safeName = (supplier?.name || 'supplier').replace(/[^a-z0-9]/gi, '_')
        XLSX.writeFile(wb, `${safeName}_ledger.xlsx`)
    }

    // ── Excel Import ────────────────────────────────────────────────────────────
    const handleImport = async (e) => {
        const file = e.target.files[0]
        e.target.value = ''
        if (!file) return

        try {
            const data = await file.arrayBuffer()
            const wb = XLSX.read(data, { cellDates: true })
            const ws = wb.Sheets[wb.SheetNames[0]]
            const rows = XLSX.utils.sheet_to_json(ws, { raw: false, dateNF: 'yyyy-mm-dd' })

            if (!rows.length) { notify('The file has no rows.'); return }

            const confirmed = await confirmDialog(`Import ${rows.length} transactions?`, { confirmLabel: 'Import transactions' })
            if (!confirmed) return

            const insertRows = []
            let balanceDelta = 0

            for (const row of rows) {
                const debit = parseFloat(row['Debit (Purchase)'] ?? row['Debit'] ?? row['debit'] ?? 0) || 0
                const credit = parseFloat(row['Credit (Payment)'] ?? row['Credit'] ?? row['credit'] ?? 0) || 0
                const dateVal = row['Date'] || row['date'] || new Date().toLocaleDateString('en-PK')
                const billNo = String(row['Bill #'] ?? row['bill_number'] ?? '').trim() || null
                const note = String(row['Description'] ?? row['Note'] ?? row['note'] ?? '').trim()

                let parsedDate
                try {
                    if (dateVal instanceof Date && !isNaN(dateVal)) {
                        parsedDate = dateVal.toISOString()
                    } else if (typeof dateVal === 'number') {
                        // Excel serial number fallback (days since 1900-01-01)
                        const d = new Date(Math.round((dateVal - 25569) * 86400 * 1000))
                        parsedDate = d.toISOString()
                    } else {
                        parsedDate = new Date(dateVal).toISOString()
                    }
                } catch { parsedDate = new Date().toISOString() }

                if (debit > 0) {
                    insertRows.push({ shop_id: user.shop_id, supplier_id: id, amount: debit, payment_type: 'debit', bill_number: billNo, note: note || 'Imported Purchase', created_at: parsedDate })
                    balanceDelta += debit
                }
                if (credit > 0) {
                    insertRows.push({ shop_id: user.shop_id, supplier_id: id, amount: credit, payment_type: 'payment', bill_number: billNo, note: note || 'Imported Payment', created_at: parsedDate })
                    balanceDelta -= credit
                }
            }

            if (!insertRows.length) { notify('No usable rows found. Check the Debit and Credit columns.', 'error'); return }

            if (navigator.onLine) {
                let { error } = await supabase.from('supplier_payments').insert(insertRows)
                if (error && (error.message?.includes('column') || error.message?.includes('schema cache') || error.code === 'PGRST204' || error.code === '42703' || String(error.status) === '400')) {
                    const fallbackRows = insertRows.map(r => ({
                        shop_id: r.shop_id,
                        supplier_id: r.supplier_id,
                        amount: r.amount,
                        payment_type: r.payment_type,
                        note: [r.bill_number ? `[Bill #${r.bill_number}]` : '', r.note].filter(Boolean).join(' '),
                        created_at: r.created_at
                    }))
                    const retryRes = await supabase.from('supplier_payments').insert(fallbackRows)
                    error = retryRes.error

                    if (error && (error.message?.includes('column') || error.message?.includes('schema cache') || error.code === 'PGRST204' || error.code === '42703' || String(error.status) === '400')) {
                        const coreRows = insertRows.map(r => ({
                            shop_id: r.shop_id,
                            supplier_id: r.supplier_id,
                            amount: r.amount,
                            description: [r.bill_number ? `[Bill #${r.bill_number}]` : '', r.payment_type ? `[${r.payment_type}]` : '', r.note].filter(Boolean).join(' ') || 'Imported Transaction',
                            created_at: r.created_at
                        }))
                        const coreRetry = await supabase.from('supplier_payments').insert(coreRows)
                        error = coreRetry.error
                    }
                }
                if (error) throw error
                await changeBalance(balanceDelta)
            } else {
                for (const row of insertRows) {
                    const rec = { ...row, id: crypto.randomUUID() }
                    await db.supplier_payments.add(rec)
                    await addToSyncQueue('supplier_payments', 'INSERT', rec)
                }
                await changeBalance(balanceDelta)
            }

            notify(`${insertRows.length} entries imported.`, 'success')
            fetchSupplierData()
        } catch (err) {
            console.error('Import error:', err)
            notify('Import failed: ' + err.message)
        }
    }

    // ── Apply filters ──────────────────────────────────────────────────────────
    const filteredLedger = ledger.filter(item => {
        const q = search.trim().toLowerCase()
        if (q) {
            const inNote = item.note?.toLowerCase().includes(q)
            const inBill = (item.bill_number || '').toLowerCase().includes(q)
            const inAmount = String(item.amount).includes(q)
            if (!inNote && !inBill && !inAmount) return false
        }
        if (filterType !== 'all' && item.type !== filterType) return false
        const itemDate = new Date(item.date)
        if (filterFrom && itemDate < new Date(filterFrom)) return false
        if (filterTo && itemDate > new Date(filterTo + 'T23:59:59')) return false
        return true
    })
    const isFiltered = search || filterType !== 'all' || filterFrom || filterTo

    // ── Bulk select helpers ────────────────────────────────────────────────────
    const allSelected = filteredLedger.length > 0 && filteredLedger.every(item => selectedIds.has(item.id))

    const toggleSelect = (itemId) => {
        setSelectedIds(prev => {
            const next = new Set(prev)
            next.has(itemId) ? next.delete(itemId) : next.add(itemId)
            return next
        })
    }
    const toggleSelectAll = () => {
        if (allSelected) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(filteredLedger.map(i => i.id)))
        }
    }

    const handleClearAllLedger = async () => {
        if (!ledger.length) return
        if (!await confirmDialog(`Delete all ${ledger.length} ledger entries?\nThe supplier balance becomes zero. This is needed before the supplier can be deleted.`, { confirmLabel: 'Delete all entries', danger: true })) return
        await _doDeleteItems(ledger)
    }

    const handleBulkDelete = async () => {
        const toDelete = ledger.filter(item => selectedIds.has(item.id) && !isOpeningRow(item))
        if (!toDelete.length) return
        if (!await confirmDialog(`Delete ${toDelete.length} transactions?\nThe supplier balance is adjusted to match.`, { confirmLabel: 'Delete transactions', danger: true })) return
        await _doDeleteItems(toDelete)
    }

    const _doDeleteItems = async (toDelete) => {
        // Reverse the effect of each deleted item, as one balance change at the end
        let totalDelta = 0
        const errors = []
        for (const item of toDelete) {
            try {
                if (item.type === 'purchase') {
                    // Stock and phones back out, as a single delete does (this used to be skipped)
                    try {
                        await rollbackPurchaseInventory(item)
                        await refundPurchasePayment(item)
                    } catch (rbErr) { console.warn('Rollback warning on bulk purchase deletion:', rbErr) }
                    if (navigator.onLine) {
                        await supabase.from('purchase_items').delete().eq('purchase_id', item.id)
                        const { error } = await supabase.from('purchases').delete().eq('id', item.id)
                        if (error) throw error
                    } else {
                        const lItems = await db.purchase_items.toArray()
                        const toDelIds = lItems.filter(i => String(i.purchase_id) === String(item.id)).map(i => i.id)
                        if (toDelIds.length) await db.purchase_items.bulkDelete(toDelIds)
                        await db.purchases.delete(item.id)
                        await addToSyncQueue('purchases', 'DELETE', { id: item.id })
                    }
                    totalDelta += deletionDelta(item)
                } else {
                    if (navigator.onLine) {
                        const { error } = await supabase.from('supplier_payments').delete().eq('id', item.id)
                        if (error) throw error
                    } else {
                        await db.supplier_payments.delete(item.id)
                        await addToSyncQueue('supplier_payments', 'DELETE', { id: item.id })
                    }
                    totalDelta += deletionDelta(item)
                }
            } catch (err) {
                errors.push(err.message)
            }
        }
        await changeBalance(totalDelta)
        setSelectedIds(new Set())
        if (errors.length) notify(`${errors.length} entries were not deleted:\n${errors.slice(0, 3).join('\n')}`, 'error')
        fetchSupplierData()
    }

    const handleReconcileBalance = async () => {
        if (!ledger.length && supplier?.outstanding_balance === 0) return
        const computedBalance = ledger.length > 0 ? ledger[0].balance : 0
        const confirmed = await confirmDialog(`Set the balance to match the ledger?\nSaved balance: Rs. ${supplier?.outstanding_balance || 0}\nLedger adds up to: Rs. ${computedBalance}`, { confirmLabel: 'Set balance' })
        if (!confirmed) return

        try {
            // Deliberately sets the exact ledger total
            const fixed = { outstanding_balance: computedBalance, balance: computedBalance }
            if (navigator.onLine) {
                const { error: recErr } = await supabase.from('suppliers').update(fixed).eq('id', id)
                if (recErr) throw recErr
            } else {
                await addToSyncQueue('suppliers', 'UPDATE', { id, ...fixed })
            }
            await db.suppliers.update(parseInt(id), fixed).catch(() => {})
            setSupplier(s => s ? { ...s, outstanding_balance: computedBalance, balance: computedBalance } : s)
            notify(`✅ Balance reconciled successfully to Rs. ${computedBalance}`)
        } catch (err) {
            notify('Reconcile error: ' + err.message)
        }
    }

    useEffect(() => {
        const params = new URLSearchParams(location.search)
        const tab = params.get('tab')
        if (tab && ['statement', 'purchases', 'phones'].includes(tab)) {
            setActiveTab(tab)
        }
    }, [location.search])

    const handleCopyImei = (imei) => {
        if (!imei) return
        navigator.clipboard.writeText(imei)
        setCopiedImei(imei)
        setTimeout(() => setCopiedImei(null), 2000)
    }

    const stats = React.useMemo(() => {
        let totalPurchases = 0
        let totalPayments = 0
        let totalReturns = 0

        ledger.forEach(item => {
            const amt = Number(item.amount) || 0
            if (item.type === 'purchase' || item.type === 'debit') {
                totalPurchases += amt
            } else if (item.type === 'payment') {
                totalPayments += amt
            } else if (item.type === 'return') {
                totalReturns += Math.abs(amt)
            }
        })

        const inStockPhones = (supplierPhones || []).filter(p => !p.status || p.status === 'in_stock' || p.status === 'available')
        const inStockCount = inStockPhones.length
        const inStockValue = inStockPhones.reduce((sum, p) => sum + (Number(p.cost_price || p.purchase_price) || 0), 0)

        const soldCount = (supplierPhones || []).filter(p => p.status === 'sold').length
        const returnedCount = (supplierPhones || []).filter(p => p.status === 'returned').length

        return {
            totalPurchases,
            totalPayments,
            totalReturns,
            currentBalance: Number(supplier?.outstanding_balance || 0),
            inStockCount,
            inStockValue,
            totalPhones: (supplierPhones || []).length,
            soldCount,
            returnedCount
        }
    }, [ledger, supplierPhones, supplier?.outstanding_balance])

    const filteredPhones = React.useMemo(() => {
        return (supplierPhones || []).filter(phone => {
            if (phoneStatusFilter === 'in_stock') {
                if (phone.status && phone.status !== 'in_stock' && phone.status !== 'available') return false
            } else if (phoneStatusFilter === 'sold') {
                if (phone.status !== 'sold') return false
            } else if (phoneStatusFilter === 'returned') {
                if (phone.status !== 'returned') return false
            }

            if (phoneSearch.trim()) {
                const q = phoneSearch.toLowerCase()
                const matchModel = (phone.model || phone.phone_model || '').toLowerCase().includes(q)
                const matchImei1 = (phone.imei1 || phone.imei || '').toLowerCase().includes(q)
                const matchImei2 = (phone.imei2 || '').toLowerCase().includes(q)
                const matchColor = (phone.color || '').toLowerCase().includes(q)
                if (!matchModel && !matchImei1 && !matchImei2 && !matchColor) return false
            }
            return true
        })
    }, [supplierPhones, phoneStatusFilter, phoneSearch])

    const handlePrintStatement = async () => {
        if (!supplier) return
        const branding = await getShopBranding(user?.shop_id)
        const headerHtml = brandedA4Header(branding, `SUPPLIER STATEMENT - ${supplier.name.toUpperCase()}`)

        const rows = filteredLedger.map(item => `
            <tr>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px;">
                    ${new Date(item.date).toLocaleDateString()}
                </td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px;">
                    <span style="font-weight: 600; text-transform: uppercase;">${item.type}</span>
                    ${item.bill_number ? `<br/><span style="color: #6b7280; font-size: 10px;">Bill: ${item.bill_number}</span>` : ''}
                </td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px;">
                    ${item.note || item.details || '-'}
                </td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: right; font-size: 11px; color: #dc2626; font-weight: 600;">
                    ${(item.type === 'purchase' || item.type === 'debit') ? 'Rs. ' + Number(item.amount).toLocaleString() : '-'}
                </td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: right; font-size: 11px; color: #16a34a; font-weight: 600;">
                    ${(item.type === 'payment' || item.type === 'return') ? 'Rs. ' + Number(item.amount).toLocaleString() : '-'}
                </td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: right; font-size: 11px; font-weight: 700;">
                    Rs. ${Number(item.balance || 0).toLocaleString()}
                </td>
            </tr>
        `).join('')

        const contentHtml = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111827; padding: 12px;">
                ${headerHtml}
                <div style="display: flex; justify-content: space-between; margin-bottom: 16px; padding: 12px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
                    <div>
                        <h3 style="margin: 0 0 4px 0; font-size: 16px; font-weight: 700;">${supplier.name}</h3>
                        <p style="margin: 0; font-size: 12px; color: #4b5563;">Phone: ${supplier.phone || 'N/A'}${supplier.address ? ' | ' + supplier.address : ''}</p>
                    </div>
                    <div style="text-align: right;">
                        <span style="font-size: 11px; text-transform: uppercase; color: #6b7280; font-weight: 600;">Current Balance</span>
                        <h2 style="margin: 2px 0 0 0; font-size: 20px; font-weight: 800; color: #dc2626;">Rs. ${Number(supplier.outstanding_balance || 0).toLocaleString()}</h2>
                    </div>
                </div>

                <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                    <thead>
                        <tr style="background: #f3f4f6;">
                            <th style="padding: 8px; text-align: left; font-size: 11px; border-bottom: 2px solid #d1d5db;">Date</th>
                            <th style="padding: 8px; text-align: left; font-size: 11px; border-bottom: 2px solid #d1d5db;">Type / Ref</th>
                            <th style="padding: 8px; text-align: left; font-size: 11px; border-bottom: 2px solid #d1d5db;">Description</th>
                            <th style="padding: 8px; text-align: right; font-size: 11px; border-bottom: 2px solid #d1d5db;">Debit (Purchases)</th>
                            <th style="padding: 8px; text-align: right; font-size: 11px; border-bottom: 2px solid #d1d5db;">Credit (Payments)</th>
                            <th style="padding: 8px; text-align: right; font-size: 11px; border-bottom: 2px solid #d1d5db;">Balance</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows || '<tr><td colspan="6" style="text-align: center; padding: 16px; color: #9ca3af;">No transaction records</td></tr>'}
                    </tbody>
                </table>

                <div style="display: flex; justify-content: space-between; margin-top: 40px; padding-top: 20px;">
                    <div style="text-align: center; width: 180px; border-top: 1px dashed #9ca3af; padding-top: 6px; font-size: 11px; color: #6b7280;">
                        Supplier Signature
                    </div>
                    <div style="text-align: center; width: 180px; border-top: 1px dashed #9ca3af; padding-top: 6px; font-size: 11px; color: #6b7280;">
                        Authorized Signature
                    </div>
                </div>
            </div>
        `
        printHTML(contentHtml, `Statement_${supplier.name}`)
    }

    const handlePrintStock = async () => {
        if (!supplier) return
        const branding = await getShopBranding(user?.shop_id)
        const headerHtml = brandedA4Header(branding, `SUPPLIER STOCK REPORT - ${supplier.name.toUpperCase()}`)

        const inStock = (supplierPhones || []).filter(p => !p.status || p.status === 'in_stock' || p.status === 'available')
        const totalCost = inStock.reduce((s, p) => s + (Number(p.cost_price || p.purchase_price) || 0), 0)

        const rows = inStock.map((phone, idx) => `
            <tr>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; text-align: center;">${idx + 1}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; font-weight: 600;">
                    ${phone.model || phone.phone_model || 'Phone'}
                    ${phone.color ? `<span style="font-size: 10px; color: #6b7280;"> (${phone.color})</span>` : ''}
                </td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; font-family: monospace;">
                    ${phone.imei1 || phone.imei || 'N/A'}${phone.imei2 ? ' / ' + phone.imei2 : ''}
                </td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px;">
                    ${phone.storage || phone.ram ? `${phone.ram || ''} ${phone.storage || ''}`.trim() : '-'}
                </td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px;">
                    ${(phone.pta_status || 'official').toUpperCase()}
                </td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; text-align: right; font-weight: 600;">
                    Rs. ${Number(phone.cost_price || phone.purchase_price || 0).toLocaleString()}
                </td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; text-align: right;">
                    Rs. ${Number(phone.selling_price || phone.sale_price || 0).toLocaleString()}
                </td>
            </tr>
        `).join('')

        const contentHtml = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111827; padding: 12px;">
                ${headerHtml}
                <div style="display: flex; justify-content: space-between; margin-bottom: 16px; padding: 12px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
                    <div>
                        <h3 style="margin: 0 0 4px 0; font-size: 16px; font-weight: 700;">Supplier: ${supplier.name}</h3>
                        <p style="margin: 0; font-size: 12px; color: #4b5563;">In-Stock Phones: <strong>${inStock.length} units</strong></p>
                    </div>
                    <div style="text-align: right;">
                        <span style="font-size: 11px; text-transform: uppercase; color: #6b7280; font-weight: 600;">Active Inventory Value</span>
                        <h2 style="margin: 2px 0 0 0; font-size: 20px; font-weight: 800; color: #2563eb;">Rs. ${totalCost.toLocaleString()}</h2>
                    </div>
                </div>

                <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                    <thead>
                        <tr style="background: #f3f4f6;">
                            <th style="padding: 8px; text-align: center; font-size: 11px; border-bottom: 2px solid #d1d5db; width: 30px;">#</th>
                            <th style="padding: 8px; text-align: left; font-size: 11px; border-bottom: 2px solid #d1d5db;">Model / Variant</th>
                            <th style="padding: 8px; text-align: left; font-size: 11px; border-bottom: 2px solid #d1d5db;">IMEI</th>
                            <th style="padding: 8px; text-align: left; font-size: 11px; border-bottom: 2px solid #d1d5db;">Storage</th>
                            <th style="padding: 8px; text-align: left; font-size: 11px; border-bottom: 2px solid #d1d5db;">PTA Status</th>
                            <th style="padding: 8px; text-align: right; font-size: 11px; border-bottom: 2px solid #d1d5db;">Purchase Cost</th>
                            <th style="padding: 8px; text-align: right; font-size: 11px; border-bottom: 2px solid #d1d5db;">Sale Target</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows || '<tr><td colspan="7" style="text-align: center; padding: 16px; color: #9ca3af;">No in-stock phones found for this supplier</td></tr>'}
                    </tbody>
                </table>
            </div>
        `
        printHTML(contentHtml, `StockReport_${supplier.name}`)
    }

    if (!hasFeature('supplier_ledger')) return <UpgradeWall feature="supplier_ledger" />
    if (loading) return <div className="p-8">Loading ledger...</div>
    if (!supplier) return <div className="p-8 text-red-500">Supplier not found!</div>

    return (
        <div>
            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                    <button onClick={() => navigate('/suppliers')} className="text-blue-500 mb-2 hover:underline text-sm font-semibold">← Back to Suppliers</button>
                    <h1 className="text-3xl font-bold text-gray-800">{supplier.name}</h1>
                    <p className="text-gray-500 text-sm">{supplier.phone}{supplier.address ? ' | ' + supplier.address : ''}</p>
                </div>
                <div className="w-full sm:w-auto flex flex-col sm:items-end gap-3">
                    <div className="flex gap-2 flex-wrap justify-end">
                        <button onClick={handlePrintStatement}
                            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition flex items-center gap-1.5 shadow-sm">
                            <Printer size={15} /> Print Statement
                        </button>
                        <button onClick={handlePrintStock}
                            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition flex items-center gap-1.5 shadow-sm">
                            <Smartphone size={15} /> Print Stock
                        </button>
                        <button onClick={handleExport}
                            className="px-3.5 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition flex items-center gap-1.5 shadow-sm">
                            📥 Export
                        </button>
                        <button onClick={() => importRef.current?.click()}
                            className="px-3.5 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-sm font-semibold transition flex items-center gap-1.5 shadow-sm">
                            📤 Import
                        </button>
                        <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
                        <button onClick={handleReconcileBalance}
                            className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-semibold text-sm shadow transition"
                            title="Recalculate supplier balance from transaction ledger sum">
                            ⚡ Reconcile
                        </button>
                        <button onClick={() => setShowModal(true)}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm shadow transition">
                            ➕ Add Entry
                        </button>
                        {ledger.length > 0 && (
                            <button
                                onClick={handleClearAllLedger}
                                className="px-3.5 py-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 rounded-lg font-semibold text-sm transition">
                                🗑️ Clear
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Top 5 KPI Stats Cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                    <p className="text-xs text-gray-500 uppercase font-semibold">Total Purchases (Debit)</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">Rs. {stats.totalPurchases.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Purchases & debits</p>
                </div>

                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                    <p className="text-xs text-gray-500 uppercase font-semibold">Total Payments (Credit)</p>
                    <p className="text-xl font-bold text-green-600 mt-1">Rs. {stats.totalPayments.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Payments made</p>
                </div>

                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                    <p className="text-xs text-gray-500 uppercase font-semibold">Returns / Adjustments</p>
                    <p className="text-xl font-bold text-purple-600 mt-1">Rs. {stats.totalReturns.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{stats.returnedCount} phone(s) returned</p>
                </div>

                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm col-span-2 sm:col-span-1">
                    <p className="text-xs text-gray-500 uppercase font-semibold">Net Payable Balance</p>
                    <p className={`text-xl font-bold mt-1 ${stats.currentBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        Rs. {stats.currentBalance.toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{stats.currentBalance > 0 ? 'Payable to supplier' : 'Account Cleared'}</p>
                </div>

                <div className="bg-blue-50/70 p-4 rounded-xl border border-blue-100 shadow-sm col-span-2 sm:col-span-1">
                    <div className="flex justify-between items-start">
                        <p className="text-xs text-blue-800 uppercase font-bold">Active Stock Value</p>
                        <span className="px-2 py-0.5 text-xs font-bold bg-blue-600 text-white rounded-full">
                            {stats.inStockCount} In Stock
                        </span>
                    </div>
                    <p className="text-xl font-bold text-blue-900 mt-1">Rs. {stats.inStockValue.toLocaleString()}</p>
                    <p className="text-xs text-blue-600 mt-0.5">Sold: {stats.soldCount} | Total: {stats.totalPhones}</p>
                </div>
            </div>

            {/* ── Tab Switcher ── */}
            <div className="flex items-center gap-2 border-b border-gray-200 mb-6 overflow-x-auto pb-1">
                <button
                    onClick={() => setActiveTab('statement')}
                    className={`flex items-center gap-2 px-5 py-3 font-semibold text-sm rounded-t-xl transition border-b-2 whitespace-nowrap ${
                        activeTab === 'statement'
                            ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                            : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                    }`}
                >
                    <FileText size={17} />
                    <span>Statement & Ledger</span>
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">{ledger.length}</span>
                </button>

                <button
                    onClick={() => setActiveTab('purchases')}
                    className={`flex items-center gap-2 px-5 py-3 font-semibold text-sm rounded-t-xl transition border-b-2 whitespace-nowrap ${
                        activeTab === 'purchases'
                            ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                            : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                    }`}
                >
                    <CreditCard size={17} />
                    <span>Purchase Invoices</span>
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">{purchasesList.length}</span>
                </button>

                <button
                    onClick={() => setActiveTab('phones')}
                    className={`flex items-center gap-2 px-5 py-3 font-semibold text-sm rounded-t-xl transition border-b-2 whitespace-nowrap ${
                        activeTab === 'phones'
                            ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                            : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                    }`}
                >
                    <Smartphone size={17} />
                    <span>Supplied Phones Stock</span>
                    <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700 font-bold">{supplierPhones.length}</span>
                </button>
            </div>

            {/* ── Statement Tab ── */}
            {activeTab === 'statement' && (
                <>

            {/* ── Filter Bar ── */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 mb-4 flex flex-wrap gap-3 items-end">
                {/* Search */}
                <div className="flex-1 min-w-[180px]">
                    <label className="block text-xs text-gray-500 font-semibold mb-1 uppercase tracking-wide">🔍 Search</label>
                    <input aria-label="Search" type="text" value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Bill #, description, amount..."
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 outline-none" />
                </div>
                {/* Type filter */}
                <div className="min-w-[140px]">
                    <label className="block text-xs text-gray-500 font-semibold mb-1 uppercase tracking-wide">Type</label>
                    <select aria-label="Type" value={filterType} onChange={e => setFilterType(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 outline-none bg-white">
                        <option value="all">All Types</option>
                        <option value="debit">Purchase / Debit</option>
                        <option value="payment">Payment</option>
                        <option value="purchase">Purchase Order</option>
                        <option value="return">Return</option>
                    </select>
                </div>
                {/* Date From */}
                <div>
                    <label className="block text-xs text-gray-500 font-semibold mb-1 uppercase tracking-wide">From</label>
                    <input aria-label="From" type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 outline-none" />
                </div>
                {/* Date To */}
                <div>
                    <label className="block text-xs text-gray-500 font-semibold mb-1 uppercase tracking-wide">To</label>
                    <input aria-label="To" type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 outline-none" />
                </div>
                {/* Clear */}
                {isFiltered && (
                    <button onClick={() => { setSearch(''); setFilterType('all'); setFilterFrom(''); setFilterTo('') }}
                        className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-sm font-semibold transition">
                        ✕ Clear
                    </button>
                )}
                {/* Result count */}
                {isFiltered && (
                    <span className="text-xs text-gray-500 self-center">
                        {filteredLedger.length} of {ledger.length} entries
                    </span>
                )}
            </div>

            {/* ── Bulk Action Bar ── */}
            {selectedIds.size > 0 && (
                <div className="mb-3 flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    <span className="text-sm font-bold text-red-700">{selectedIds.size} selected</span>
                    <button
                        onClick={handleBulkDelete}
                        className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-bold transition"
                    >🗑️ Delete Selected</button>
                    <button
                        onClick={() => setSelectedIds(new Set())}
                        className="px-3 py-1.5 bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 rounded-lg text-sm transition"
                    >✕ Clear</button>
                </div>
            )}

            {/* ── Ledger Table ── */}
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
                <div className="divide-y divide-gray-100 md:hidden">
                    {filteredLedger.length === 0 ? (
                        <p className="p-6 text-center text-gray-500 text-sm">
                            {isFiltered ? `Nothing matches "${search || filterType}". Clear the filter.` : 'No transactions yet. Use "Add Transaction" to add the first one.'}
                        </p>
                    ) : (
                        filteredLedger.map((item, idx) => (
                            <div key={idx} className={`p-4 ${selectedIds.has(item.id) ? 'bg-red-50/40' : ''}`}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-xs text-gray-500">{new Date(item.date).toLocaleDateString('en-PK')}</p>
                                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                            <span className="font-semibold text-gray-800">{item.note}</span>
                                            {item.bill_number && (
                                                <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs font-mono font-bold">{item.bill_number}</span>
                                            )}
                                        </div>
                                        {item.details && <p className="mt-1 text-xs text-gray-500">{item.details}</p>}

                                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                                            {item.payment_mode && (
                                                <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs font-semibold capitalize">{item.payment_mode}</span>
                                            )}
                                            {item.transaction_ref && (
                                                <span className="text-xs text-gray-500">Ref: {item.transaction_ref}</span>
                                            )}
                                            {item.type === 'purchase' && (
                                                <button
                                                    onClick={() => setExpandedBill(expandedBill === item.id ? null : item.id)}
                                                    className="text-xs text-blue-600 hover:underline font-bold uppercase tracking-tighter"
                                                >
                                                    {expandedBill === item.id ? 'Collapse ▲' : 'Details ▼'}
                                                </button>
                                            )}
                                            {item.type === 'return' && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs uppercase font-bold">Return</span>}
                                            {item.type === 'debit' && <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs uppercase font-bold">Manual Entry</span>}
                                        </div>
                                    </div>

                                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                                        <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)}
                                            className="w-4 h-4 rounded cursor-pointer" />
                                        {canEditEntry(item) && (
                                            <button onClick={() => setEditEntry(item)} title="Correct amount" aria-label="Correct amount"
                                                className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition text-xs">✏️</button>
                                        )}
                                        <button
                                            onClick={() => handleDeleteTransaction(item)}
                                            title="Delete transaction"
                                            className="p-1 text-gray-500 hover:text-red-500 rounded transition text-xs"
                                        >🗑️</button>
                                    </div>
                                </div>

                                <div className="mt-3 grid grid-cols-3 gap-2 text-right text-xs">
                                    <div>
                                        <p className="text-xs font-bold uppercase text-gray-500 text-left">Debit (+)</p>
                                        <p className="font-bold text-orange-600">{(item.type === 'purchase' || item.type === 'debit') ? `+ Rs. ${Number(item.amount).toLocaleString()}` : '—'}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold uppercase text-gray-500 text-left">Credit (-)</p>
                                        <p className="font-bold text-green-600">{(item.type !== 'purchase' && item.type !== 'debit') ? `- Rs. ${Math.abs(Number(item.amount)).toLocaleString()}` : '—'}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold uppercase text-gray-500 text-left">Balance</p>
                                        <p className={`font-black ${item.balance > 0 ? 'text-red-600' : 'text-green-700'}`}>Rs. {Number(item.balance).toLocaleString()}</p>
                                    </div>
                                </div>

                                {item.type === 'purchase' && expandedBill === item.id && (
                                    <div className="mt-3 bg-orange-50/50 p-3 rounded-lg border border-orange-100/50">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-xs text-gray-500 uppercase font-bold tracking-widest">Payment:</span>
                                            <span className={`px-3 py-0.5 rounded-full text-xs font-bold uppercase ${item.payment_type === 'cash' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                                {item.payment_type}
                                            </span>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            {(item.items || []).map((it, iidx) => {
                                                const ph = it.phones
                                                const name = it.display_name || it.product_name || (ph ? `${ph.brand && ph.brand !== 'Unknown' ? ph.brand + ' ' : ''}${ph.model || 'Smartphone'}` : 'Item')
                                                const specs = it.specs || (ph ? [ph.storage, ph.color, ph.pta_status ? ph.pta_status.toUpperCase() : null].filter(Boolean).join(' • ') : null)
                                                const imei = it.imei || (ph ? (ph.imei_1 || ph.imei1 || ph.imei) : null)
                                                const price = it.unit_price || it.cost_price || it.subtotal || 0
                                                const qty = it.quantity || 1

                                                return (
                                                    <div key={iidx} className="flex flex-col sm:flex-row sm:items-center justify-between text-xs bg-white/90 p-2.5 rounded-xl border border-orange-100/80 shadow-2xs gap-1.5">
                                                        <div className="space-y-0.5">
                                                            <p className="text-gray-900 font-bold text-xs">{name}</p>
                                                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                                                                {specs && <span>{specs}</span>}
                                                                {imei && (
                                                                    <span className="font-mono bg-orange-50/80 text-orange-800 border border-orange-200/60 px-1.5 py-0.2 rounded text-xs">
                                                                        IMEI: {imei}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <span className="text-gray-900 font-bold">Rs. {Number(price).toLocaleString()}</span>
                                                            <span className="text-gray-500 text-xs"> × {qty}</span>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
                <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-4 py-4 w-10">
                                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                                        className="w-4 h-4 rounded cursor-pointer" />
                                </th>
                                <th className="px-5 py-4 text-left font-semibold text-gray-600 whitespace-nowrap">Date</th>
                                <th className="px-5 py-4 text-left font-semibold text-gray-600 whitespace-nowrap">Bill #</th>
                                <th className="px-5 py-4 text-left font-semibold text-gray-600 min-w-[160px]">Description</th>
                                <th className="px-5 py-4 text-right font-semibold text-orange-500 whitespace-nowrap">Debit (Purchase)</th>
                                <th className="px-5 py-4 text-right font-semibold text-green-600 whitespace-nowrap">Credit (Payment)</th>
                                <th className="px-5 py-4 text-right font-semibold text-gray-600 whitespace-nowrap">Balance</th>
                                <th className="px-3 py-4"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredLedger.map((item, idx) => (
                                <React.Fragment key={idx}>
                                    <tr className={`hover:bg-gray-50 transition ${selectedIds.has(item.id) ? 'bg-red-50/40' : ''}`}>
                                        <td className="px-4 py-3">
                                            <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)}
                                                className="w-4 h-4 rounded cursor-pointer" />
                                        </td>
                                        <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{new Date(item.date).toLocaleDateString('en-PK')}</td>
                                        <td className="px-5 py-3 whitespace-nowrap">
                                            {item.bill_number
                                                ? <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs font-mono font-bold">{item.bill_number}</span>
                                                : item.type === 'purchase'
                                                    ? <span className="text-xs text-gray-500 font-mono">{String(item.id).slice(-8)}</span>
                                                    : <span className="text-gray-300">—</span>}
                                        </td>
                                        <td className="px-5 py-3">
                                            <div className="flex flex-col gap-0.5">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-medium text-gray-800">{item.note}</span>
                                                    {item.type === 'purchase' && (
                                                        <button onClick={() => setExpandedBill(expandedBill === item.id ? null : item.id)}
                                                            className="text-xs text-blue-600 hover:text-blue-800 font-bold uppercase tracking-tighter">
                                                            {expandedBill === item.id ? 'Collapse ▲' : 'Details ▼'}
                                                        </button>
                                                    )}
                                                    {item.type === 'return' && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs uppercase font-bold">Return</span>}
                                                    {item.type === 'debit' && <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs uppercase font-bold">Manual Entry</span>}
                                                </div>
                                                {item.details && <span className="text-xs text-gray-500 truncate max-w-xs">{item.details}</span>}
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    {item.payment_mode && (
                                                        <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs font-semibold capitalize">{item.payment_mode}</span>
                                                    )}
                                                    {item.transaction_ref && (
                                                        <span className="text-xs text-gray-500">Ref: {item.transaction_ref}</span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3 text-right text-orange-600 font-semibold whitespace-nowrap">
                                            {(item.type === 'purchase' || item.type === 'debit') ? `+ Rs. ${Number(item.amount).toLocaleString()}` : ''}
                                        </td>
                                        <td className="px-5 py-3 text-right text-green-600 font-semibold whitespace-nowrap">
                                            {(item.type !== 'purchase' && item.type !== 'debit') ? `- Rs. ${Math.abs(Number(item.amount)).toLocaleString()}` : ''}
                                        </td>
                                        <td className="px-5 py-3 text-right font-bold whitespace-nowrap">
                                            <span className={item.balance > 0 ? 'text-red-600' : 'text-green-700'}>
                                                Rs. {Number(item.balance).toLocaleString()}
                                            </span>
                                        </td>
                                        <td className="px-3 py-3 text-right">
                                            {canEditEntry(item) && (
                                                <button onClick={() => setEditEntry(item)} title="Correct amount" aria-label="Correct amount"
                                                    className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition text-xs">✏️</button>
                                            )}
                                            <button onClick={() => handleDeleteTransaction(item)}
                                                title="Delete transaction"
                                                className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition text-xs">
                                                🗑️
                                            </button>
                                        </td>
                                    </tr>
                                    {item.type === 'purchase' && expandedBill === item.id && (
                                        <tr className="bg-orange-50/50 border-b border-gray-100">
                                            <td colSpan="8" className="px-5 py-3">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <span className="text-xs text-gray-500 uppercase font-bold tracking-widest">Payment:</span>
                                                    <span className={`px-3 py-0.5 rounded-full text-xs font-bold uppercase ${item.payment_type === 'cash' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                                        {item.payment_type}
                                                    </span>
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                                    {(item.items || []).map((it, iidx) => {
                                                        const ph = it.phones
                                                        const name = it.display_name || it.product_name || (ph ? `${ph.brand && ph.brand !== 'Unknown' ? ph.brand + ' ' : ''}${ph.model || 'Smartphone'}` : 'Item')
                                                        const specs = it.specs || (ph ? [ph.storage, ph.color, ph.pta_status ? ph.pta_status.toUpperCase() : null].filter(Boolean).join(' • ') : null)
                                                        const imei = it.imei || (ph ? (ph.imei_1 || ph.imei1 || ph.imei) : null)
                                                        const price = it.unit_price || it.cost_price || it.subtotal || 0
                                                        const qty = it.quantity || 1

                                                        return (
                                                            <div key={iidx} className="flex flex-col justify-between text-xs bg-white/90 p-2.5 rounded-xl border border-orange-100/80 shadow-2xs gap-1.5">
                                                                <div className="space-y-0.5">
                                                                    <p className="text-gray-900 font-bold text-xs">{name}</p>
                                                                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                                                                        {specs && <span>{specs}</span>}
                                                                        {imei && (
                                                                            <span className="font-mono bg-orange-50/80 text-orange-800 border border-orange-200/60 px-1.5 py-0.2 rounded text-xs">
                                                                                IMEI: {imei}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div className="text-right pt-1 border-t border-gray-100/80 flex justify-between items-center">
                                                                    <span className="text-gray-500 text-xs">Qty: {qty}</span>
                                                                    <span className="text-gray-900 font-bold">Rs. {Number(price).toLocaleString()}</span>
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                            {ledger.length === 0 && (
                                <tr>
                                    <td colSpan="8" className="px-6 py-12 text-center text-gray-500">
                                        {isFiltered ? `Nothing matches "${search || filterType}". Clear the filter.` : 'No transactions yet. Use "Add Transaction" to add the first one.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            </>
            )}

            {/* ── Purchases Tab ── */}
            {activeTab === 'purchases' && (
                <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
                    <div className="p-4 border-b border-gray-100 flex flex-wrap justify-between items-center gap-3 bg-gray-50/50">
                        <div>
                            <h3 className="font-bold text-gray-800 text-base">Purchase Invoices & Bills</h3>
                            <p className="text-xs text-gray-500">All inventory batches and purchase transactions from {supplier.name}</p>
                        </div>
                        <span className="text-xs font-semibold px-3 py-1 bg-blue-50 text-blue-700 rounded-full border border-blue-100">
                            {purchasesList.length} Invoices
                        </span>
                    </div>

                    {purchasesList.length === 0 ? (
                        <div className="p-12 text-center text-gray-500">
                            <p className="text-sm">No purchase invoices for this supplier.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-50 text-gray-600 text-xs uppercase border-b border-gray-200">
                                    <tr>
                                        <th className="p-3">Invoice #</th>
                                        <th className="p-3">Date</th>
                                        <th className="p-3">Items / Phones</th>
                                        <th className="p-3 text-right">Total Amount</th>
                                        <th className="p-3 text-right">Paid Amount</th>
                                        <th className="p-3 text-center">Payment Status</th>
                                        <th className="p-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {purchasesList.map(p => {
                                        const isCredit = p.payment_type === 'credit'
                                        const isBank = p.payment_type === 'bank'
                                        const itemsCount = p.purchase_items?.length || 0

                                        return (
                                            <tr key={p.id} className="hover:bg-gray-50/80 transition">
                                                <td className="p-3 font-semibold text-blue-600 whitespace-nowrap">
                                                    PR-{String(p.id).slice(-6)}
                                                </td>
                                                <td className="p-3 text-gray-600 text-xs whitespace-nowrap">
                                                    {new Date(p.created_at).toLocaleDateString()}
                                                </td>
                                                <td className="p-3 text-xs text-gray-700">
                                                    {itemsCount > 0 ? (
                                                        <div>
                                                            <span className="font-semibold text-gray-900">{itemsCount} item(s)</span>
                                                            <p className="text-xs text-gray-500 truncate max-w-xs">
                                                                {p.purchase_items.map(i => {
                                                                    const ph = i.phones || (supplierPhones || []).find(sp => sp.id === i.phone_id || sp.purchase_id === p.id)
                                                                    return i.product_name || i.item_name || (ph ? `${ph.brand && ph.brand !== 'Unknown' ? ph.brand + ' ' : ''}${ph.model || 'Phone'}` : 'Item')
                                                                }).join(', ')}
                                                            </p>
                                                        </div>
                                                    ) : (
                                                        <span className="text-gray-500">Direct Purchase</span>
                                                    )}
                                                </td>
                                                <td className="p-3 text-right font-bold text-gray-900 whitespace-nowrap">
                                                    Rs. {Number(p.total_amount).toLocaleString()}
                                                </td>
                                                <td className="p-3 text-right font-semibold text-gray-600 whitespace-nowrap">
                                                    Rs. {Number(p.paid_amount || 0).toLocaleString()}
                                                </td>
                                                <td className="p-3 text-center whitespace-nowrap">
                                                    {isCredit ? (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                                            Credit (Payable)
                                                        </span>
                                                    ) : isBank ? (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
                                                            Bank Transfer
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-800 border border-green-200">
                                                            Cash Paid
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="p-3 text-right whitespace-nowrap">
                                                    <button
                                                        onClick={() => setPurchaseToEditPayment(p)}
                                                        className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ml-auto shadow-xs"
                                                        title="Change how this bill was paid; balances are adjusted"
                                                    >
                                                        <CreditCard size={13} />
                                                        Change Method
                                                    </button>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ── Supplied Phones Stock Tab ── */}
            {activeTab === 'phones' && (
                <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
                    {/* Header with Search and Status Filter */}
                    <div className="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3 bg-gray-50/50">
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                onClick={() => setPhoneStatusFilter('all')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                                    phoneStatusFilter === 'all'
                                        ? 'bg-blue-600 text-white shadow-xs'
                                        : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                                }`}
                            >
                                All ({supplierPhones.length})
                            </button>
                            <button
                                onClick={() => setPhoneStatusFilter('in_stock')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                                    phoneStatusFilter === 'in_stock'
                                        ? 'bg-green-600 text-white shadow-xs'
                                        : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                                }`}
                            >
                                In Stock ({stats.inStockCount})
                            </button>
                            <button
                                onClick={() => setPhoneStatusFilter('sold')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                                    phoneStatusFilter === 'sold'
                                        ? 'bg-blue-600 text-white shadow-xs'
                                        : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                                }`}
                            >
                                Sold ({stats.soldCount})
                            </button>
                            <button
                                onClick={() => setPhoneStatusFilter('returned')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                                    phoneStatusFilter === 'returned'
                                        ? 'bg-purple-600 text-white shadow-xs'
                                        : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                                }`}
                            >
                                Returned ({stats.returnedCount})
                            </button>
                        </div>

                        <div className="flex items-center gap-2 flex-1 max-w-sm ml-auto">
                            <div className="relative w-full">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                <input aria-label="Search IMEI, model, color"
                                    type="text"
                                    value={phoneSearch}
                                    onChange={e => setPhoneSearch(e.target.value)}
                                    placeholder="Search IMEI, model, color..."
                                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
                                />
                            </div>
                            <button
                                onClick={handlePrintStock}
                                className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-lg text-xs font-bold transition flex items-center gap-1 whitespace-nowrap"
                            >
                                <Printer size={13} /> Print
                            </button>
                        </div>
                    </div>

                    {filteredPhones.length === 0 ? (
                        <div className="p-12 text-center text-gray-500">
                            <Smartphone size={32} className="mx-auto mb-2 opacity-30" />
                            <p className="text-sm">No phones match.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-50 text-gray-600 text-xs uppercase border-b border-gray-200">
                                    <tr>
                                        <th className="p-3">Model / Specs</th>
                                        <th className="p-3">IMEI Numbers</th>
                                        <th className="p-3">PTA Status</th>
                                        <th className="p-3 text-right">Cost Price</th>
                                        <th className="p-3 text-right">Sale Price</th>
                                        <th className="p-3 text-center">Status</th>
                                        <th className="p-3 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {filteredPhones.map(phone => {
                                        const pta = getPtaBadge(phone.pta_status)
                                        const isReturned = phone.status === 'returned'
                                        const isSold = phone.status === 'sold'
                                        const isInStock = !phone.status || phone.status === 'in_stock' || phone.status === 'available'

                                        return (
                                            <tr key={phone.id} className="hover:bg-gray-50/80 transition">
                                                <td className="p-3">
                                                    <p className="font-bold text-gray-900">{phone.model || phone.phone_model || 'Smartphone'}</p>
                                                    <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5">
                                                        {phone.storage && <span>{phone.ram ? `${phone.ram}/` : ''}{phone.storage}</span>}
                                                        {phone.color && <span>• {phone.color}</span>}
                                                    </div>
                                                </td>
                                                <td className="p-3">
                                                    <div className="font-mono text-xs text-gray-800 flex items-center gap-1.5">
                                                        <span>{phone.imei1 || phone.imei || 'N/A'}</span>
                                                        {(phone.imei1 || phone.imei) && (
                                                            <button
                                                                onClick={() => handleCopyImei(phone.imei1 || phone.imei)}
                                                                className="text-gray-500 hover:text-blue-600 transition"
                                                                title="Copy IMEI"
                                                            >
                                                                {copiedImei === (phone.imei1 || phone.imei) ? (
                                                                    <Check size={12} className="text-green-600" />
                                                                ) : (
                                                                    <Copy size={12} />
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>
                                                    {phone.imei2 && (
                                                        <div className="font-mono text-xs text-gray-500 flex items-center gap-1.5 mt-0.5">
                                                            <span>{phone.imei2}</span>
                                                            <button
                                                                onClick={() => handleCopyImei(phone.imei2)}
                                                                className="text-gray-500 hover:text-blue-600 transition"
                                                                title="Copy IMEI 2"
                                                            >
                                                                {copiedImei === phone.imei2 ? (
                                                                    <Check size={11} className="text-green-600" />
                                                                ) : (
                                                                    <Copy size={11} />
                                                                )}
                                                            </button>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="p-3">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${pta.color}`}>
                                                        {pta.label}
                                                    </span>
                                                </td>
                                                <td className="p-3 text-right font-bold text-gray-900 whitespace-nowrap">
                                                    Rs. {Number(phone.cost_price || phone.purchase_price || 0).toLocaleString()}
                                                </td>
                                                <td className="p-3 text-right font-semibold text-gray-600 whitespace-nowrap">
                                                    Rs. {Number(phone.selling_price || phone.sale_price || 0).toLocaleString()}
                                                </td>
                                                <td className="p-3 text-center whitespace-nowrap">
                                                    {isInStock ? (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-800 border border-green-200">
                                                            In Stock
                                                        </span>
                                                    ) : isSold ? (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
                                                            Sold
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-200" title={phone.return_notes || ''}>
                                                            Returned
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="p-3 text-right whitespace-nowrap">
                                                    {isInStock ? (
                                                        <button
                                                            onClick={() => setPhoneForReturn(phone)}
                                                            className="px-3 py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ml-auto shadow-xs"
                                                            title="Return this phone to the supplier (credit note, cash refund or bank refund)"
                                                        >
                                                            <RotateCcw size={13} />
                                                            Return to Supplier
                                                        </button>
                                                    ) : isReturned ? (
                                                        <span className="text-xs text-gray-500 italic">
                                                            {phone.return_settlement || 'Returned'}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-gray-500 italic">Customer Sold</span>
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            <EditLedgerEntryModal
                entry={editEntry}
                title={editEntry?.type === 'payment' ? 'Correct payment' : 'Correct entry'}
                saving={savingEdit}
                onClose={() => setEditEntry(null)}
                onSave={handleSaveEntryEdit}
                preview={(diff) => `Balance will change by ${(editEntry?.type === 'payment' ? -diff : diff) >= 0 ? '+' : '-'}Rs. ${Math.abs(diff).toLocaleString()}${editEntry?.type === 'payment' ? '; the cash / bank account changes by the same amount' : ''}.`}
            />

            {/* ── Add Transaction Modal ── */}
            {showModal && (
                <div role="dialog" aria-modal="true" className="fixed inset-0 bg-black bg-opacity-40 flex items-start sm:items-center justify-center z-50 overflow-y-auto py-4 px-2 sm:px-4">
                    <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-md">
                        <h2 className="text-xl font-bold text-gray-800 mb-1">➕ Add Transaction</h2>
                        <p className="text-xs text-gray-500 mb-3">Record a purchase, supplier payment, or both</p>

                        {/* Informational Guidance Banner */}
                        <div className="p-2.5 rounded-xl bg-blue-50/80 border border-blue-200/80 text-xs text-blue-800 leading-snug mb-3">
                            💡 <b>Note:</b> Purchases completed in the <b>Purchases</b> module or <b>Phone Purchase Panel</b> are synced to this ledger automatically. Use this form only for manual credit/debit entries.
                        </div>

                        {/* Transaction Mode Selector */}
                        <div className="grid grid-cols-3 gap-1 p-1 bg-gray-100 rounded-xl text-xs font-semibold mb-3">
                            <button
                                type="button"
                                onClick={() => setTxMode('purchase')}
                                className={`py-1.5 rounded-lg text-center transition ${txMode === 'purchase' ? 'bg-white text-orange-600 shadow-xs' : 'text-gray-500 hover:text-gray-800'}`}
                            >
                                📦 Purchase Only
                            </button>
                            <button
                                type="button"
                                onClick={() => setTxMode('payment')}
                                className={`py-1.5 rounded-lg text-center transition ${txMode === 'payment' ? 'bg-white text-green-600 shadow-xs' : 'text-gray-500 hover:text-gray-800'}`}
                            >
                                💵 Payment Only
                            </button>
                            <button
                                type="button"
                                onClick={() => setTxMode('both')}
                                className={`py-1.5 rounded-lg text-center transition ${txMode === 'both' ? 'bg-white text-blue-600 shadow-xs' : 'text-gray-500 hover:text-gray-800'}`}
                            >
                                🔄 Buy & Pay Both
                            </button>
                        </div>

                        <form onSubmit={handleSubmitTransaction} className="space-y-4">

                            {/* Date + Bill # */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-gray-700 font-medium mb-1 text-sm">Date</label>
                                    <input aria-label="Date" type="date" value={txForm.date}
                                        onChange={e => setTxForm(f => ({ ...f, date: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                                </div>
                                <div>
                                    <label className="block text-gray-700 font-medium mb-1 text-sm">Bill # (Optional)</label>
                                    <input aria-label="Bill (Optional)" type="text" value={txForm.bill_number}
                                        onChange={e => setTxForm(f => ({ ...f, bill_number: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                        placeholder="e.g. INV-001" />
                                </div>
                            </div>

                            {/* Purchase Amount (Debit) */}
                            {txMode !== 'payment' && (
                                <div>
                                    <label className="block font-semibold mb-1 text-sm text-orange-600">
                                        📦 Total Purchase Amount (Debit)
                                    </label>
                                    <input aria-label=" Total Purchase Amount (Debit) " type="number" min="0" step="any" value={txForm.purchase_amount}
                                        onChange={e => setTxForm(f => ({ ...f, purchase_amount: e.target.value }))}
                                        className="w-full px-4 py-2.5 border border-orange-200 bg-orange-50 rounded-lg focus:ring-2 focus:ring-orange-400 outline-none text-sm"
                                        placeholder="0  — kitna maal liya (Rs.)" />
                                    <p className="text-xs text-gray-500 mt-0.5">Supplier sy jo maal purchase kiya uski total value</p>
                                </div>
                            )}

                            {/* Paid Amount (Credit) */}
                            {txMode !== 'purchase' && (
                                <div>
                                    <label className="block font-semibold mb-1 text-sm text-green-600">
                                        💵 Amount Paid (Credit)
                                    </label>
                                    <input aria-label=" Amount Paid (Credit) " type="number" min="0" step="any" value={txForm.paid_amount}
                                        onChange={e => setTxForm(f => ({ ...f, paid_amount: e.target.value }))}
                                        className="w-full px-4 py-2.5 border border-green-200 bg-green-50 rounded-lg focus:ring-2 focus:ring-green-400 outline-none text-sm"
                                        placeholder="0  — kitna paisa diya (Rs.)" />
                                    <p className="text-xs text-gray-500 mt-0.5">How much you paid the supplier now</p>
                                </div>
                            )}

                            {/* Balance Preview */}
                            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                                <p className="text-xs text-gray-500 uppercase font-bold tracking-wide mb-2">Balance Calculation</p>
                                <div className="flex flex-col gap-1 text-sm">
                                    <div className="flex justify-between text-gray-600">
                                        <span>Previous Balance</span>
                                        <span className="font-semibold">Rs. {Number(prevBalance).toLocaleString()}</span>
                                    </div>
                                    {purchaseAmt > 0 && (
                                        <div className="flex justify-between text-orange-600">
                                            <span>+ Purchase (Debit)</span>
                                            <span className="font-semibold">Rs. {purchaseAmt.toLocaleString()}</span>
                                        </div>
                                    )}
                                    {paidAmt > 0 && (
                                        <div className="flex justify-between text-green-600">
                                            <span>− Payment (Credit)</span>
                                            <span className="font-semibold">Rs. {paidAmt.toLocaleString()}</span>
                                        </div>
                                    )}
                                    <div className="border-t border-gray-300 mt-1 pt-1 flex justify-between font-bold text-base">
                                        <span className="text-gray-800">New Balance</span>
                                        <span className={newBalance > 0 ? 'text-red-600' : 'text-green-700'}>
                                            Rs. {newBalance.toLocaleString()}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Details */}
                            <div>
                                <label className="block text-gray-700 font-medium mb-1 text-sm">Details (Optional)</label>
                                <textarea aria-label="Details (Optional)" rows="2" value={txForm.details}
                                    onChange={e => setTxForm(f => ({ ...f, details: e.target.value }))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none"
                                    placeholder="Saman ki tafseel ya bill link..." />
                            </div>

                            {/* Payment Mode + Transaction Ref */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-gray-700 font-medium mb-1 text-sm">Payment Mode</label>
                                    <select aria-label="Payment Mode" value={txForm.payment_mode}
                                        onChange={e => setTxForm(f => ({ ...f, payment_mode: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-white">
                                        <option value="cash">Cash</option>
                                        <option value="bank">Bank Transfer</option>
                                        <option value="cheque">Cheque</option>
                                        <option value="online">Online/JazzCash</option>
                                        <option value="other">Other</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-gray-700 font-medium mb-1 text-sm">Transaction Ref</label>
                                    <input aria-label="Transaction Ref" type="text" value={txForm.transaction_ref}
                                        onChange={e => setTxForm(f => ({ ...f, transaction_ref: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                        placeholder="Cheque # / Txn ID" />
                                </div>
                            </div>

                            {/* Note */}
                            <div>
                                <label className="block text-gray-700 font-medium mb-1 text-sm">Note (Optional)</label>
                                <textarea aria-label="Note (Optional)" rows="2" value={txForm.note}
                                    onChange={e => setTxForm(f => ({ ...f, note: e.target.value }))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none"
                                    placeholder="e.g. Monthly payment / Outstanding cleared..." />
                            </div>

                            <div className="flex gap-3 pt-1">
                                <button type="submit" disabled={saving}
                                    className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition disabled:opacity-50">
                                    {saving ? 'Saving...' : '✅ Save Transaction'}
                                </button>
                                <button type="button" onClick={resetForm}
                                    className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition">
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Purchase Payment Modal */}
            <EditPurchasePaymentModal
                isOpen={!!purchaseToEditPayment}
                purchase={purchaseToEditPayment}
                onClose={() => setPurchaseToEditPayment(null)}
                onSuccess={() => {
                    setPurchaseToEditPayment(null)
                    fetchSupplierData()
                }}
            />

            {/* Phone Return Modal */}
            <PhoneReturnModal
                isOpen={!!phoneForReturn}
                phone={phoneForReturn}
                supplier={supplier}
                onClose={() => setPhoneForReturn(null)}
                onSuccess={() => {
                    setPhoneForReturn(null)
                    fetchSupplierData()
                }}
            />
        </div>
    )
}

export default SupplierLedger
