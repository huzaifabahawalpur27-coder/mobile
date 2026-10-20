import { supabase } from './supabase'
import { db, addToSyncQueue } from './db'
import { recordAuditLog } from './auditService'
import { deductBankBalance, creditBankBalance } from './bankService'

/**
 * Updates the payment method of an existing purchase invoice.
 * Automatically reconciles:
 * 1. Supplier outstanding balance (credit vs paid)
 * 2. Supplier payments ledger entries
 * 3. Bank balance deduction or credit (if bank method is involved)
 * 4. Purchase record payment fields
 * 5. Local Dexie database cache
 * 6. Audit log
 *
 * @param {Object} params
 * @param {number|string} params.purchaseId - ID of purchase
 * @param {string} params.newPaymentMethod - 'cash' | 'bank' | 'credit'
 * @param {number|string} [params.bankAccountId] - Required if newPaymentMethod is 'bank'
 * @param {string} [params.notes] - Optional note explaining the change
 * @param {Object} params.user - Current user object { id, shop_id, role }
 */
export async function updatePurchasePaymentMethod({
  purchaseId,
  newPaymentMethod,
  bankAccountId = null,
  notes = '',
  user
}) {
  if (!purchaseId) throw new Error('Purchase ID is required')
  if (!['cash', 'bank', 'credit'].includes(newPaymentMethod)) {
    throw new Error('Invalid payment method: ' + newPaymentMethod)
  }
  if (newPaymentMethod === 'bank' && !bankAccountId) {
    throw new Error('Bank Account selection is required for Bank payment')
  }

  const shopId = user?.shop_id
  if (!shopId) throw new Error('User shop ID is missing')

  // 1. Fetch current purchase record
  let purchase = null
  if (navigator.onLine) {
    const { data, error } = await supabase
      .from('purchases')
      .select('*, suppliers(id, name, balance, outstanding_balance)')
      .eq('id', purchaseId)
      .maybeSingle()
    if (!error && data) purchase = data
  }
  if (!purchase) {
    const localPurchases = await db.purchases.toArray().catch(() => [])
    purchase = localPurchases.find(p => String(p.id) === String(purchaseId))
  }
  if (!purchase) throw new Error(`Purchase record PR-${purchaseId} not found`)

  const oldMethod = (purchase.payment_type || purchase.payment_method || 'cash').toLowerCase()
  if (oldMethod === newPaymentMethod) {
    return { success: true, message: 'Payment method is already ' + newPaymentMethod }
  }

  const totalAmount = Number(purchase.total_amount || purchase.net_amount || 0)
  const supplierId = purchase.supplier_id

  // 2. Fetch Supplier
  let supplier = null
  if (supplierId) {
    if (navigator.onLine) {
      const { data } = await supabase
        .from('suppliers')
        .select('*')
        .eq('id', supplierId)
        .maybeSingle()
      if (data) supplier = data
    }
    if (!supplier) {
      const localSups = await db.suppliers.toArray().catch(() => [])
      supplier = localSups.find(s => String(s.id) === String(supplierId))
    }
  }

  const currentBal = Number(supplier?.outstanding_balance ?? supplier?.balance ?? 0)
  let newSupplierBal = currentBal
  const now = new Date().toISOString()

  // 3. Financial Reconciliation Calculations
  // Case A: Credit -> Paid (Cash or Bank)
  // Supplier balance decreases (debt cleared)
  if (oldMethod === 'credit' && (newPaymentMethod === 'cash' || newPaymentMethod === 'bank')) {
    newSupplierBal = currentBal - totalAmount

    // Record payment in supplier_payments
    const paymentEntry = {
      shop_id: shopId,
      supplier_id: supplierId,
      amount: totalAmount,
      payment_type: 'payment',
      payment_mode: newPaymentMethod,
      note: `Payment for PR-${String(purchaseId).slice(-6)} (Updated from Credit to ${newPaymentMethod.toUpperCase()})${notes ? ' - ' + notes : ''}`,
      created_at: now
    }
    if (navigator.onLine) {
      const { error: insErr } = await supabase.from('supplier_payments').insert([paymentEntry])
      if (insErr) {
        // Fallback for minimal columns
        await supabase.from('supplier_payments').insert([{
          shop_id: shopId,
          supplier_id: supplierId,
          amount: totalAmount,
          description: paymentEntry.note,
          created_at: now
        }]).catch(() => {})
      }
    } else {
      await addToSyncQueue('supplier_payments', 'INSERT', paymentEntry).catch(() => {})
    }
    await db.supplier_payments?.add(paymentEntry).catch(() => {})

    // If Bank, deduct from bank account
    if (newPaymentMethod === 'bank' && bankAccountId) {
      try {
        await deductBankBalance({
          shopId,
          accountId: Number(bankAccountId),
          amount: totalAmount,
          purchaseId,
          description: `Settlement for Purchase PR-${String(purchaseId).slice(-6)}`
        })
      } catch (bErr) {
        console.warn('Bank deduction warning on method update:', bErr)
      }
    }
  }

  // Case B: Paid (Cash or Bank) -> Credit
  // Supplier balance increases (debt restored)
  else if ((oldMethod === 'cash' || oldMethod === 'bank') && newPaymentMethod === 'credit') {
    newSupplierBal = currentBal + totalAmount

    // Add debit/reversal entry in supplier_payments
    const reversalEntry = {
      shop_id: shopId,
      supplier_id: supplierId,
      amount: totalAmount,
      payment_type: 'debit',
      payment_mode: 'credit',
      note: `Reversal of PR-${String(purchaseId).slice(-6)} payment (Converted from ${oldMethod.toUpperCase()} to Credit)${notes ? ' - ' + notes : ''}`,
      created_at: now
    }
    if (navigator.onLine) {
      const { error: revErr } = await supabase.from('supplier_payments').insert([reversalEntry])
      if (revErr) {
        await supabase.from('supplier_payments').insert([{
          shop_id: shopId,
          supplier_id: supplierId,
          amount: totalAmount,
          description: reversalEntry.note,
          created_at: now
        }]).catch(() => {})
      }
    } else {
      await addToSyncQueue('supplier_payments', 'INSERT', reversalEntry).catch(() => {})
    }
    await db.supplier_payments?.add(reversalEntry).catch(() => {})

    // If previously Bank and bank account supplied, credit/refund balance back to bank
    if (oldMethod === 'bank' && bankAccountId) {
      try {
        await creditBankBalance({
          shopId,
          accountId: Number(bankAccountId),
          amount: totalAmount,
          referenceType: 'PURCHASE_REVERSAL',
          referenceId: purchaseId,
          description: `Refund/Reversal for Purchase PR-${String(purchaseId).slice(-6)} converted to Credit`
        })
      } catch (bErr) {
        console.warn('Bank refund warning on method update:', bErr)
      }
    }
  }

  // Case C: Cash <-> Bank (Both are paid, just transferring payment source)
  else if (oldMethod === 'cash' && newPaymentMethod === 'bank') {
    if (bankAccountId) {
      try {
        await deductBankBalance({
          shopId,
          accountId: Number(bankAccountId),
          amount: totalAmount,
          purchaseId,
          description: `Payment for PR-${String(purchaseId).slice(-6)} switched from Cash to Bank`
        })
      } catch (bErr) {
        console.warn('Bank deduction warning:', bErr)
      }
    }
  } else if (oldMethod === 'bank' && newPaymentMethod === 'cash') {
    if (bankAccountId) {
      try {
        await creditBankBalance({
          shopId,
          accountId: Number(bankAccountId),
          amount: totalAmount,
          referenceType: 'PAYMENT_CORRECTION',
          referenceId: purchaseId,
          description: `Cash received correction for PR-${String(purchaseId).slice(-6)}`
        })
      } catch (bErr) {
        console.warn('Bank refund warning:', bErr)
      }
    }
  }

  // 4. Update Supplier Balance if Changed
  if (supplierId && newSupplierBal !== currentBal) {
    if (navigator.onLine) {
      await supabase
        .from('suppliers')
        .update({
          outstanding_balance: newSupplierBal,
          balance: newSupplierBal
        })
        .eq('id', supplierId)
        .catch(() => {})
    } else {
      await addToSyncQueue('suppliers', 'UPDATE', {
        id: supplierId,
        outstanding_balance: newSupplierBal,
        balance: newSupplierBal
      }).catch(() => {})
    }
    await db.suppliers?.update(supplierId, {
      outstanding_balance: newSupplierBal,
      balance: newSupplierBal
    }).catch(() => {})
  }

  // 5. Update Purchase Record
  const isPaid = newPaymentMethod === 'cash' || newPaymentMethod === 'bank'
  const purchaseUpdates = {
    payment_method: newPaymentMethod,
    payment_type: newPaymentMethod,
    paid_amount: isPaid ? totalAmount : 0,
    amount_paid: isPaid ? totalAmount : 0
  }

  if (navigator.onLine) {
    const { error: updErr } = await supabase
      .from('purchases')
      .update(purchaseUpdates)
      .eq('id', purchaseId)
    if (updErr) {
      // Retry minimal columns
      await supabase
        .from('purchases')
        .update({ payment_method: newPaymentMethod })
        .eq('id', purchaseId)
    }
  } else {
    await addToSyncQueue('purchases', 'UPDATE', { id: purchaseId, ...purchaseUpdates }).catch(() => {})
  }
  await db.purchases?.update(purchaseId, purchaseUpdates).catch(() => {})

  // 6. Record Audit Log
  await recordAuditLog(
    'PURCHASE_PAYMENT_METHOD_CHANGE',
    'purchases',
    purchaseId,
    {
      old_method: oldMethod,
      new_method: newPaymentMethod,
      total_amount: totalAmount,
      supplier_id: supplierId,
      old_supplier_balance: currentBal,
      new_supplier_balance: newSupplierBal,
      notes
    },
    user?.id,
    shopId
  ).catch(() => {})

  return {
    success: true,
    purchaseId,
    oldMethod,
    newMethod: newPaymentMethod,
    totalAmount,
    newSupplierBalance: newSupplierBal
  }
}

