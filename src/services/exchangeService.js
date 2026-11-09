import { supabase } from './supabase'
import { db } from './db'
import { fetchServerInvoiceToken } from './whatsappQueueService'

/**
 * Execute atomic phone exchange on PostgreSQL RPC
 */
export async function processPhoneExchange({
  customerId = null,
  customerName = '',
  customerPhone = '',
  branchId = null,
  incomingPhones = [],
  outgoingItems = [],
  saleAmount = 0,
  tradeInCredit = 0,
  settlementAmount = 0,
  settlementDirection = 'even', // 'customer_paid' | 'shop_payout' | 'even'
  paymentMethod = 'cash',
  paymentDetails = null,
  accountId = null,
  notes = '',
  idempotencyKey = null
}) {
  const payloadKey = idempotencyKey || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null)

  const rpcParams = {
    p_customer_id: customerId ? Number(customerId) : null,
    p_customer_name: customerName?.trim() || 'Walk-in Customer',
    p_customer_phone: customerPhone?.trim() || null,
    p_branch_id: branchId ? Number(branchId) : null,
    p_incoming_phones: incomingPhones.map(p => ({
      imei_1: String(p.imei_1 || '').trim(),
      imei_2: p.imei_2 ? String(p.imei_2).trim() : null,
      brand: p.brand?.trim() || 'Generic',
      model: p.model?.trim() || 'Phone',
      storage: p.storage?.trim() || null,
      color: p.color?.trim() || null,
      condition: p.condition || 'Used',
      pta_status: p.pta_status || 'PTA Approved',
      assessed_value: Number(p.assessed_value || p.trade_in_value || 0),
      // Price the phone is offered at in POS (empty: the database keeps a bought-back
      // phone's previous price, else uses the trade-in value)
      sale_price: Number(p.sale_price) > 0 ? Number(p.sale_price) : null,
      notes: p.notes?.trim() || null,
      inspection_details: p.inspection_details || null
    })),
    p_outgoing_items: outgoingItems.map(item => ({
      phone_id: item.phone_id ? Number(item.phone_id) : null,
      product_id: item.product_id ? Number(item.product_id) : null,
      product_name: item.product_name || item.name || 'Product',
      price: Number(item.price ?? item.custom_price ?? 0),
      quantity: Number(item.quantity ?? item.qty ?? 1)
    })),
    p_sale_amount: Number(saleAmount || 0),
    p_trade_in_credit: Number(tradeInCredit || 0),
    p_settlement_amount: Number(settlementAmount || 0),
    p_settlement_direction: settlementDirection,
    p_payment_method: paymentMethod,
    p_payment_details: paymentDetails || null,
    p_account_id: accountId ? Number(accountId) : null,
    p_notes: notes?.trim() || null,
    p_idempotency_key: payloadKey
  }

  // 1. Try Supabase RPC
  if (navigator.onLine) {
    try {
      const { data, error } = await supabase.rpc('process_phone_exchange', rpcParams)
      if (error) {
        throw new Error(error.message || 'Exchange transaction failed on server')
      }
      if (!data || data.success === false) {
        throw new Error(data?.error || 'Exchange transaction rejected')
      }

      // process_phone_exchange returns only the sequential exchange_number. The public
      // invoice link needs the unguessable token the row was given by its column default.
      if (data.exchange_id) {
        data.id = data.id || data.exchange_id
        if (!data.invoice_token) {
          data.invoice_token = await fetchServerInvoiceToken('exchanges', data.exchange_id)
        }
      }

      // Update local Dexie tables
      try {
        if (data.exchange_id) {
          const exchangeRecord = {
            id: data.exchange_id,
            exchange_number: data.exchange_number,
            invoice_token: data.invoice_token || null,
            customer_id: customerId,
            customer_name: customerName,
            customer_phone: customerPhone,
            sale_id: data.sale_id,
            purchase_id: data.purchase_id,
            sale_amount: Number(saleAmount),
            trade_in_credit: Number(tradeInCredit),
            settlement_amount: Number(settlementAmount),
            settlement_direction: settlementDirection,
            settlement_payment_method: paymentMethod,
            status: 'completed',
            notes: notes,
            created_at: new Date().toISOString()
          }
          await db.exchanges.put(exchangeRecord)
        }
      } catch (cacheErr) {
        console.warn('Dexie cache update warning for exchange:', cacheErr)
      }

      return data
    } catch (err) {
      console.error('Exchange RPC failed:', err)
      throw err
    }
  } else {
    throw new Error('Offline Exchange is not permitted. Concurrency lock on inventory and cash accounts requires an active connection.')
  }
}

