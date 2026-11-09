import { supabase } from './supabase'
import { db, addToSyncQueue } from './db'

/*
 * Stock and balance changes as DELTAS applied inside the database
 * (sql/atomic_stock_and_balances.sql), instead of absolute numbers computed in the
 * browser. Two devices selling at once both count, and an offline change queued for
 * later can no longer roll a value back.
 *
 * Each operation carries a unique op id. If the reply is lost, or the operation is
 * queued and retried, the database recognises the id and applies it only once.
 *
 * Results: { ok: true, queued: false, data } applied now
 *          { ok: true, queued: true }         saved to the sync queue (offline)
 *          { ok: false, error }               refused by the server (e.g. already sold)
 */

const NETWORK_RE = /fetch|network|load failed|timeout|err_name_not_resolved|connection/i
const isNetworkError = (err) => NETWORK_RE.test(`${err?.message || ''} ${err?.details || ''}`)
// Database not migrated yet (function missing): fall back to the old behaviour
const isMissingFunction = (err) => err?.code === 'PGRST202' || /could not find the function/i.test(err?.message || '')
const isServerId = (id) => /^\d+$/.test(String(id ?? ''))

export function newOpId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // RFC 4122 v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

async function runOrQueue(fn, args, { queueOnly = false, legacy = null } = {}) {
  const opArgs = { ...args, p_op_id: args.p_op_id || newOpId() }
  const firstId = Object.values(args)[0]
  const online = !(typeof navigator !== 'undefined' && navigator.onLine === false)

  if (!queueOnly && online && isServerId(firstId)) {
    try {
      const { data, error } = await supabase.rpc(fn, opArgs)
      if (!error) {
        if (data && data.success === false) return { ok: false, error: data.error || 'Rejected by server' }
        return { ok: true, queued: false, data }
      }
      if (isMissingFunction(error) && legacy) {
        console.warn(`${fn} is not installed yet (run sql/atomic_stock_and_balances.sql); using the old write.`)
        return legacy()
      }
      if (!isNetworkError(error)) return { ok: false, error: error.message || String(error) }
      // Network error: the server may or may not have applied it. Queue with the same
      // op id; a replay of an already-applied operation is ignored by the database.
    } catch (err) {
      if (!isNetworkError(err)) return { ok: false, error: err?.message || String(err) }
    }
  }

  await addToSyncQueue('rpc', 'RPC', { fn, args: opArgs })
  return { ok: true, queued: true }
}

// Old behaviour for databases where sql/atomic_stock_and_balances.sql has not been run:
// read the server's current value, then write (still better than the screen's stale copy)
async function legacyProductStock(productId, d) {
  const { data, error } = await supabase.from('products').select('stock_quantity').eq('id', productId).maybeSingle()
  if (error) return { ok: false, error: error.message }
  const { error: upErr } = await supabase.from('products').update({ stock_quantity: (Number(data?.stock_quantity) || 0) + d }).eq('id', productId)
  return upErr ? { ok: false, error: upErr.message } : { ok: true, queued: false, legacy: true }
}

async function legacyPartyBalance(table, id, d) {
  const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle()
  if (error) return { ok: false, error: error.message }
  const base = Number(data?.outstanding_balance ?? data?.balance ?? 0) || 0
  const patch = { outstanding_balance: base + d }
  if (data && 'balance' in data) patch.balance = base + d
  const { error: upErr } = await supabase.from(table).update(patch).eq('id', id)
  return upErr ? { ok: false, error: upErr.message } : { ok: true, queued: false, legacy: true }
}

/**
 * Used by the sync queue when a queued operation's function is missing on the server.
 * Returns null when there is no fallback for that function.
 */
export async function runLegacyOp(fn, args = {}) {
  if (fn === 'adjust_product_stock') return legacyProductStock(args.p_product_id, Number(args.p_delta) || 0)
  if (fn === 'adjust_customer_balance') return legacyPartyBalance('customers', args.p_customer_id, Number(args.p_delta) || 0)
  if (fn === 'adjust_supplier_balance') return legacyPartyBalance('suppliers', args.p_supplier_id, Number(args.p_delta) || 0)
  if (fn === 'mark_phone_sold') return legacyMarkPhoneSold(args.p_phone_id, Number(args.p_sale_price) || 0)
  if (fn === 'receive_purchase_stock') return legacyReceiveStock(args.p_product_id, Number(args.p_qty) || 0, Number(args.p_unit_cost) || 0)
  return null
}