/**
 * Returns a specific phone to its supplier.
 * Reconciles inventory status, supplier ledger balance, and cash/bank refunds.
 *
 * @param {Object} params
 * @param {Object} params.phone - The phone object from phones table
 * @param {string} params.reason - Return reason
 * @param {string} params.settlementType - 'credit_adjustment' | 'cash_refund' | 'bank_refund'
 * @param {number|string} [params.bankAccountId] - Required if settlementType is 'bank_refund'
 * @param {string} [params.notes] - Additional return notes
 * @param {Object} params.user - Current user object
 */
export async function returnPhoneToSupplier({
  phone,
  reason,
  settlementType = 'credit_adjustment',
  bankAccountId = null,
  notes = '',
  user
}) {
  if (!phone || !phone.id) throw new Error('Phone details are required')
  const shopId = user?.shop_id
  if (!shopId) throw new Error('User shop ID is missing')

  const costPrice = parseFloat(phone.cost_price) || 0
  const supplierId = phone.supplier_id
  const now = new Date().toISOString()
  const returnTag = `[Returned to Supplier: ${reason || 'Return'}]`
  const updatedNotes = phone.notes ? `${phone.notes} ${returnTag}` : returnTag

  // 1. Update Phone Status in DB
  const phoneUpdates = {
    status: 'returned',
    notes: updatedNotes,
    updated_at: now
  }

  if (navigator.onLine) {
    const { error: phErr } = await supabase
      .from('phones')
      .update(phoneUpdates)
      .eq('id', phone.id)
    if (phErr) throw phErr
  } else {
    await addToSyncQueue('phones', 'UPDATE', { id: phone.id, ...phoneUpdates }).catch(() => {})
  }
  await db.phones?.update(phone.id, phoneUpdates).catch(() => {})

  // 2. Financial Adjustments
  if (supplierId && costPrice > 0) {
    // A. Credit adjustment: Deduct from supplier balance (credit note)
    if (settlementType === 'credit_adjustment') {
      let curBal = 0
      if (navigator.onLine) {
        const { data: supData } = await supabase
          .from('suppliers')
          .select('balance, outstanding_balance')
          .eq('id', supplierId)
          .maybeSingle()
        curBal = Number(supData?.outstanding_balance ?? supData?.balance ?? 0)
      } else {
        const localSup = await db.suppliers?.get(supplierId)
        curBal = Number(localSup?.outstanding_balance ?? localSup?.balance ?? 0)
      }

      const newBal = curBal - costPrice

      if (navigator.onLine) {
        await supabase
          .from('suppliers')
          .update({ outstanding_balance: newBal, balance: newBal })
          .eq('id', supplierId)
          .catch(() => {})
      } else {
        await addToSyncQueue('suppliers', 'UPDATE', { id: supplierId, outstanding_balance: newBal, balance: newBal }).catch(() => {})
      }
      await db.suppliers?.update(supplierId, { outstanding_balance: newBal, balance: newBal }).catch(() => {})

      // Insert Return entry in supplier_payments
      const returnEntry = {
        shop_id: shopId,
        supplier_id: supplierId,
        amount: costPrice,
        payment_type: 'return',
        payment_mode: 'credit_note',
        note: `Return: ${phone.brand} ${phone.model} (IMEI: ${phone.imei_1}) - Reason: ${reason}${notes ? ' - ' + notes : ''}`,
        created_at: now
      }
      if (navigator.onLine) {
        const { error: insErr } = await supabase.from('supplier_payments').insert([returnEntry])
        if (insErr) {
          await supabase.from('supplier_payments').insert([{
            shop_id: shopId,
            supplier_id: supplierId,
            amount: costPrice,
            description: returnEntry.note,
            created_at: now
          }]).catch(() => {})
        }
      } else {
        await addToSyncQueue('supplier_payments', 'INSERT', returnEntry).catch(() => {})
      }
      await db.supplier_payments?.add(returnEntry).catch(() => {})
    }

    // B. Cash Refund: Supplier paid cash immediately
    else if (settlementType === 'cash_refund') {
      const returnEntry = {
        shop_id: shopId,
        supplier_id: supplierId,
        amount: costPrice,
        payment_type: 'return',
        payment_mode: 'cash',
        note: `Cash Refund Return: ${phone.brand} ${phone.model} (IMEI: ${phone.imei_1}) - ${reason}`,
        created_at: now
      }
      if (navigator.onLine) {
        await supabase.from('supplier_payments').insert([returnEntry]).catch(() => {})
      } else {
        await addToSyncQueue('supplier_payments', 'INSERT', returnEntry).catch(() => {})
      }
      await db.supplier_payments?.add(returnEntry).catch(() => {})
    }

    // C. Bank Refund: Deposited into shop bank account
    else if (settlementType === 'bank_refund' && bankAccountId) {
      try {
        await creditBankBalance({
          shopId,
          accountId: Number(bankAccountId),
          amount: costPrice,
          referenceType: 'PHONE_RETURN_REFUND',
          referenceId: phone.id,
          description: `Supplier Refund: ${phone.brand} ${phone.model} (IMEI: ${phone.imei_1})`
        })
      } catch (bErr) {
        console.warn('Bank refund deposit warning:', bErr)
      }

      const returnEntry = {
        shop_id: shopId,
        supplier_id: supplierId,
        amount: costPrice,
        payment_type: 'return',
        payment_mode: 'bank',
        note: `Bank Refund Return: ${phone.brand} ${phone.model} (IMEI: ${phone.imei_1}) into Bank`,
        created_at: now
      }
      if (navigator.onLine) {
        await supabase.from('supplier_payments').insert([returnEntry]).catch(() => {})
      } else {
        await addToSyncQueue('supplier_payments', 'INSERT', returnEntry).catch(() => {})
      }
      await db.supplier_payments?.add(returnEntry).catch(() => {})
    }
  }

  // 3. Log History in phone_history
  if (navigator.onLine) {
    await supabase.from('phone_history').insert([{
      phone_id: phone.id,
      shop_id: shopId,
      action: 'RETURNED_TO_SUPPLIER',
      previous_status: phone.status,
      new_status: 'returned',
      actor_id: user?.id,
      details: {
        reason,
        settlement_type: settlementType,
        supplier_id: supplierId,
        cost_price: costPrice,
        notes
      },
      created_at: now
    }]).catch(() => {})
  }

  // 4. Audit Log
  await recordAuditLog(
    'PHONE_SUPPLIER_RETURN',
    'phones',
    phone.id,
    {
      imei_1: phone.imei_1,
      model: `${phone.brand} ${phone.model}`,
      supplier_id: supplierId,
      cost_price: costPrice,
      settlement_type: settlementType,
      reason,
      notes
    },
    user?.id,
    shopId
  ).catch(() => {})

  return {
    success: true,
    phoneId: phone.id,
    costPrice,
    settlementType
  }
}