/**
 * Fetch exchanges list with filters
 */
export async function getExchanges({ shopId, branchId = null, customerId = null, status = null, limit = 50, offset = 0 } = {}) {
  if (!shopId) return []

  if (navigator.onLine) {
    try {
      let query = supabase
        .from('exchanges')
        .select(`
          *,
          exchange_items (*),
          branches (name),
          customers (name, phone)
        `)
        .eq('shop_id', Number(shopId))
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (branchId) query = query.eq('branch_id', Number(branchId))
      if (customerId) query = query.eq('customer_id', Number(customerId))
      if (status) query = query.eq('status', status)

      const { data, error } = await query
      if (!error && data) {
        // Cache in Dexie
        try {
          await db.exchanges.bulkPut(data.map(d => ({
            id: d.id,
            exchange_number: d.exchange_number,
            shop_id: d.shop_id,
            branch_id: d.branch_id,
            customer_id: d.customer_id,
            status: d.status,
            created_at: d.created_at
          })))
        } catch (_) {}
        return data
      }
    } catch (err) {
      console.warn('Supabase getExchanges failed, falling back to local Dexie:', err)
    }
  }

  // Fallback to Dexie
  try {
    let list = await db.exchanges.where('shop_id').equals(Number(shopId)).toArray()
    if (status) list = list.filter(e => e.status === status)
    if (customerId) list = list.filter(e => String(e.customer_id) === String(customerId))
    list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    return list.slice(offset, offset + limit)
  } catch (dexErr) {
    console.error('Dexie getExchanges failed:', dexErr)
    return []
  }
}

/**
 * Fetch a single exchange by ID with full item details
 */
export async function getExchangeById(exchangeId) {
  if (!exchangeId) return null

  if (navigator.onLine) {
    try {
      const { data, error } = await supabase
        .from('exchanges')
        .select(`
          *,
          exchange_items (*),
          branches (name),
          customers (name, phone, address),
          sales (*),
          purchases (*)
        `)
        .eq('id', Number(exchangeId))
        .maybeSingle()

      if (!error && data) return data
    } catch (err) {
      console.warn('Supabase getExchangeById failed:', err)
    }
  }

  try {
    return await db.exchanges.get(Number(exchangeId))
  } catch (_) {
    return null
  }
}

/**
 * Void an existing exchange via authoritative RPC
 */
export async function voidPhoneExchange(exchangeId, voidReason = 'Customer requested exchange cancellation') {
  if (!exchangeId) throw new Error('Exchange ID is required')

  if (!navigator.onLine) {
    throw new Error('Active internet connection required to void an exchange')
  }

  const { data, error } = await supabase.rpc('void_phone_exchange', {
    p_exchange_id: Number(exchangeId),
    p_void_reason: voidReason
  })

  if (error) {
    throw new Error(error.message || 'Server rejected exchange voiding')
  }
  if (!data || data.success === false) {
    throw new Error(data?.error || 'Exchange voiding failed')
  }

  // Update local Dexie record
  try {
    const existing = await db.exchanges.get(Number(exchangeId))
    if (existing) {
      existing.status = 'voided'
      existing.void_reason = voidReason
      existing.voided_at = new Date().toISOString()
      await db.exchanges.put(existing)
    }
  } catch (_) {}

  return data
}