export { isMissingFunction }

async function legacyMarkPhoneSold(phoneId, price) {
  const res = await supabase.from('phones')
    .update({ status: 'sold', sale_price: price, sold_at: new Date().toISOString() })
    .eq('id', phoneId).eq('status', 'in_stock').select('id')
  if (res.error) return { ok: false, error: res.error.message }
  if (!res.data || res.data.length === 0) return { ok: false, alreadySold: true, error: `Phone ${phoneId} is not in stock - already sold` }
  return { ok: true, legacy: true }
}

/** Weighted-average cost: (stock x cost + qty x unitCost) / (stock + qty); the purchase price when nothing is on hand. */
export function weightedCost(stock, cost, qty, unitCost) {
  const st = Number(stock) || 0
  const c = Number(cost) || 0
  const q = Number(qty) || 0
  const u = Number(unitCost) || 0
  if (st > 0 && st + q > 0) return Math.round(((st * c + q * u) / (st + q)) * 100) / 100
  return u
}

async function legacyReceiveStock(productId, qty, unitCost) {
  const { data, error } = await supabase.from('products').select('stock_quantity, cost_price').eq('id', productId).maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: `Product ${productId} not found in this shop` }
  const { error: upErr } = await supabase.from('products').update({
    stock_quantity: (Number(data.stock_quantity) || 0) + qty,
    cost_price: weightedCost(data.stock_quantity, data.cost_price, qty, unitCost)
  }).eq('id', productId)
  return upErr ? { ok: false, error: upErr.message } : { ok: true, queued: false, legacy: true }
}

/** Updates only the device's cached copy by a delta (the server was updated elsewhere). */
export const applyLocalDelta = (table, id, fields, delta) => bumpLocal(table, id, fields, Number(delta) || 0)

async function bumpLocal(table, id, fields, delta) {
  try {
    const store = db[table]
    if (!store) return
    const row = await store.get(id) ?? (isServerId(id) ? await store.get(Number(id)) : undefined)
    if (!row) return
    const patch = {}
    for (const f of fields) {
      if (f in row || f === fields[0]) patch[f] = (Number(row[f]) || 0) + delta
    }
    await store.update(row.id, patch)
  } catch (_) { /* local cache only */ }
}

/** Adds delta (negative to sell, positive to restock) to a product's stock. */
export async function adjustProductStock(productId, delta, options = {}) {
  const d = Number(delta) || 0
  if (!productId || d === 0) return { ok: true, unchanged: true }
  const result = await runOrQueue('adjust_product_stock', { p_product_id: productId, p_delta: d }, {
    ...options,
    legacy: () => legacyProductStock(productId, d)
  })
  if (result.ok) await bumpLocal('products', productId, ['stock_quantity'], d)
  return result
}

/**
 * Purchase received: adds stock and blends the cost price (weighted average) in one
 * database statement, instead of overwriting cost with the latest purchase price.
 */
export async function receivePurchaseStock(productId, qty, unitCost, options = {}) {
  const q = Number(qty) || 0
  const u = Number(unitCost) || 0
  if (!productId || q === 0) return { ok: true, unchanged: true }
  // Blend on the device copy from its value BEFORE the change
  let localBefore = null
  try { localBefore = await (db.products?.get(productId) ?? null) ?? (isServerId(productId) ? await db.products?.get(Number(productId)) : null) } catch (_) { /* cache only */ }
  const result = await runOrQueue('receive_purchase_stock', { p_product_id: productId, p_qty: q, p_unit_cost: u }, {
    ...options,
    legacy: () => legacyReceiveStock(productId, q, u)
  })
  if (result.ok && localBefore) {
    const serverRow = result.data && result.data.stock_quantity !== undefined ? result.data : null
    try {
      await db.products.update(localBefore.id, serverRow
        ? { stock_quantity: Number(serverRow.stock_quantity), cost_price: Number(serverRow.cost_price) }
        : { stock_quantity: (Number(localBefore.stock_quantity) || 0) + q, cost_price: weightedCost(localBefore.stock_quantity, localBefore.cost_price, q, u) })
    } catch (_) { /* cache only */ }
  }
  return result
}

/**
 * Saves a POS sale (header, lines, stock, phones, customer balance) in one database
 * transaction (sql/atomic_sale_and_cost.sql). Returns
 *   { ok: true, sale, items }            saved (or an earlier save of the same idempotency key)
 *   { ok: false, missing: true }         function not installed: use the step-by-step save
 *   { ok: false, network: true, error }  connection problem: the caller queues it offline
 *   { ok: false, error }                 refused (phone already sold, ...): nothing was saved
 */
