import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { printHTML, getShopBranding } from '../utils/printUtils'
import { db, addToSyncQueue } from '../services/db'
import { adjustCustomerBalance, adjustProductStock, releasePhoneFromSale } from '../services/atomicOps'
import { generateOutstandingPDF, shareOrDownloadPDF } from '../utils/pdfShare'
import { getBankAccounts, creditBankBalance, deductBankBalance, reverseSaleFromAccounts } from '../services/bankService'
import { customerLedgerEffect, isCountedSale, netAmount, paidAmount, unusualAmount, isCashName } from '../utils/moneyMath'
import { applyMoneyOp, accountForMode } from '../services/moneyOps'
import EditLedgerEntryModal from '../components/EditLedgerEntryModal'
import { notify } from '../utils/toast'
import { confirmDialog, confirmUnusualAmount } from '../utils/dialog'

const normalizeSaleItem = (it, phonesPool = [], productsPool = []) => {
    let snap = null
    if (it.imei_snapshot) {
        if (typeof it.imei_snapshot === 'object') {
            snap = it.imei_snapshot
        } else if (typeof it.imei_snapshot === 'string') {
            try { snap = JSON.parse(it.imei_snapshot) } catch (_) {}
        }
    }
    const ph = it.phones || (phonesPool || []).find(p => p.id === it.phone_id || (it.sale_id && p.sale_id === it.sale_id)) || snap
    const prod = it.products || (productsPool || []).find(p => p.id === it.product_id)

    let name = (it.product_name && it.product_name.trim()) || (prod ? prod.name : null)
    if (!name && ph) {
        const brand = ph.brand && ph.brand !== 'Unknown' ? ph.brand + ' ' : ''
        name = `${brand}${ph.model || 'Smartphone'}`.trim()
    }
    if (!name) name = 'Item'

    const specs = ph ? [ph.storage, ph.color, ph.pta_status ? ph.pta_status.toUpperCase() : null].filter(Boolean).join(' • ') : null
    const imei = ph ? (ph.imei_1 || ph.imei || ph.imei1 || (typeof it.imei_snapshot === 'string' && !it.imei_snapshot.startsWith('{') ? it.imei_snapshot : null)) : null
    const price = it.unit_price ?? (it.price ?? (it.subtotal || 0))
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
}

