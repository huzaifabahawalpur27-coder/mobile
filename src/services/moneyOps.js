import { supabase } from './supabase'
import { db, addToSyncQueue } from './db'
import { newOpId, isMissingFunction, adjustCustomerBalance, adjustSupplierBalance, adjustProductStock, applyLocalDelta } from './atomicOps'
import { creditBankBalance, deductBankBalance } from './bankService'
import { isCashAccount } from '../utils/moneyMath'

/*
 * One money action = one database call (sql/atomic_money_ops.sql).
 *
 * A screen describes everything an action changes: entries to add / change / remove,
 * the customer's or supplier's balance, cash / bank accounts and stock:
 *
 *   await applyMoneyOp({
 *     inserts:  [{ table: 'customer_payments', row: {...} }],
 *     updates:  [{ table: 'sales', id, set: {...} }],
 *     deletes:  [{ table: 'expenses', id }],
 *     customer: { id, delta },            supplier: { id, delta },
 *     accounts: [{ account_id, delta, reference_type, reference_id, description }],
 *     stock:    [{ product_id, delta }]
 *   })
 *
 * Online it is applied in ONE transaction: all of it, or none of it. Offline (or when
 * the connection drops) the device's copy is updated and the same call is queued with
 * a unique id, so it is applied exactly once later. Where the database function is not
 * installed yet, the parts are applied one after another as the app did before.
 *
 * Result: { ok: true, inserted: [{table,row}], queued?: true, legacy?: true }
 *         { ok: false, error }   refused by the server: nothing was changed
 */

const NETWORK_RE = /fetch|network|load failed|timeout|err_name_not_resolved|connection/i
const isNetworkError = (err) => NETWORK_RE.test(`${err?.message || ''} ${err?.details || ''}`)
const isColumnError = (err) =>
  ['PGRST204', '42703'].includes(err?.code) || /column|schema cache/i.test(err?.message || '')

// Columns added by sql/atomic_money_ops.sql: dropped when writing to an older database
const OPTIONAL_COLUMNS = ['purchase_id', 'sale_id', 'account_id']
const withoutOptional = (row) => {
  const out = { ...row }
  for (const k of OPTIONAL_COLUMNS) delete out[k]
  return out
}

const clean = (op) => ({
  inserts: (op.inserts || []).filter(Boolean),
  updates: (op.updates || []).filter(Boolean).map(u => ({ ...u, id: String(u.id) })),
  deletes: (op.deletes || []).filter(Boolean).map(d => ({ ...d, id: String(d.id) })),
  customer: op.customer && Number(op.customer.delta) ? { id: op.customer.id, delta: Number(op.customer.delta) } : null,
  supplier: op.supplier && Number(op.supplier.delta) ? { id: op.supplier.id, delta: Number(op.supplier.delta) } : null,
  accounts: (op.accounts || []).filter(a => a && a.account_id && Number(a.delta)).map(a => ({ ...a, delta: Number(a.delta) })),
  stock: (op.stock || []).filter(s => s && s.product_id && Number(s.delta)).map(s => ({ ...s, delta: Number(s.delta) }))
})

const localKey = (id) => (/^\d+$/.test(String(id)) ? Number(id) : id)

// Keep this device's copy in step (best effort: the server is the record)
async function mirrorLocally(op, serverResult = null) {
  try {
    const insertedRows = serverResult?.inserted || null
    if (insertedRows) {
      for (const ins of insertedRows) if (db[ins.table] && ins.row?.id != null) await db[ins.table].put(ins.row)
    }
    for (const u of op.updates) {
      if (db[u.table]) await db[u.table].update(localKey(u.id), u.set).catch(() => {})
    }
    for (const d of op.deletes) {
      if (db[d.table]) await db[d.table].delete(localKey(d.id)).catch(() => {})
    }
    if (serverResult) {
      if (op.customer) await applyLocalDelta('customers', op.customer.id, ['outstanding_balance', 'balance'], op.customer.delta)
      if (op.supplier) await applyLocalDelta('suppliers', op.supplier.id, ['outstanding_balance', 'balance'], op.supplier.delta)
      for (const s of op.stock) await applyLocalDelta('products', s.product_id, ['stock_quantity'], s.delta)
      for (const a of serverResult.accounts || []) {
        if (a.balance_after != null) await db.bank_accounts.update(localKey(a.account_id), { current_balance: Number(a.balance_after) }).catch(() => {})
        if (a.transaction) await db.bank_account_transactions.put(a.transaction).catch(() => {})
      }
    }
  } catch (_) { /* cache only */ }
}