export async function processPosSale(sale, items, { balanceDelta = 0, applyStock = true } = {}) {
  try {
    const { data, error } = await supabase.rpc('process_pos_sale', {
      p_sale: sale, p_items: items, p_balance_delta: Number(balanceDelta) || 0, p_apply_stock: Boolean(applyStock)
    })
    if (error) {
      if (isMissingFunction(error)) return { ok: false, missing: true, error: error.message }
      if (isNetworkError(error)) return { ok: false, network: true, error: error.message }
      return { ok: false, error: error.message || String(error) }
    }
    if (!data || data.success === false || !data.sale) return { ok: false, error: data?.error || 'Sale was not saved' }
    return { ok: true, sale: data.sale, items: data.items || [], replay: Boolean(data.replay) }
  } catch (err) {
    return isNetworkError(err) ? { ok: false, network: true, error: err.message } : { ok: false, error: err?.message || String(err) }
  }
}

async function adjustPartyBalance(table, fn, idKey, id, delta, options) {
  const d = Number(delta) || 0
  if (!id || d === 0) return { ok: true, unchanged: true }
  const result = await runOrQueue(fn, { [idKey]: id, p_delta: d }, {
    ...options,
    legacy: () => legacyPartyBalance(table, id, d)
  })
  if (result.ok) await bumpLocal(table, id, ['outstanding_balance', 'balance'], d)
  return result
}

/** Adds delta to a customer's outstanding balance (positive = customer owes more). */
export const adjustCustomerBalance = (customerId, delta, options = {}) =>
  adjustPartyBalance('customers', 'adjust_customer_balance', 'p_customer_id', customerId, delta, options)

/** Adds delta to a supplier's outstanding balance (positive = shop owes more). */
export const adjustSupplierBalance = (supplierId, delta, options = {}) =>
  adjustPartyBalance('suppliers', 'adjust_supplier_balance', 'p_supplier_id', supplierId, delta, options)

/**
 * Marks a phone sold only if it is still in stock (online). Returns
 * { ok: false, alreadySold: true } when another sale got there first.
 */
export async function markPhoneSold(phoneId, salePrice) {
  const price = Number(salePrice) || 0
  const local = async () => {
    try {
      if (db.phones) await db.phones.update(phoneId, { status: 'sold', sale_price: price, sold_at: new Date().toISOString() })
    } catch (_) { /* local cache only */ }
  }
  const { data, error } = await supabase.rpc('mark_phone_sold', { p_phone_id: phoneId, p_sale_price: price, p_op_id: newOpId() })
  if (!error && data?.success !== false) {
    await local()
    return { ok: true }
  }
  if (error && isMissingFunction(error)) {
    // Not migrated: guarded legacy write (only if still in stock)
    const res = await legacyMarkPhoneSold(phoneId, price)
    if (res.ok) await local()
    return res
  }
  const msg = error?.message || data?.error || 'Could not mark phone sold'
  return { ok: false, alreadySold: /already sold|not in stock/i.test(msg), error: msg }
}

/**
 * Offline sale: marks the phone sold on this device and queues the guarded server call.
 * If another device sold it meanwhile, the queued call is refused and kept in the
 * sync dead-letter store instead of silently overwriting.
 */
export async function queuePhoneSold(phoneId, salePrice) {
  const price = Number(salePrice) || 0
  try {
    if (db.phones) await db.phones.update(phoneId, { status: 'sold', sale_price: price, sold_at: new Date().toISOString() })
  } catch (_) { /* local cache only */ }
  await addToSyncQueue('rpc', 'RPC', { fn: 'mark_phone_sold', args: { p_phone_id: phoneId, p_sale_price: price, p_op_id: newOpId() } })
  return { ok: true, queued: true }
}

/**
 * Checks, before saving a sale, that every phone is still in stock on the server.
 * Returns the list of phone ids that are not.
 */
export async function findPhonesNotInStock(phoneIds = []) {
  const ids = phoneIds.filter(isServerId)
  if (ids.length === 0) return []
  const { data, error } = await supabase.from('phones').select('id, status').in('id', ids)
  if (error) throw error
  const inStock = new Set((data || []).filter(p => p.status === 'in_stock').map(p => String(p.id)))
  return ids.filter(id => !inStock.has(String(id)))
}