function CustomerLedger() {
    const { id } = useParams()
    const { user } = useAuth()
    const navigate = useNavigate()

    const importRef = useRef()
    const [customer, setCustomer] = useState(null)
    const [loading, setLoading] = useState(true)
    const [ledger, setLedger] = useState([])
    const [showTxModal, setShowTxModal] = useState(false)
    const [txForm, setTxForm] = useState({
        date: new Date().toISOString().slice(0, 10),
        bill_number: '',
        sale_amount: '',
        payment_amount: '',
        details: '',
        payment_mode: 'cash',
        transaction_ref: '',
        note: ''
    })
    const [saving, setSaving] = useState(false)
    const [expandedSale, setExpandedSale] = useState(null)
    const [lastPayment, setLastPayment] = useState(null) // for print voucher after recording
    const [selectedIds, setSelectedIds] = useState(new Set())

    useEffect(() => {
        if (id && user?.shop_id) fetchCustomerData()
    }, [id, user?.shop_id])

    const fetchCustomerData = async () => {
        setLoading(true)
        try {
            if (!navigator.onLine) throw new Error('Offline')

            const fetchPromise = Promise.all([
                supabase.from('customers').select('*').eq('id', id).eq('shop_id', user.shop_id).maybeSingle(),
                supabase.from('sales').select('*, sale_items(*, phones(*), products(name))').eq('customer_id', id).eq('shop_id', user.shop_id).order('created_at', { ascending: true }),
                supabase.from('customer_payments').select('*').eq('customer_id', id).eq('shop_id', user.shop_id)
            ])
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
            const [custRes, salesRes, paymentsRes] = await Promise.race([fetchPromise, timeoutPromise])

            // If customer not found, show not-found screen
            if (!custRes.data) { setLoading(false); return }
            setCustomer(custRes.data)

            const sales = salesRes.error ? [] : (salesRes.data || [])
            const payments = paymentsRes.error ? [] : (paymentsRes.data || [])

            // 4. Combine into Ledger
            const combined = [
                ...(sales || []).map(s => ({
                    id: s.id,
                    date: s.created_at,
                    type: 'sale',
                    payment_type: s.payment_type,
                    sale_type: s.sale_type ?? null,
                    status: s.status ?? null,
                    payment_details: s.payment_details ?? null,
                    amount: netAmount(s),
                    paid_amount: paidAmount(s),
                    note: `Invoice #${String(s.id).slice(-8)}`,
                    items: (s.sale_items || []).map(it => normalizeSaleItem(it))
                })),
                ...(payments || []).map(p => ({
                    id: p.id,
                    date: p.created_at,
                    type: p.payment_type === 'return' ? 'return' : p.payment_type === 'debit' ? 'debit' : 'payment',
                    payment_type: p.payment_type,
                    amount: p.amount,
                    note: p.note || 'Cash Payment',
                    bill_number: p.bill_number || null,
                    details: p.details || null,
                    payment_mode: p.payment_mode || null,
                    transaction_ref: p.transaction_ref || null,
                }))
            ]

            // Sort by date
            combined.sort((a, b) => new Date(a.date) - new Date(b.date))

            // Check for initial opening balance / previous dues
            const currentTotalDue = Number(custRes.data.outstanding_balance ?? custRes.data.balance ?? 0)
            const netTxBalance = combined.reduce((acc, item) => acc + customerLedgerEffect(item), 0)

            const openingDues = currentTotalDue - netTxBalance
            if (Math.abs(openingDues) >= 1) {
                combined.unshift({
                    id: 'opening-balance',
                    date: custRes.data.created_at || (combined[0]?.date ? new Date(new Date(combined[0].date).getTime() - 60000).toISOString() : new Date().toISOString()),
                    type: openingDues > 0 ? 'debit' : 'payment',
                    payment_type: openingDues > 0 ? 'debit' : 'payment',
                    amount: Math.abs(openingDues),
                    note: openingDues > 0 ? 'Opening Balance (Previous Unpaid Dues)' : 'Opening Credit (Advance Balance)',
                    items: []
                })
            }

            // Calculate running balance
            let running = 0
            const withBalance = combined.map(item => {
                running += customerLedgerEffect(item)
                return { ...item, balance: running }
            })

            setLedger(withBalance.reverse()) // newest first for display
        } catch (e) {
            console.log('CustomerLedger: Reconstructing from local DB (Offline)')
            try {
                const sid = String(user.shop_id)
                const [lCusts, lSales, lItems, lPayments, lPhones, lProducts] = await Promise.all([
                    db.customers.toArray(),
                    db.sales.toArray(),
                    db.sale_items.toArray(),
                    db.customer_payments.toArray(),
                    db.phones ? db.phones.toArray() : [],
                    db.products ? db.products.toArray() : []
                ])

                const cust = lCusts.find(c => String(c.id) === String(id))
                if (cust) setCustomer(cust)

                const mySales = lSales.filter(s => String(s.customer_id) === String(id))
                const myPayments = lPayments.filter(p => String(p.customer_id) === String(id))

                const combined = [
                    ...mySales.map(s => ({
                        id: s.id,
                        date: s.created_at,
                        type: 'sale',
                        payment_type: s.payment_type,
                        sale_type: s.sale_type ?? null,
                        status: s.status ?? null,
                        payment_details: s.payment_details ?? null,
                        amount: netAmount(s),
                        paid_amount: paidAmount(s),
                        note: `Invoice #${String(s.id).slice(-8)}`,
                        items: lItems.filter(i => i.sale_id === s.id).map(it => normalizeSaleItem(it, lPhones, lProducts))
                    })),
                    ...myPayments.map(p => ({
                        id: p.id,
                        date: p.created_at,
                        type: p.payment_type === 'return' ? 'return' : p.payment_type === 'debit' ? 'debit' : 'payment',
                        payment_type: p.payment_type,
                        amount: p.amount,
                        note: p.note || 'Cash Payment',
                        bill_number: p.bill_number || null,
                        details: p.details || null,
                        payment_mode: p.payment_mode || null,
                        transaction_ref: p.transaction_ref || null,
                    }))
                ]

                combined.sort((a, b) => new Date(a.date) - new Date(b.date))
                let running = 0
                const withBalance = combined.map(item => {
                    running += customerLedgerEffect(item)
                    return { ...item, balance: running }
                })
                // Check for opening dues difference offline
                const cOb = Number(cust?.outstanding_balance ?? cust?.balance ?? 0)
                const offlineNet = withBalance.length > 0 ? withBalance[withBalance.length - 1].balance : 0
                const diff = cOb - offlineNet
                if (Math.abs(diff) >= 1) {
                    withBalance.unshift({
                        id: 'opening-offline', date: cust?.created_at || new Date().toISOString(),
                        type: diff > 0 ? 'debit' : 'payment', payment_type: diff > 0 ? 'debit' : 'payment', amount: Math.abs(diff),
                        note: diff > 0 ? 'Opening Balance (Previous Unpaid Dues)' : 'Opening Credit (Advance Balance)', items: [], balance: diff
                    })
                }
                setLedger(withBalance.reverse())
            } catch (err) { console.error('Final CustomerLedger Fallback Error:', err) }
        } finally {
            setLoading(false)
        }
    }

    const printPaymentVoucher = (amount, note, date) => {
        const branding = getShopBranding(user?.shop_id)
        printHTML(`<html><head><title>Payment Receipt</title>
        <style>
          @page{size:80mm auto;margin:2mm}
          *{box-sizing:border-box}
          body{font-family:monospace;width:302px;margin:0 auto;padding:12px 8px;font-size:13px;}
          h2,p.c{text-align:center;margin:3px 0;}
          hr{border-top:1px dashed #000;margin:8px 0;}
          .row{display:flex;justify-content:space-between;padding:3px 0;}
          .bold{font-weight:bold;}
        </style></head><body>
        <h2>${branding.name}</h2>
        ${branding.phone ? `<p class="c" style="font-size:11px;">${branding.phone}</p>` : ''}
        ${branding.address ? `<p class="c" style="font-size:10px;color:#555;">${branding.address}</p>` : ''}
        <p class="c bold" style="font-size:15px;">PAYMENT RECEIPT</p>
        <hr/>
        <div class="row"><span>Customer:</span><span class="bold">${customer.name}</span></div>
        <div class="row"><span>Phone:</span><span>${customer.phone || '-'}</span></div>
        <div class="row"><span>Date:</span><span>${new Date(date || Date.now()).toLocaleString('en-PK')}</span></div>
        <hr/>
        <div class="row bold" style="font-size:16px;"><span>Amount Received</span><span>Rs. ${Number(amount).toLocaleString()}</span></div>
        ${note ? `<div class="row"><span>Note:</span><span>${note}</span></div>` : ''}
        <hr/>
        <div class="row"><span>Remaining Balance:</span><span class="bold">Rs. ${((customer.outstanding_balance || 0) - Number(amount)).toLocaleString()}</span></div>
        <hr/>
        <p class="c" style="font-size:11px;color:#888;">Thank you! Payment received in full.</p>
        </body></html>`)
    }

    // ── Excel Export ──────────────────────────────────────────────────────────
    const handleExport = () => {
        if (!ledger.length) return notify('There are no transactions to export.')
        const rows = [...ledger].reverse().map((item, idx) => ({
            'Sr#': idx + 1,
            'Date': new Date(item.date).toLocaleDateString('en-PK'),
            'Bill #': item.bill_number || (item.type === 'sale' ? `INV-${String(item.id).slice(-8)}` : ''),
            'Description': item.note,
            'Items': (item.items || []).map(i => {
                const name = i.display_name || i.product_name || 'Item'
                const sp = i.specs ? ` (${i.specs})` : ''
                const im = i.imei ? ` [IMEI: ${i.imei}]` : ''
                return `${name}${sp}${im}`
            }).join('; ') || item.details || '',
            'Type': item.type === 'sale' ? 'Sale' : item.type === 'debit' ? 'Manual Sale' : item.type === 'return' ? 'Return' : 'Payment',
            'Debit (Sale)': (item.type === 'sale' || item.type === 'debit') ? Number(item.amount) : '',
            'Credit (Payment)': (item.type === 'payment' || item.type === 'return') ? Math.abs(Number(item.amount)) : '',
            'Balance': Number(item.balance),
            'Details': item.details || '',
            'Payment Mode': item.payment_mode || '',
            'Transaction Ref': item.transaction_ref || '',
        }))
        const ws = XLSX.utils.json_to_sheet(rows)
        ws['!cols'] = [{ wch: 5 }, { wch: 14 }, { wch: 14 }, { wch: 25 }, { wch: 35 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 18 }]
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Ledger')
        const safeName = (customer?.name || 'customer').replace(/[^a-z0-9]/gi, '_')
        XLSX.writeFile(wb, `${safeName}_ledger.xlsx`)
    }

    // ── Excel Import ──────────────────────────────────────────────────────────
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

            const confirmed = await confirmDialog(`Import ${rows.length} transactions?\nThe "Debit (Sale)" column becomes sale entries and "Credit (Payment)" becomes payments.`, { confirmLabel: 'Import transactions' })
            if (!confirmed) return

            const insertRows = []
            let balanceDelta = 0

            for (const row of rows) {
                const debit = parseFloat(row['Debit (Sale)'] ?? row['Debit'] ?? row['debit'] ?? 0) || 0
                const credit = parseFloat(row['Credit (Payment)'] ?? row['Credit'] ?? row['credit'] ?? 0) || 0
                const dateVal = row['Date'] || row['date'] || new Date().toLocaleDateString('en-PK')
                const billNo = String(row['Bill #'] ?? row['bill_number'] ?? '').trim() || null
                const note = String(row['Description'] ?? row['Note'] ?? row['note'] ?? '').trim()
                const details = String(row['Details'] ?? row['details'] ?? '').trim() || null
                const paymentMode = String(row['Payment Mode'] ?? row['payment_mode'] ?? '').trim() || null
                const txRef = String(row['Transaction Ref'] ?? row['transaction_ref'] ?? '').trim() || null

                let parsedDate
                try {
                    if (dateVal instanceof Date && !isNaN(dateVal)) {
                        parsedDate = dateVal.toISOString()
                    } else if (typeof dateVal === 'number') {
                        parsedDate = new Date(Math.round((dateVal - 25569) * 86400 * 1000)).toISOString()
                    } else {
                        parsedDate = new Date(dateVal).toISOString()
                    }
                } catch { parsedDate = new Date().toISOString() }

                const common = { shop_id: user.shop_id, customer_id: id, bill_number: billNo, details, payment_mode: paymentMode, transaction_ref: txRef, created_at: parsedDate }
                if (debit > 0) {
                    insertRows.push({ ...common, amount: debit, payment_type: 'debit', note: note || 'Imported Sale Entry' })
                    balanceDelta += debit
                }
                if (credit > 0) {
                    insertRows.push({ ...common, amount: credit, payment_type: 'payment', note: note || 'Imported Payment' })
                    balanceDelta -= credit
                }
            }

            if (!insertRows.length) { notify('No usable rows found. Check the Debit and Credit columns.', 'error'); return }

            if (navigator.onLine) {
                let { error } = await supabase.from('customer_payments').insert(insertRows)
                if (error && (error.message?.includes('column') || error.message?.includes('schema cache') || error.code === 'PGRST204' || error.code === '42703' || String(error.status) === '400')) {
                    const coreRows = insertRows.map(r => ({
                        shop_id: r.shop_id,
                        customer_id: r.customer_id,
                        amount: r.amount,
                        description: [r.bill_number ? `[Bill #${r.bill_number}]` : '', r.payment_type ? `[${r.payment_type}]` : '', r.note].filter(Boolean).join(' ') || 'Imported Payment',
                        created_at: r.created_at
                    }))
                    const retryRes = await supabase.from('customer_payments').insert(coreRows)
                    error = retryRes.error
                }
                if (error) throw error
                await changeBalance(balanceDelta)
            } else {
                for (const row of insertRows) {
                    const rec = { ...row, id: crypto.randomUUID() }
                    await db.customer_payments.add(rec)
                    await addToSyncQueue('customer_payments', 'INSERT', rec)
                }
                await changeBalance(balanceDelta)
            }

            notify(`${insertRows.length} entries imported.`, 'success')
            fetchCustomerData()
        } catch (err) {
            console.error('Import error:', err)
            notify('Import failed: ' + err.message)
        }
    }

    // Balance changes are sent as amounts the database adds (queued when offline), so two
    // devices cannot overwrite each other and both balance columns stay equal.
    const changeBalance = async (delta) => {
        const d = Number(delta) || 0
        if (d === 0) return true
        const res = await adjustCustomerBalance(id, d)
        if (!res.ok) {
            console.error('Customer balance not updated:', res.error)
            notify(`Saved, but the customer's balance could not be changed by Rs. ${d.toLocaleString()} (${res.error}). Please check it.`)
            return false
        }
        setCustomer(c => c ? { ...c, outstanding_balance: (Number(c.outstanding_balance) || 0) + d, balance: (Number(c.outstanding_balance) || 0) + d } : c)
        return true
    }

    // Deleting a sale puts its stock back and its phones back in stock (only phones that
    // still belong to this sale; a bought-back phone is left alone)
    const rollbackSaleInventory = async (item) => {
        let saleItems = []
        if (navigator.onLine) {
            const { data } = await supabase.from('sale_items').select('*').eq('sale_id', item.id)
            saleItems = data || []
        } else {
            const lItems = await db.sale_items.toArray()
            saleItems = lItems.filter(i => String(i.sale_id) === String(item.id))
        }
        for (const si of saleItems) {
            if (si.phone_id) {
                if (navigator.onLine) {
                    const phoneRes = await releasePhoneFromSale(si.phone_id, { id: item.id, created_at: item.date })
                    if (phoneRes.skipped) console.warn('Delete sale: phone left unchanged -', phoneRes.skipped)
                } else if (db.phones) {
                    await db.phones.update(si.phone_id, { status: 'in_stock', sale_id: null, sold_at: null }).catch(() => {})
                }
            }
            if (si.product_id) {
                const qty = (Number(si.quantity ?? 1) || 0) - (Number(si.returned_qty) || 0)
                const stockRes = await adjustProductStock(si.product_id, qty)
                if (!stockRes.ok) console.warn('Delete sale: stock not restored for product', si.product_id, stockRes.error)
            }
        }
    }

    // Balance effect of removing a ledger entry
    const deletionDelta = (item) => -customerLedgerEffect(item)

    const resetTxForm = () => {
        setTxForm({ date: new Date().toISOString().slice(0, 10), bill_number: '', sale_amount: '', payment_amount: '', details: '', payment_mode: 'cash', transaction_ref: '', note: '' })
        setShowTxModal(false)
    }

    const handleAddTransaction = async (e) => {
        e.preventDefault()
        const saleAmt = parseFloat(txForm.sale_amount) || 0
        const payAmt = parseFloat(txForm.payment_amount) || 0
        if (saleAmt === 0 && payAmt === 0) return notify('Enter a sale amount, a payment amount, or both.')
        // Catch an extra digit before it is saved
        const pastAmounts = (kind) => ledger.filter(l => l.type === kind).map(l => l.amount)
        if (!await confirmUnusualAmount(saleAmt, unusualAmount(saleAmt, pastAmounts('debit')), 'Sale amount')) return
        if (!await confirmUnusualAmount(payAmt, unusualAmount(payAmt, pastAmounts('payment')), 'Payment received')) return
        setSaving(true)
        const now = txForm.date ? new Date(txForm.date + 'T12:00:00').toISOString() : new Date().toISOString()
        const commonFields = {
            customer_id: id,
            bill_number: txForm.bill_number.trim() || null,
            details: txForm.details.trim() || null,
            payment_mode: txForm.payment_mode || null,
            transaction_ref: txForm.transaction_ref.trim() || null,
            created_at: now
        }
        const rows = []
        if (saleAmt > 0) rows.push({ ...commonFields, amount: saleAmt, payment_type: 'debit', note: txForm.note.trim() || 'Manual Sale Entry' })
        if (payAmt > 0) rows.push({ ...commonFields, amount: payAmt, payment_type: 'payment', note: txForm.note.trim() || 'Cash Received' })

        try {
            // Money received goes into the cash / bank account for its payment mode
            let account = null
            if (payAmt > 0) {
                try { account = accountForMode(await getBankAccounts(user.shop_id), txForm.payment_mode) } catch (_) { /* no accounts set up */ }
            }
            // Entry, customer balance and account are saved together: all or nothing
            const res = await applyMoneyOp({
                shop_id: user.shop_id,
                inserts: rows.map(r => ({
                    table: 'customer_payments',
                    row: r,
                    // older databases keep only a description column
                    fallbackRow: {
                        shop_id: user.shop_id,
                        customer_id: r.customer_id,
                        amount: r.amount,
                        description: [r.bill_number ? `[Bill #${r.bill_number}]` : '', r.payment_type ? `[${r.payment_type}]` : '', r.note, r.details].filter(Boolean).join(' ') || 'Customer Transaction',
                        created_at: r.created_at
                    }
                })),
                customer: { id, delta: saleAmt - payAmt },
                accounts: account ? [{
                    account_id: account.id,
                    delta: payAmt,
                    reference_type: 'CUSTOMER_PAYMENT',
                    reference_id: String(id),
                    description: `Customer Payment: ${customer?.name || 'Customer'} (Ref: ${txForm.transaction_ref || txForm.bill_number || 'Khata'})`
                }] : []
            })
            if (!res.ok) throw new Error(res.error || 'Could not save the transaction')
            setCustomer(c => c ? { ...c, outstanding_balance: (Number(c.outstanding_balance) || 0) + saleAmt - payAmt, balance: (Number(c.outstanding_balance) || 0) + saleAmt - payAmt } : c)
            if (payAmt > 0) setLastPayment({ amount: payAmt, note: txForm.note.trim() || 'Cash Received', date: now })
            resetTxForm()
            fetchCustomerData()
            if (res.queued) notify('Saved on this device. It syncs when you are back online.', 'info')
            else if (res.problems?.length) notify(`Saved, but please check:\n${res.problems.join('\n')}`)
        } catch (error) {
            notify('Error: ' + (error?.message || String(error)))
        } finally {
            setSaving(false)
        }
    }

    // The computed "opening balance" row is not a stored entry
    const isOpeningRow = (item) => String(item?.id ?? '').startsWith('opening')

    // ── Correct a manual entry (payment / debit) without deleting it ──────────
    const [editEntry, setEditEntry] = useState(null)
    const [savingEdit, setSavingEdit] = useState(false)
    const canEditEntry = (item) =>
        !isOpeningRow(item) && /^\d+$/.test(String(item.id)) &&
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
                updates: [{ table: 'customer_payments', id: item.id, set: { amount, note: newNote } }],
                // a debit adds to the balance, a payment takes off it
                customer: { id, delta: isPayment ? -diff : diff },
                accounts: account ? [{
                    account_id: account.id,
                    delta: diff,
                    reference_type: 'CUSTOMER_PAYMENT_EDIT',
                    reference_id: String(item.id),
                    description: `Corrected payment: ${customer?.name || 'Customer'} (was Rs. ${oldAmount.toLocaleString()}, now Rs. ${amount.toLocaleString()})`
                }] : []
            })
            if (!res.ok) throw new Error(res.error || 'Could not save the correction')
            setEditEntry(null)
            fetchCustomerData()
            if (res.queued) notify('Offline: correction saved on this device and will sync when online.')
        } catch (err) {
            notify('Correction not saved: ' + (err?.message || String(err)))
        } finally {
            setSavingEdit(false)
        }
    }


    // Removes one ledger entry: stock and phones back for a sale, the money back out of
    // (or into) the account it touched, then the record itself. Used by single and bulk delete.
    const removeLedgerEntry = async (item) => {
        if (item.type === 'sale') {
            // 1. Rollback inventory and accounts before deleting sale
            try {
                // A quotation (or a voided sale) never took stock or money
                if (isCountedSale(item)) {
                    await rollbackSaleInventory(item)
                    // Take the money received back out of the accounts it went into
                    await reverseSaleFromAccounts({
                        shopId: user.shop_id,
                        sale: {
                            id: item.id,
                            sale_type: item.sale_type,
                            status: item.status,
                            payment_type: item.payment_type,
                            payment_details: item.payment_details,
                            net_amount: item.amount,
                            paid_amount: item.paid_amount
                        },
                        description: `Sale Deletion Reversal (Customer Ledger #${item.id})`
                    })
                }
            } catch (rollbackErr) {
                console.warn('Rollback warning on sale deletion:', rollbackErr)
            }

            // Cascade: delete sale_items first, then sale
            if (navigator.onLine) {
                await supabase.from('sale_items').delete().eq('sale_id', item.id)
                const { error } = await supabase.from('sales').delete().eq('id', item.id)
                if (error) throw error
            } else {
                const lItems = await db.sale_items.toArray()
                const toDelIds = lItems.filter(i => String(i.sale_id) === String(item.id)).map(i => i.id)
                await db.sale_items.bulkDelete(toDelIds)
                await db.sales.delete(item.id)
                await addToSyncQueue('sales', 'DELETE', { id: item.id })
            }
        } else {
            // payment or return — delete from customer_payments
            const payAmt = Math.abs(Number(item.amount || 0))
            if (payAmt > 0) {
                try {
                    const accounts = await getBankAccounts(user.shop_id)
                    const mode = String(item.payment_mode || item.payment_type || 'cash').toLowerCase()
                    const isBank = ['online', 'bank', 'jazzcash', 'easypaisa', 'sadapay', 'nayapay'].includes(mode)
                    const targetAcc = accounts.find(a =>
                        isBank
                            ? (!isCashName(a.bank_name) && !isCashName(a.account_name))
                            : (isCashName(a.bank_name) || isCashName(a.account_name))
                    ) || accounts[0]

                    if (targetAcc) {
                        if (item.payment_type === 'refund') {
                            // Deleting a refund restores money to account
                            await creditBankBalance({
                                shopId: user.shop_id,
                                accountId: targetAcc.id,
                                amount: payAmt,
                                referenceType: 'REFUND_DELETION',
                                referenceId: String(item.id),
                                description: `Deleted Customer Refund Reversal (${customer?.name || 'Customer'})`
                            })
                        } else if (item.payment_type === 'payment' || !item.payment_type) {
                            // Deleting a received payment reverses money from account
                            await deductBankBalance({
                                shopId: user.shop_id,
                                accountId: targetAcc.id,
                                amount: payAmt,
                                description: `Deleted Customer Payment Reversal (${customer?.name || 'Customer'})`
                            })
                        }
                    }
                } catch (accErr) {
                    console.warn('Could not reverse account balance for deleted payment:', accErr)
                }
            }

            if (navigator.onLine) {
                const { error } = await supabase.from('customer_payments').delete().eq('id', item.id)
                if (error) throw error
            } else {
                await db.customer_payments.delete(item.id)
                await addToSyncQueue('customer_payments', 'DELETE', { id: item.id })
            }
        }
    }

    const handleDeleteTransaction = async (item) => {
        if (isOpeningRow(item)) { notify('The opening balance row cannot be deleted. Use Reconcile to change it.'); return }
        const label = item.type === 'sale' ? 'Sale/Invoice' : item.type === 'payment' ? 'Payment' : 'Return'
        if (!await confirmDialog(`Delete this ${label.toLowerCase()}?\nAmount: Rs. ${Number(item.amount).toLocaleString()}\nNote: ${item.note}\n\nThe customer balance is adjusted to match.`, { confirmLabel: 'Delete entry', danger: true })) return

        try {
            await removeLedgerEntry(item)

            // Reverse the entry's effect on the balance (no cut-off at zero: advances are kept)
            await changeBalance(deletionDelta(item))
            fetchCustomerData()
        } catch (err) {
            notify('Not deleted: ' + err.message, 'error')
        }
    }

    const selectableItems = ledger.filter(item => !isOpeningRow(item))
    const allSelected = selectableItems.length > 0 && selectableItems.every(item => selectedIds.has(item.id))

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
            setSelectedIds(new Set(selectableItems.map(i => i.id)))
        }
    }

    const handleBulkDelete = async () => {
        const toDelete = ledger.filter(item => selectedIds.has(item.id) && !isOpeningRow(item))
        if (!toDelete.length) return
        if (!await confirmDialog(`Delete ${toDelete.length} transactions?\nThe customer balance is adjusted to match.`, { confirmLabel: 'Delete transactions', danger: true })) return

        let totalDelta = 0
        try {
            for (const item of toDelete) {
                await removeLedgerEntry(item)
                totalDelta += deletionDelta(item)
            }
            await changeBalance(totalDelta)
            setSelectedIds(new Set())
        } catch (err) {
            notify('Some entries were not deleted: ' + err.message, 'error')
            fetchCustomerData()
        }
    }

    const handleReconcileBalance = async () => {
        if (!ledger.length && customer?.outstanding_balance === 0) return
        const computedBalance = ledger.length > 0 ? ledger[0].balance : 0
        const confirmed = await confirmDialog(`Set the balance to match the ledger?\nSaved balance: Rs. ${customer?.outstanding_balance || 0}\nLedger adds up to: Rs. ${computedBalance}`, { confirmLabel: 'Set balance' })
        if (!confirmed) return

        try {
            // Deliberately sets the exact ledger total (both balance columns)
            const fixed = { outstanding_balance: computedBalance, balance: computedBalance }
            if (navigator.onLine) {
                const { error: recErr } = await supabase.from('customers').update(fixed).eq('id', id)
                if (recErr) throw recErr
            } else {
                await addToSyncQueue('customers', 'UPDATE', { id, ...fixed })
            }
            await db.customers.update(parseInt(id), fixed).catch(() => {})
            setCustomer(c => c ? { ...c, ...fixed } : c)
            notify(`✅ Balance reconciled successfully to Rs. ${computedBalance}`)
        } catch (err) {
            notify('Reconcile error: ' + err.message)
        }
    }

    if (loading) return <div className="p-8">Loading ledger...</div>
    if (!customer) return <div className="p-8 text-red-500">Customer not found!</div>

    return (
        <div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                    <button onClick={() => navigate('/customers')} className="text-blue-500 mb-2 hover:underline text-sm font-semibold">← Back to Customers</button>
                    <h1 className="text-3xl font-bold text-gray-800">{customer.name}</h1>
                    <p className="text-gray-500">{customer.phone} | {customer.address}</p>
                </div>
                <div className="w-full sm:w-auto text-left sm:text-right flex flex-col sm:items-end gap-3">
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex-1 w-full sm:w-auto">
                        <p className="text-sm text-gray-500 uppercase tracking-wider font-semibold">Total Outstanding</p>
                        <p className={`text-3xl font-bold ${customer.outstanding_balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            Rs. {customer.outstanding_balance || 0}
                        </p>
                    </div>
                    <div className="flex gap-2 flex-wrap justify-end">
                        {customer.phone && (
                            <button
                                onClick={async (e) => {
                                    const btn = e.currentTarget
                                    btn.disabled = true
                                    btn.innerHTML = '⏳ Generating PDF...'
                                    try {
                                        const { data: shop } = await supabase.from('shops').select('*').eq('id', user.shop_id).maybeSingle()
                                        const phone = customer.phone.replace(/[^0-9]/g, '')
                                        let formattedPhone = phone
                                        if (phone.startsWith('03')) formattedPhone = '92' + phone.substring(1)
                                        else if (phone.length === 10) formattedPhone = '92' + phone

                                        const template = shop?.wa_reminder_template || "Hello [Name], this is a reminder from [Shop Name] regarding your outstanding balance of Rs. [Amount]. Please clear your dues at your earliest convenience. Thank you!"
                                        const msg = template
                                            .replace(/\[Name\]/g, customer.name)
                                            .replace(/\[Amount\]/g, (customer.outstanding_balance || 0).toLocaleString())
                                            .replace(/\[Shop Name\]/g, shop?.name || 'our shop')

                                        const shopInfo = { name: shop?.name || 'Shop', phone: shop?.phone || '', address: shop?.address || '' }
                                        const pdfBlob = await generateOutstandingPDF(customer, ledger, shopInfo)
                                        await shareOrDownloadPDF(pdfBlob, `outstanding-${customer.name.replace(/\s+/g, '-')}.pdf`, formattedPhone, msg)
                                    } catch (err) {
                                        console.error('Outstanding PDF failed:', err)
                                        const phone = customer.phone.replace(/[^0-9]/g, '')
                                        let formattedPhone = phone
                                        if (phone.startsWith('03')) formattedPhone = '92' + phone.substring(1)
                                        else if (phone.length === 10) formattedPhone = '92' + phone
                                        const msg = `${customer.name} — Outstanding: Rs. ${(customer.outstanding_balance || 0).toLocaleString()}`
                                        window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`, '_blank')
                                    } finally {
                                        btn.disabled = false
                                        btn.innerHTML = '<span>💬</span> WhatsApp Reminder'
                                    }
                                }}
                                className="w-full sm:w-auto px-4 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-lg transition font-semibold shadow-lg flex items-center justify-center gap-2"
                            >
                                <span>💬</span> WhatsApp Reminder
                            </button>
                        )}
                        <button
                            onClick={handleReconcileBalance}
                            className="w-full sm:w-auto px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition font-semibold shadow-lg flex items-center justify-center gap-1.5"
                            title="Recalculate customer balance from transaction ledger sum"
                        >
                            ⚡ Reconcile
                        </button>
                        <button
                            onClick={() => setShowTxModal(true)}
                            className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold shadow-lg">
                            ➕ Add Transaction
                        </button>
                    </div>
                </div>
            </div>

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

            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
                <div className="divide-y divide-gray-100 md:hidden">
                    {ledger.length === 0 ? (
                        <p className="p-6 text-center text-gray-500 text-sm">No transactions found for this customer.</p>
                    ) : (
                        ledger.map((item, idx) => (
                            <div key={idx} className={`p-4 ${selectedIds.has(item.id) ? 'bg-red-50/40' : ''}`}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-xs text-gray-500">{new Date(item.date).toLocaleDateString('en-PK')}</p>
                                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                            <span className="font-semibold text-gray-800">{item.note}</span>
                                            {item.bill_number && (
                                                <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-xs font-bold">Bill #{item.bill_number}</span>
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
                                            {item.type === 'payment' && (
                                                <button
                                                    onClick={() => printPaymentVoucher(item.amount, item.note, item.date)}
                                                    className="text-xs text-blue-600 hover:underline font-bold uppercase tracking-tighter"
                                                >🖨️ Print</button>
                                            )}
                                            {item.type === 'sale' && (
                                                <button
                                                    onClick={() => setExpandedSale(expandedSale === item.id ? null : item.id)}
                                                    className="text-xs text-blue-600 hover:underline font-bold uppercase tracking-tighter"
                                                >
                                                    {expandedSale === item.id ? 'Collapse ▲' : 'Details ▼'}
                                                </button>
                                            )}
                                            {item.type === 'return' && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs uppercase font-bold">Return</span>}
                                            {item.type === 'debit' && <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs uppercase font-bold">Manual Sale</span>}
                                        </div>
                                    </div>

                                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                                        {!isOpeningRow(item) && (
                                            <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)}
                                                className="w-4 h-4 rounded cursor-pointer" />
                                        )}
                                        {canEditEntry(item) && (
                                            <button onClick={() => setEditEntry(item)} title="Correct amount" aria-label="Correct amount"
                                                className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition text-xs">✏️</button>
                                        )}
                                        {!isOpeningRow(item) && (
                                            <button
                                                onClick={() => handleDeleteTransaction(item)}
                                                title="Delete transaction"
                                                className="p-1 text-gray-500 hover:text-red-500 rounded transition text-xs"
                                            >🗑️</button>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-3 grid grid-cols-3 gap-2 text-right text-xs">
                                    <div>
                                        <p className="text-xs font-bold uppercase text-gray-500 text-left">Debit (+)</p>
                                        <p className="font-bold text-red-600">{(item.type === 'sale' || item.type === 'debit') ? `+ Rs. ${Number(item.amount).toFixed(0)}` : '—'}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold uppercase text-gray-500 text-left">Credit (-)</p>
                                        <p className="font-bold text-green-600">{(item.type === 'payment' || item.type === 'return') ? `- Rs. ${Math.abs(item.amount).toFixed(0)}` : '—'}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold uppercase text-gray-500 text-left">Balance</p>
                                        <p className="font-black text-gray-900">Rs. {item.balance.toFixed(0)}</p>
                                    </div>
                                </div>

                                {item.type === 'sale' && expandedSale === item.id && (
                                    <div className="mt-3 bg-blue-50/50 p-3 rounded-lg border border-blue-100/50">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-xs text-gray-500 uppercase font-bold tracking-widest">Payment:</span>
                                            <span className={`px-3 py-0.5 rounded-full text-xs font-bold uppercase ${item.payment_type === 'cash' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
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
                                                    <div key={iidx} className="flex flex-col sm:flex-row sm:items-center justify-between text-xs bg-white/90 p-2.5 rounded-xl border border-blue-100/80 shadow-2xs gap-1.5">
                                                        <div className="space-y-0.5">
                                                            <p className="text-gray-900 font-bold text-xs">{name}</p>
                                                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                                                                {specs && <span>{specs}</span>}
                                                                {imei && (
                                                                    <span className="font-mono bg-blue-50/80 text-blue-800 border border-blue-200/60 px-1.5 py-0.2 rounded text-xs">
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
                                <th className="px-6 py-4 text-left font-semibold text-gray-600 whitespace-nowrap">Date</th>
                                <th className="px-6 py-4 text-left font-semibold text-gray-600 min-w-[200px]">Description</th>
                                <th className="px-6 py-4 text-right font-semibold text-gray-600 whitespace-nowrap">Debit (Sale)</th>
                                <th className="px-6 py-4 text-right font-semibold text-gray-600 whitespace-nowrap">Credit (Payment)</th>
                                <th className="px-6 py-4 text-right font-semibold text-gray-600 whitespace-nowrap">Balance</th>
                                <th className="px-4 py-4 text-right font-semibold text-gray-600 whitespace-nowrap">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                        {ledger.length === 0 && (
                            <tr><td colSpan="7" className="px-6 py-12 text-center text-gray-500 text-sm">No transactions found for this customer.</td></tr>
                        )}
                        {ledger.map((item, idx) => (
                            <React.Fragment key={idx}>
                                <tr className={`hover:bg-gray-50 transition ${selectedIds.has(item.id) ? 'bg-red-50/40' : ''}`}>
                                    <td className="px-4 py-4">
                                        {!isOpeningRow(item) && (
                                            <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)}
                                                className="w-4 h-4 rounded cursor-pointer" />
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-gray-500 font-normal">{new Date(item.date).toLocaleDateString('en-PK')}</td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col gap-0.5">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-medium text-gray-800">{item.note}</span>
                                                {item.bill_number && (
                                                    <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-xs font-bold">Bill #{item.bill_number}</span>
                                                )}
                                                {item.type === 'sale' && (
                                                    <button
                                                        onClick={() => setExpandedSale(expandedSale === item.id ? null : item.id)}
                                                        className="text-xs text-blue-600 hover:text-blue-800 font-bold uppercase tracking-tighter"
                                                    >
                                                        {expandedSale === item.id ? 'Collapse ▲' : 'Details ▼'}
                                                    </button>
                                                )}
                                            </div>
                                            {item.details && <span className="text-xs text-gray-500 truncate max-w-xs">{item.details}</span>}
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                {item.payment_mode && (
                                                    <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs font-semibold capitalize">{item.payment_mode}</span>
                                                )}
                                                {item.transaction_ref && (
                                                    <span className="text-xs text-gray-500">Ref: {item.transaction_ref}</span>
                                                )}
                                                {item.type === 'payment' && (
                                                    <button
                                                        onClick={() => printPaymentVoucher(item.amount, item.note, item.date)}
                                                        className="text-xs text-gray-500 hover:text-green-600 font-medium transition"
                                                        title="Print Payment Voucher"
                                                    >🖨️ Print</button>
                                                )}
                                                {item.type === 'return' && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs uppercase font-bold">Return</span>}
                                                {item.type === 'debit' && <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs uppercase font-bold">Manual Sale</span>}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right text-red-600 font-semibold">
                                        {(item.type === 'sale' || item.type === 'debit') ? `+ Rs. ${Number(item.amount).toFixed(0)}` : ''}
                                    </td>
                                    <td className="px-6 py-4 text-right text-green-600 font-semibold">
                                        {(item.type === 'payment' || item.type === 'return') ? `- Rs. ${Math.abs(item.amount).toFixed(0)}` : ''}
                                    </td>
                                    <td className="px-6 py-4 text-right font-bold text-gray-900">
                                        Rs. {item.balance.toFixed(0)}
                                    </td>
                                    <td className="px-4 py-4 text-right">
                                        {canEditEntry(item) && (
                                            <button onClick={() => setEditEntry(item)} title="Correct amount" aria-label="Correct amount"
                                                className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition text-xs">✏️</button>
                                        )}
                                        {!isOpeningRow(item) && (
                                            <button
                                                onClick={() => handleDeleteTransaction(item)}
                                                title="Delete transaction"
                                                className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition text-xs"
                                            >🗑️</button>
                                        )}
                                    </td>
                                </tr>
                                {item.type === 'sale' && expandedSale === item.id && (
                                    <tr className="bg-blue-50/50 border-b border-gray-100">
                                        <td colSpan="7" className="px-6 py-3">
                                            <div className="flex flex-col gap-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-gray-500 uppercase font-bold tracking-widest">Payment:</span>
                                                    <span className={`px-3 py-0.5 rounded-full text-xs font-bold uppercase ${item.payment_type === 'cash' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
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
                                                            <div key={iidx} className="flex flex-col justify-between text-xs bg-white/90 p-2.5 rounded-xl border border-blue-100/80 shadow-2xs gap-1.5">
                                                                <div className="space-y-0.5">
                                                                    <p className="text-gray-900 font-bold text-xs">{name}</p>
                                                                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                                                                        {specs && <span>{specs}</span>}
                                                                        {imei && (
                                                                            <span className="font-mono bg-blue-50/80 text-blue-800 border border-blue-200/60 px-1.5 py-0.2 rounded text-xs">
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
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
                </div>
            </div>

            {/* Payment Success Banner */}
            {lastPayment && (
                <div className="fixed bottom-6 right-6 z-50 bg-green-600 text-white rounded-2xl shadow-2xl p-4 flex items-center gap-4 animate-bounce-once max-w-sm">
                    <div>
                        <p className="font-bold text-sm">✅ Payment Recorded!</p>
                        <p className="text-xs opacity-90">Rs. {Number(lastPayment.amount).toLocaleString()} — {lastPayment.note}</p>
                    </div>
                    <button
                        onClick={() => printPaymentVoucher(lastPayment.amount, lastPayment.note, lastPayment.date)}
                        className="bg-white text-green-700 font-bold text-xs px-3 py-2 rounded-xl hover:bg-green-50 transition whitespace-nowrap"
                    >
                        🖨️ Print
                    </button>
                    <button onClick={() => setLastPayment(null)} className="text-white/70 hover:text-white text-lg leading-none ml-1">×</button>
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

            {/* Add Transaction Modal */}
            {showTxModal && (() => {
                const prevBalance = ledger.length > 0 ? ledger[0].balance : (customer?.outstanding_balance || 0)
                const saleAmt = parseFloat(txForm.sale_amount) || 0
                const payAmt = parseFloat(txForm.payment_amount) || 0
                const newBalance = prevBalance + saleAmt - payAmt
                return (
                    <div role="dialog" aria-modal="true" className="fixed inset-0 bg-black bg-opacity-40 flex items-start sm:items-center justify-center z-50 overflow-y-auto py-4 px-2 sm:px-4">
                        <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
                            <h2 className="text-xl font-bold text-gray-800 mb-1">➕ Add Transaction</h2>
                            <p className="text-xs text-gray-500 mb-4">Enter a sale, a payment, or both together</p>
                            <form onSubmit={handleAddTransaction} className="space-y-4">

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

                                {/* Sale Amount (Debit) */}
                                <div>
                                    <label className="block font-semibold mb-1 text-sm text-orange-600">🛒 Sale Amount / Debit</label>
                                    <input aria-label="Sale Amount / Debit" type="number" min="0" step="any" value={txForm.sale_amount}
                                        onChange={e => setTxForm(f => ({ ...f, sale_amount: e.target.value }))}
                                        className="w-full px-4 py-2.5 border border-orange-200 bg-orange-50 rounded-lg focus:ring-2 focus:ring-orange-400 outline-none text-sm"
                                        placeholder="0  — kitna maal becha (Rs.)" />
                                    <p className="text-xs text-gray-500 mt-0.5">Customer ko jo maal diya uski value</p>
                                </div>

                                {/* Payment Received (Credit) */}
                                <div>
                                    <label className="block font-semibold mb-1 text-sm text-green-600">💵 Payment Received / Credit</label>
                                    <input aria-label="Payment Received / Credit" type="number" min="0" step="any" value={txForm.payment_amount}
                                        onChange={e => setTxForm(f => ({ ...f, payment_amount: e.target.value }))}
                                        className="w-full px-4 py-2.5 border border-green-200 bg-green-50 rounded-lg focus:ring-2 focus:ring-green-400 outline-none text-sm"
                                        placeholder="0  — kitni payment ayi (Rs.)" />
                                    <p className="text-xs text-gray-500 mt-0.5">Customer sy jo payment mili</p>
                                </div>

                                {/* Balance Preview */}
                                <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                                    <p className="text-xs text-gray-500 uppercase font-bold tracking-wide mb-2">Balance Calculation</p>
                                    <div className="flex flex-col gap-1 text-sm">
                                        <div className="flex justify-between text-gray-600">
                                            <span>Previous Balance</span>
                                            <span className="font-semibold">Rs. {Number(prevBalance).toLocaleString()}</span>
                                        </div>
                                        {saleAmt > 0 && (
                                            <div className="flex justify-between text-orange-600">
                                                <span>+ Sale (Debit)</span>
                                                <span className="font-semibold">Rs. {saleAmt.toLocaleString()}</span>
                                            </div>
                                        )}
                                        {payAmt > 0 && (
                                            <div className="flex justify-between text-green-600">
                                                <span>− Payment (Credit)</span>
                                                <span className="font-semibold">Rs. {payAmt.toLocaleString()}</span>
                                            </div>
                                        )}
                                        <div className="border-t border-gray-300 mt-1 pt-1 flex justify-between font-bold text-base">
                                            <span className="text-gray-800">New Balance</span>
                                            <span className={newBalance > 0 ? 'text-red-600' : 'text-green-700'}>Rs. {newBalance.toLocaleString()}</span>
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
                                        placeholder="e.g. Advance payment / Credit sale..." />
                                </div>

                                <div className="flex gap-3 pt-1">
                                    <button type="submit" disabled={saving}
                                        className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition disabled:opacity-50">
                                        {saving ? 'Saving...' : '✅ Save Transaction'}
                                    </button>
                                    <button type="button" onClick={resetTxForm}
                                        className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition">
                                        Cancel
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            })()}
        </div >
    )
}

export default CustomerLedger