/**
 * The parts applied one after another (database function not installed). Each balance
 * / account / stock change is still an amount added by the server, not an absolute write.
 */
export async function runMoneyOpStepwise(rawOp) {
  const op = clean(rawOp)
  const inserted = []
  for (const ins of op.inserts) {
    // the one-step function sets shop_id itself; here the row must carry it
    const row = { shop_id: rawOp.shop_id, ...ins.row }
    let { data, error } = await supabase.from(ins.table).insert([row]).select().maybeSingle()
    if (error && isColumnError(error)) {
      ({ data, error } = await supabase.from(ins.table).insert([withoutOptional(row)]).select().maybeSingle())
    }
    if (error && isColumnError(error) && ins.fallbackRow) {
      ({ data, error } = await supabase.from(ins.table).insert([{ shop_id: rawOp.shop_id, ...ins.fallbackRow }]).select().maybeSingle())
    }
    if (error) return { ok: false, error: error.message || String(error) }
    if (data) inserted.push({ table: ins.table, row: data })
  }
  for (const u of op.updates) {
    let { error } = await supabase.from(u.table).update(u.set).eq('id', u.id)
    if (error && isColumnError(error)) ({ error } = await supabase.from(u.table).update(withoutOptional(u.set)).eq('id', u.id))
    if (error && isColumnError(error) && u.fallbackSet) ({ error } = await supabase.from(u.table).update(u.fallbackSet).eq('id', u.id))
    if (error) return { ok: false, error: error.message || String(error), inserted }
  }
  for (const d of op.deletes) {
    const { error } = await supabase.from(d.table).delete().eq('id', d.id)
    if (error) return { ok: false, error: error.message || String(error), inserted }
  }
  const problems = []
  if (op.customer) {
    const r = await adjustCustomerBalance(op.customer.id, op.customer.delta)
    if (!r.ok) problems.push(`customer balance: ${r.error}`)
  }
  if (op.supplier) {
    const r = await adjustSupplierBalance(op.supplier.id, op.supplier.delta)
    if (!r.ok) problems.push(`supplier balance: ${r.error}`)
  }
  for (const a of op.accounts) {
    try {
      const args = { shopId: rawOp.shop_id, accountId: a.account_id, amount: Math.abs(a.delta), referenceType: a.reference_type, referenceId: a.reference_id, description: a.description || '' }
      if (a.delta > 0) await creditBankBalance(args)
      else await deductBankBalance(args)
    } catch (err) {
      problems.push(`account ${a.account_id}: ${err?.message || err}`)
    }
  }
  for (const s of op.stock) {
    const r = await adjustProductStock(s.product_id, s.delta)
    if (!r.ok) problems.push(`stock of product ${s.product_id}: ${r.error}`)
  }
  await mirrorLocally({ ...op, customer: null, supplier: null, stock: [], accounts: [] }, { inserted })
  return { ok: true, legacy: true, inserted, problems }
}

