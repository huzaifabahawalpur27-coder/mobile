import { supabase } from './supabase'
import { db } from './db'

/**
 * Service for Batch-Based FIFO Costing & Product Conversion
 */

/**
 * Preview product conversion to batch tracking (Dry-run, non-mutating)
 */
export async function previewBatchConversion({ productId = null, categoryId = null, productIds = null }) {
  try {
    const { data, error } = await supabase.rpc('preview_product_batch_conversion', {
      p_product_id: productId ? Number(productId) : null,
      p_category_id: categoryId ? Number(categoryId) : null,
      p_product_ids: productIds && productIds.length > 0 ? productIds.map(Number) : null
    })

    if (error) throw error
    return data || { success: false, error: 'Empty response' }
  } catch (err) {
    console.error('previewBatchConversion error:', err)
    return { success: false, error: err.message || 'Failed to preview conversion' }
  }
}

/**
 * Atomically convert a product to batch tracking with an opening balance
 */
export async function convertProductToBatchTracking({ productId, customCost = null, customBatches = null }) {
  try {
    const { data, error } = await supabase.rpc('convert_product_to_batch_tracking', {
      p_product_id: Number(productId),
      p_custom_cost: customCost !== null && !isNaN(parseFloat(customCost)) ? parseFloat(customCost) : null,
      p_custom_batches: customBatches || null
    })

    if (error) throw error

    // Mirror updates to local Dexie cache
    if (data?.success) {
      if (db.products) {
        await db.products.update(Number(productId), { inventory_mode: 'batch_tracked' }).catch(() => {})
      }
      if (db.stock_batches && data.batches_created?.length > 0) {
        await db.stock_batches.bulkPut(data.batches_created).catch(() => {})
      }
    }

    return data
  } catch (err) {
    console.error('convertProductToBatchTracking error:', err)
    return { success: false, error: err.message || 'Failed to convert product' }
  }
}

/**
 * Revert a converted product back to non_batch mode if no sales have consumed its batches
 */
export async function revertBatchConversion({ productId }) {
  try {
    const { data, error } = await supabase.rpc('revert_product_batch_conversion', {
      p_product_id: Number(productId)
    })

    if (error) throw error

    // Mirror to local Dexie cache
    if (data?.success) {
      if (db.products) {
        await db.products.update(Number(productId), { inventory_mode: 'non_batch' }).catch(() => {})
      }
      if (db.stock_batches) {
        const toDelete = await db.stock_batches.where({ product_id: Number(productId) }).toArray().catch(() => [])
        if (toDelete.length > 0) {
          await db.stock_batches.bulkDelete(toDelete.map(b => b.id)).catch(() => {})
        }
      }
    }

    return data
  } catch (err) {
    console.error('revertBatchConversion error:', err)
    return { success: false, error: err.message || 'Failed to revert conversion' }
  }
}

/**
 * Reconcile product stock against active batch sums
 */
export async function reconcileProductBatches({ productId }) {
  try {
    const { data, error } = await supabase.rpc('reconcile_product_batches', {
      p_product_id: Number(productId)
    })

    if (error) throw error
    return data
  } catch (err) {
    console.error('reconcileProductBatches error:', err)
    return { success: false, error: err.message || 'Failed to reconcile batches' }
  }
}

/**
 * Fetch all batches for a specific product
 */
export async function fetchProductBatches({ productId, shopId }) {
  try {
    if (navigator.onLine) {
      const { data, error } = await supabase
        .from('stock_batches')
        .select('*, suppliers(id, name), purchases(id, created_at, status)')
        .eq('product_id', Number(productId))
        .eq('shop_id', Number(shopId))
        .order('purchase_date', { ascending: false })

      if (!error && data) {
        if (db.stock_batches) await db.stock_batches.bulkPut(data).catch(() => {})
        return { success: true, batches: data }
      }
    }

    // Offline fallback to Dexie
    if (db.stock_batches) {
      const local = await db.stock_batches
        .where('product_id')
        .equals(Number(productId))
        .toArray()
        .catch(() => [])
      return { success: true, batches: local, isOffline: true }
    }

    return { success: true, batches: [] }
  } catch (err) {
    console.error('fetchProductBatches error:', err)
    return { success: false, error: err.message || 'Failed to fetch batches', batches: [] }
  }
}

/**
 * Allocate stock from active lots for a completed sale item line using FIFO
 */
export async function allocateSaleLineFIFO({ saleItemId, productId, quantity }) {
  try {
    const { data, error } = await supabase.rpc('allocate_sale_line_fifo', {
      p_sale_item_id: Number(saleItemId),
      p_product_id: Number(productId),
      p_quantity: parseFloat(quantity)
    })

    if (error) throw error
    return data
  } catch (err) {
    console.error('allocateSaleLineFIFO error:', err)
    return { success: false, error: err.message || 'Failed to allocate FIFO lots' }
  }
}

/**
 * Reverses lot allocations when a sale item is returned
 */
export async function returnSaleItemBatches({ saleItemId, returnQty, fallbackCost = null }) {
  try {
    const { data, error } = await supabase.rpc('return_sale_item_batches', {
      p_sale_item_id: Number(saleItemId),
      p_return_qty: parseFloat(returnQty),
      p_fallback_cost: fallbackCost !== null ? parseFloat(fallbackCost) : null
    })

    if (error) throw error
    return data
  } catch (err) {
    console.error('returnSaleItemBatches error:', err)
    return { success: false, error: err.message || 'Failed to reverse batch allocations' }
  }
}

/**
 * Adjust stock on an individual batch (Damage, loss, physical count correction)
 */
export async function adjustBatchStock({ batchId, qtyChange, reason }) {
  try {
    const { data, error } = await supabase.rpc('adjust_batch_stock', {
      p_batch_id: Number(batchId),
      p_qty_change: parseFloat(qtyChange),
      p_reason: String(reason).trim()
    })

    if (error) throw error
    return data
  } catch (err) {
    console.error('adjustBatchStock error:', err)
    return { success: false, error: err.message || 'Failed to adjust batch stock' }
  }
}