async function queueOffline(op, rawOp, opId) {
  // New entries get a temporary id on this device until the queued call is applied
  const inserted = []
  for (const ins of op.inserts) {
    const row = { ...ins.row, id: `temp-${newOpId()}`, shop_id: rawOp.shop_id, pending_sync: true }
    try { if (db[ins.table]) await db[ins.table].put(row) } catch (_) { /* cache only */ }
    inserted.push({ table: ins.table, row })
  }
  await mirrorLocally(op, null)
  if (op.customer) await applyLocalDelta('customers', op.customer.id, ['outstanding_balance', 'balance'], op.customer.delta)
  if (op.supplier) await applyLocalDelta('suppliers', op.supplier.id, ['outstanding_balance', 'balance'], op.supplier.delta)
  for (const s of op.stock) await applyLocalDelta('products', s.product_id, ['stock_quantity'], s.delta)
  for (const a of op.accounts) await applyLocalDelta('bank_accounts', a.account_id, ['current_balance'], a.delta)
  await addToSyncQueue('rpc', 'RPC', { fn: 'apply_money_op', args: { p_op: { ...op, shop_id: rawOp.shop_id }, p_op_id: opId } })
  return { ok: true, queued: true, inserted }
}

export async function applyMoneyOp(rawOp) {
  const op = clean(rawOp)
  const opId = newOpId()
  const online = !(typeof navigator !== 'undefined' && navigator.onLine === false)

  if (online) {
    let failure = null
    try {
      const { data, error } = await supabase.rpc('apply_money_op', { p_op: op, p_op_id: opId })
      if (!error && data && data.success !== false) {
        await mirrorLocally(op, data)
        return { ok: true, inserted: data.inserted || [], accounts: data.accounts || [] }
      }
      failure = error || { message: data?.error || 'Rejected by server' }
    } catch (err) {
      failure = err
    }
    if (isMissingFunction(failure)) {
      console.warn('apply_money_op is not installed yet (run sql/atomic_money_ops.sql); applying the parts one by one.')
      try {
        const res = await runMoneyOpStepwise(rawOp)
        if (res.ok || !isNetworkError({ message: res.error })) return res
      } catch (err) {
        if (!isNetworkError(err)) return { ok: false, error: err?.message || String(err) }
      }
    } else if (!isNetworkError(failure)) {
      return { ok: false, error: failure?.message || String(failure) }
    }
    // Network problem: queue the same call; its id stops it being applied twice
  }
  return queueOffline(op, rawOp, opId)
}

/** Picks the cash or a bank account for a payment mode ('cash', 'bank', 'jazzcash', ...). */
export function accountForMode(accounts, mode) {
  const list = accounts || []
  const isCash = isCashAccount
  const m = String(mode || 'cash').toLowerCase()
  if (m === 'cash') return list.find(isCash) || list[0] || null
  return list.find(a => !isCash(a) && [a.bank_name, a.account_name].some(n => String(n || '').toLowerCase().includes(m)))
    || list.find(a => !isCash(a))
    || list[0] || null
}

/**
 * Saves the supplier-payment row that goes with a purchase bill, linked to the bill
 * (purchase_id) so deleting the bill can remove it. Works on databases without the
 * link column, and on the oldest ones that keep only a description.
 */
export async function insertBillPayment(row, purchaseId) {
  const linked = purchaseId != null && /^\d+$/.test(String(purchaseId)) ? { ...row, purchase_id: Number(purchaseId) } : row
  let { error } = await supabase.from('supplier_payments').insert([linked])
  if (error && isColumnError(error) && linked !== row) ({ error } = await supabase.from('supplier_payments').insert([row]))
  if (error && isColumnError(error)) {
    ({ error } = await supabase.from('supplier_payments').insert([{
      shop_id: row.shop_id,
      supplier_id: row.supplier_id,
      amount: row.amount,
      description: row.note || row.description || 'Payment'
    }]))
  }
  return { ok: !error, error: error?.message }
}

/** Removes the payment / refund rows linked to a purchase bill that is being deleted. */
export async function deleteBillPayments(purchaseId) {
  if (!/^\d+$/.test(String(purchaseId ?? ''))) return { ok: true, removed: 0 }
  const { data, error } = await supabase.from('supplier_payments').delete().eq('purchase_id', Number(purchaseId)).select('id')
  if (error) return { ok: isColumnError(error), removed: 0, error: error.message } // no link column yet: nothing to remove
  try { if (data?.length) await db.supplier_payments.bulkDelete(data.map(r => r.id)) } catch (_) { /* cache only */ }
  return { ok: true, removed: data?.length || 0 }
}
