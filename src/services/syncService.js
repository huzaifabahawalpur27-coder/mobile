import { db } from './db';
import { supabase } from './supabase';

// Tables that only exist locally and should NOT be synced to Supabase
const LOCAL_ONLY_TABLES = ['held_carts', 'held_purchases']
// Note: audit_logs intentionally removed — they now sync to Supabase;

export const sanitizeProductPayload = (prod) => {
    if (!prod || typeof prod !== 'object') return prod;
    const copy = { ...prod };

    // Delete string client-side UUID so Supabase assigns SERIAL integer PK
    if (typeof copy.id === 'string' && copy.id.includes('-')) {
        delete copy.id;
    }

    // Helper for integer FKs (category_id, supplier_id, unit_id, branch_id)
    const toIntOrNull = (val) => {
        if (val === null || val === undefined || val === '') return null;
        const n = parseInt(val, 10);
        return (!isNaN(n) && n > 0) ? n : null;
    };

    copy.category_id = toIntOrNull(copy.category_id);
    copy.supplier_id = toIntOrNull(copy.supplier_id);
    copy.unit_id = toIntOrNull(copy.unit_id);
    if ('branch_id' in copy) copy.branch_id = toIntOrNull(copy.branch_id);

    // Numeric fields: parse empty string or invalid number to 0 / fallback
    const toNumOrZero = (val, defaultVal = 0) => {
        if (val === null || val === undefined || val === '') return defaultVal;
        const n = Number(val);
        return isNaN(n) ? defaultVal : n;
    };

    copy.cost_price = toNumOrZero(copy.cost_price, 0);
    copy.sale_price = toNumOrZero(copy.sale_price, 0);
    copy.stock_quantity = toNumOrZero(copy.stock_quantity, 0);
    copy.c_rate = toNumOrZero(copy.c_rate, 0);
    copy.b_rate = toNumOrZero(copy.b_rate, 0);
    copy.low_stock_threshold = toNumOrZero(copy.low_stock_threshold, 10);

    // Strip nested joins that might be attached from local relations
    delete copy.categories;
    delete copy.suppliers;
    delete copy.units;

    return copy;
};

const updateLocalReferences = async (oldId, newId) => {
    try {
        if (!oldId || !newId || oldId === newId) return;

        // Update sale_items
        if (db.sale_items) {
            const items = await db.sale_items.where('product_id').equals(oldId).toArray();
            for (const it of items) {
                await db.sale_items.update(it.id, { product_id: newId });
            }
        }
        // Update purchase_items
        if (db.purchase_items) {
            const items = await db.purchase_items.where('product_id').equals(oldId).toArray();
            for (const it of items) {
                await db.purchase_items.update(it.id, { product_id: newId });
            }
        }
    } catch (e) {
        console.warn('updateLocalReferences error:', e);
    }
};

export const reconcileOfflineProducts = async (shopId) => {
    if (!navigator.onLine) {
        return { synced: 0, reason: 'offline' };
    }

    try {
        // Read local products for this shop (or all if shopId not specified)
        let localProducts = await db.products.toArray();
        if (shopId) {
            localProducts = localProducts.filter(p => String(p.shop_id) === String(shopId));
        }

        if (localProducts.length === 0) {
            return { synced: 0 };
        }

        // Fetch all existing product IDs, barcodes, and names from Supabase for this shop
        let query = supabase.from('products').select('id, name, barcode, shop_id');
        if (shopId) query = query.eq('shop_id', shopId);
        const { data: remoteProducts, error: fetchErr } = await query;

        if (fetchErr) {
            console.warn('reconcileOfflineProducts: Failed to fetch remote products:', fetchErr);
            return { synced: 0, error: fetchErr };
        }

        const remoteIdSet = new Set((remoteProducts || []).map(p => p.id));
        const remoteBarcodeMap = new Map();
        const remoteNameMap = new Map();

        (remoteProducts || []).forEach(rp => {
            if (rp.barcode && String(rp.barcode).trim()) {
                remoteBarcodeMap.set(String(rp.barcode).trim(), rp);
            }
            if (rp.name && String(rp.name).trim()) {
                remoteNameMap.set(String(rp.name).trim().toLowerCase(), rp);
            }
        });

        // Find products that are offline-only (UUID id or ID not in Supabase)
        const unsynced = localProducts.filter(p => {
            if (typeof p.id === 'string' && p.id.includes('-')) return true;
            if (!remoteIdSet.has(p.id)) return true;
            return false;
        });

        if (unsynced.length === 0) {
            return { synced: 0 };
        }

        console.log(`reconcileOfflineProducts: Found ${unsynced.length} unsynced product(s). Syncing to cloud...`);
        let syncedCount = 0;

        for (const prod of unsynced) {
            const oldId = prod.id;

            // Check if remote already has this product by barcode or name to avoid duplicates
            const trimmedBarcode = prod.barcode ? String(prod.barcode).trim() : null;
            const trimmedName = prod.name ? String(prod.name).trim().toLowerCase() : null;
            const existingRemote = (trimmedBarcode && remoteBarcodeMap.get(trimmedBarcode)) ||
                                   (trimmedName && remoteNameMap.get(trimmedName));

            if (existingRemote) {
                // Link local product to existing remote ID
                await db.products.delete(oldId);
                const merged = { ...prod, id: existingRemote.id };
                await db.products.put(merged);
                // Update references in sale_items & purchase_items
                await updateLocalReferences(oldId, existingRemote.id);
                syncedCount++;
                continue;
            }

            // Prepare payload
            const payload = sanitizeProductPayload(prod);
            if (shopId && !payload.shop_id) payload.shop_id = shopId;
            delete payload.id; // Ensure Supabase assigns SERIAL PK

            let { data: inserted, error: insErr } = await supabase.from('products').insert([payload]).select();

            // Retry without foreign keys if FK failed
            if (insErr && (insErr.code === '23503' || insErr.message?.includes('foreign key') || insErr.message?.includes('fkey'))) {
                console.warn(`reconcileOfflineProducts: FK failed for product "${prod.name}", retrying with null category/supplier`);
                const retryPayload = { ...payload, category_id: null, supplier_id: null, unit_id: null };
                const retry = await supabase.from('products').insert([retryPayload]).select();
                inserted = retry.data;
                insErr = retry.error;
            }

            if (!insErr && inserted && inserted[0]) {
                const newRow = inserted[0];
                const newId = newRow.id;

                await db.products.delete(oldId);
                await db.products.put(newRow);

                // Update local relations referencing the old UUID ID
                await updateLocalReferences(oldId, newId);

                // Update lookup maps for next iterations
                remoteIdSet.add(newId);
                if (newRow.barcode) remoteBarcodeMap.set(String(newRow.barcode).trim(), newRow);
                if (newRow.name) remoteNameMap.set(String(newRow.name).trim().toLowerCase(), newRow);

                syncedCount++;
            } else {
                console.error(`reconcileOfflineProducts: Failed to sync product "${prod.name}":`, insErr);
            }
        }

        // Clean up any remaining sync_queue entries for products that are now synced
        try {
            const queueItems = await db.sync_queue.where('table').equals('products').toArray();
            for (const qItem of queueItems) {
                const qId = qItem.data?.id;
                if (!qId || !unsynced.some(u => u.id === qId)) {
                    await db.sync_queue.delete(qItem.id);
                }
            }
        } catch (_) {}

        if (syncedCount > 0) {
            try {
                window.dispatchEvent(new CustomEvent('products_reconciled', { detail: { count: syncedCount } }));
            } catch (_) {}
        }

        return { synced: syncedCount };
    } catch (err) {
        console.error('reconcileOfflineProducts failed:', err);
        return { synced: 0, error: err };
    }
};

export const syncOfflineData = async () => {
    if (!navigator.onLine) return;

    const queue = await db.sync_queue.toArray();
    if (queue.length === 0) {
        // Even if queue is empty, reconcile offline products that might have had their queue dropped
        try {
            await reconcileOfflineProducts();
        } catch (_) {}
        return;
    }

    // Filter out local-only table entries and clean them from queue
    const syncable = [];
    for (const item of queue) {
        if (LOCAL_ONLY_TABLES.includes(item.table)) {
            await db.sync_queue.delete(item.id);
        } else {
            syncable.push(item);
        }
    }

    if (syncable.length === 0) {
        try {
            await reconcileOfflineProducts();
        } catch (_) {}
        return;
    }
    console.log(`Syncing ${syncable.length} offline actions...`);

    const idMapping = {}; // Maps offline string UUIDs to real DB numeric IDs

    for (const item of syncable) {
        try {
            // Helper to recursively replace UUIDs in the payload with real IDs
            const replaceIds = (obj) => {
                if (!obj || typeof obj !== 'object') return obj;
                if (Array.isArray(obj)) return obj.map(replaceIds);
                const newObj = { ...obj };
                for (const key in newObj) {
                    if (typeof newObj[key] === 'string' && idMapping[newObj[key]]) {
                        newObj[key] = idMapping[newObj[key]];
                    } else if (typeof newObj[key] === 'object') {
                        newObj[key] = replaceIds(newObj[key]);
                    }
                }
                return newObj;
            };

            let processedData = replaceIds(item.data);

            // Satisfy Supabase NOT NULL constraint for action_type in audit_logs
            if (item.table === 'audit_logs') {
                if (Array.isArray(processedData)) {
                    processedData = processedData.map(d => ({
                        ...d,
                        action_type: d.action_type || d.action || 'UNKNOWN'
                    }));
                } else {
                    processedData = {
                        ...processedData,
                        action_type: processedData.action_type || processedData.action || 'UNKNOWN'
                    };
                }
            }

            let error;
            let returnedData = null;

            if (item.action === 'INSERT') {
                const isArray = Array.isArray(processedData);
                let payload = isArray ? processedData.map(d => {
                    const obj = { ...d };
                    if (typeof obj.id === 'string' && obj.id.includes('-')) delete obj.id;
                    return obj;
                }) : (() => {
                    const obj = { ...processedData };
                    if (typeof obj.id === 'string' && obj.id.includes('-')) delete obj.id;
                    return obj;
                })();

                if (item.table === 'products') {
                    payload = isArray ? payload.map(sanitizeProductPayload) : sanitizeProductPayload(payload);
                }

                let resData = null;
                let err = null;

                // Check for existing sale with identical idempotency_key to prevent duplicate writes
                if (item.table === 'sales' && !isArray && payload.idempotency_key) {
                    const { data: existingSale } = await supabase
                        .from('sales')
                        .select('*')
                        .eq('idempotency_key', payload.idempotency_key)
                        .maybeSingle();

                    if (existingSale) {
                        console.log(`SyncService: Sale with idempotency_key ${payload.idempotency_key} already exists (ID ${existingSale.id}). Skipping re-insert.`);
                        resData = [existingSale];
                        err = null;
                    }
                }

                if (!resData) {
                    const insertRes = await supabase.from(item.table).insert(payload).select();
                    resData = insertRes.data;
                    err = insertRes.error;
                }

                // If products table fails on foreign key (category_id, supplier_id, unit_id), retry cleanly
                if (err && item.table === 'products' && (err.code === '23503' || err.message?.includes('foreign key') || err.message?.includes('fkey'))) {
                    console.warn('SyncService: Retrying products insert without foreign keys (category_id, supplier_id, unit_id)');
                    const retryPayload = isArray
                        ? payload.map(d => ({ ...d, category_id: null, supplier_id: null, unit_id: null }))
                        : { ...payload, category_id: null, supplier_id: null, unit_id: null };
                    const retry = await supabase.from(item.table).insert(retryPayload).select();
                    resData = retry.data;
                    err = retry.error;
                }

                // If sales table doesn't have newer columns yet in Supabase or fails on customer_id foreign key, retry cleanly
                if (err && item.table === 'sales') {
                    console.warn('SyncService: Retrying sales insert with core columns and sanitized customer_id');
                    const stripCols = ['online_provider', 'transaction_ref', 'created_by', 'customer_name', 'branch_id', 'idempotency_key', 'payment_details'];
                    const makeStripped = (dropCustomer = false) => {
                        const cleanItem = (d) => {
                            const copy = { ...d };
                            stripCols.forEach(col => delete copy[col]);
                            if (dropCustomer) copy.customer_id = null;
                            return copy;
                        };
                        return isArray ? payload.map(cleanItem) : cleanItem(payload);
                    };

                    const isFkErr = err.code === '23503' || err.message?.includes('customer_id') || err.message?.includes('foreign key');
                    let retry = await supabase.from(item.table).insert(makeStripped(isFkErr)).select();
                    if (retry.error && (retry.error.code === '23503' || retry.error.message?.includes('customer_id') || retry.error.message?.includes('foreign key'))) {
                        console.warn('SyncService: Retrying sales insert with customer_id = null');
                        retry = await supabase.from(item.table).insert(makeStripped(true)).select();
                    }
                    resData = retry.data;
                    err = retry.error;
                }

                // If categories table doesn't have description or low_stock_threshold columns yet, retry without them
                if (err && item.table === 'categories' && (err.code === 'PGRST204' || err.code === '42703' || err.message?.includes('description') || err.message?.includes('low_stock_threshold') || err.message?.includes('schema cache'))) {
                    console.warn('SyncService: Retrying categories insert without optional columns (description, low_stock_threshold)');
                    const strippedPayload = isArray ? payload.map(d => {
                        const copy = { ...d };
                        delete copy.description;
                        delete copy.low_stock_threshold;
                        return copy;
                    }) : (() => {
                        const copy = { ...payload };
                        delete copy.description;
                        delete copy.low_stock_threshold;
                        return copy;
                    })();
                    const retry = await supabase.from(item.table).insert(strippedPayload).select();
                    resData = retry.data;
                    err = retry.error;
                }

                // If suppliers table doesn't have brand, product_type, or other_details columns yet, retry without them
                if (err && item.table === 'suppliers' && (err.code === 'PGRST204' || err.code === '42703' || err.message?.includes('brand') || err.message?.includes('product_type') || err.message?.includes('other_details') || err.message?.includes('outstanding_balance') || err.message?.includes('schema cache'))) {
                    console.warn('SyncService: Retrying suppliers insert with core columns');
                    const stripSup = (d) => {
                        const copy = { ...d };
                        delete copy.brand;
                        delete copy.product_type;
                        delete copy.other_details;
                        delete copy.outstanding_balance;
                        return copy;
                    };
                    const strippedPayload = isArray ? payload.map(stripSup) : stripSup(payload);
                    const retry = await supabase.from(item.table).insert(strippedPayload).select();
                    resData = retry.data;
                    err = retry.error;
                }

                // If supplier_payments table lacks custom columns (details, bill_number, payment_mode, transaction_ref)
                if (err && item.table === 'supplier_payments' && (err.code === 'PGRST204' || err.code === '42703' || String(err.status) === '400' || err.message?.includes('schema cache') || err.message?.includes('column'))) {
                    console.warn('SyncService: Retrying supplier_payments insert without missing schema columns');
                    const stripPay = (d) => {
                        const copy = { ...d };
                        const noteText = [copy.bill_number ? `[Bill #${copy.bill_number}]` : '', copy.note || copy.description].filter(Boolean).join(' ');
                        if (noteText) {
                            copy.note = noteText;
                            if (!copy.description) copy.description = noteText;
                        }
                        delete copy.details;
                        delete copy.bill_number;
                        delete copy.payment_mode;
                        delete copy.transaction_ref;
                        return copy;
                    };
                    const strippedPayload = isArray ? payload.map(stripPay) : stripPay(payload);
                    let retry = await supabase.from(item.table).insert(strippedPayload).select();
                    if (retry.error && (retry.error.code === 'PGRST204' || retry.error.message?.includes('column'))) {
                        const legacyStrip = (d) => {
                            const c = { ...d };
                            delete c.payment_type;
                            delete c.note;
                            return c;
                        };
                        const legacyPayload = isArray ? strippedPayload.map(legacyStrip) : legacyStrip(strippedPayload);
                        retry = await supabase.from(item.table).insert(legacyPayload).select();
                    }
                    resData = retry.data;
                    err = retry.error;
                }

                // If customer_payments table lacks custom columns
                if (err && item.table === 'customer_payments' && (err.code === 'PGRST204' || err.code === '42703' || String(err.status) === '400' || err.message?.includes('schema cache') || err.message?.includes('column'))) {
                    console.warn('SyncService: Retrying customer_payments insert with core columns');
                    const stripPay = (d) => {
                        const copy = { ...d };
                        if (!copy.description && copy.note) copy.description = copy.note;
                        delete copy.details;
                        delete copy.bill_number;
                        delete copy.payment_mode;
                        delete copy.transaction_ref;
                        delete copy.payment_type;
                        delete copy.note;
                        return copy;
                    };
                    const strippedPayload = isArray ? payload.map(stripPay) : stripPay(payload);
                    const retry = await supabase.from(item.table).insert(strippedPayload).select();
                    resData = retry.data;
                    err = retry.error;
                }

                // If audit_logs table lacks action_type or action column in Supabase, retry cleanly
                if (err && item.table === 'audit_logs' && (err.code === 'PGRST204' || err.code === '42703' || err.message?.includes('schema cache') || err.message?.includes('column'))) {
                    const stripCol = err.message?.includes('action_type') ? 'action_type' : (err.message?.includes('action') ? 'action' : null);
                    if (stripCol) {
                        console.warn(`SyncService: Retrying audit_logs insert without ${stripCol}`);
                        const stripAudit = (d) => {
                            const copy = { ...d };
                            delete copy[stripCol];
                            return copy;
                        };
                        const strippedPayload = isArray ? payload.map(stripAudit) : stripAudit(payload);
                        const retry = await supabase.from(item.table).insert(strippedPayload).select();
                        resData = retry.data;
                        err = retry.error;
                    }
                }

                // If sale_items has non-integer sale_id (e.g. offline UUID), resolve from idMapping or Dexie/idempotency_key
                if (err && item.table === 'sale_items' && (err.code === '22P02' || err.message?.includes('invalid input syntax for type integer'))) {
                    const firstItem = isArray ? payload[0] : payload;
                    const offlineSaleId = firstItem?.sale_id;
                    let mappedSaleId = offlineSaleId && idMapping[offlineSaleId];
                    if (!mappedSaleId && offlineSaleId && typeof offlineSaleId === 'string' && offlineSaleId.includes('-')) {
                        try {
                            const localSale = await db.sales.get(offlineSaleId);
                            if (localSale?.idempotency_key) {
                                const { data: matchedSale } = await supabase.from('sales').select('id').eq('idempotency_key', localSale.idempotency_key).maybeSingle();
                                if (matchedSale?.id) {
                                    mappedSaleId = matchedSale.id;
                                    idMapping[offlineSaleId] = mappedSaleId;
                                }
                            }
                        } catch (_) {}
                    }
                    if (mappedSaleId) {
                        console.warn(`SyncService: Resolving sale_items sale_id from mapped id (${offlineSaleId} -> ${mappedSaleId})`);
                        const fixedPayload = isArray ? payload.map(d => ({ ...d, sale_id: mappedSaleId })) : { ...payload, sale_id: mappedSaleId };
                        let retry = await supabase.from(item.table).insert(fixedPayload).select();
                        if (retry.error && (retry.error.code === 'PGRST204' || retry.error.code === '42703' || String(retry.error.status) === '400' || retry.error.message?.includes('schema cache') || retry.error.message?.includes('column'))) {
                            const cleanItem = (d) => ({
                                sale_id: mappedSaleId,
                                product_id: d.phone_id ? null : d.product_id,
                                quantity: d.quantity,
                                price: d.price || d.unit_price,
                                subtotal: d.subtotal || (d.quantity * (d.price || d.unit_price)),
                                returned_qty: 0
                            });
                            const minimalPayload = isArray ? fixedPayload.map(cleanItem) : cleanItem(fixedPayload);
                            retry = await supabase.from(item.table).insert(minimalPayload).select();
                        }
                        resData = retry.data;
                        err = retry.error;
                    }
                }

                // If sale_items lacks newer columns in standard insert
                if (err && item.table === 'sale_items' && (err.code === 'PGRST204' || err.code === '42703' || String(err.status) === '400' || err.message?.includes('schema cache') || err.message?.includes('column'))) {
                    console.warn('SyncService: Retrying sale_items with minimal columns');
                    const cleanItem = (d) => ({
                        sale_id: d.sale_id,
                        product_id: d.phone_id ? null : d.product_id,
                        quantity: d.quantity,
                        price: d.price || d.unit_price,
                        subtotal: d.subtotal || (d.quantity * (d.price || d.unit_price)),
                        returned_qty: 0
                    });
                    const minimalPayload = isArray ? payload.map(cleanItem) : cleanItem(payload);
                    const retry = await supabase.from(item.table).insert(minimalPayload).select();
                    resData = retry.data;
                    err = retry.error;
                }

                error = err;
                returnedData = resData;

                if (!error && returnedData) {
                    if (isArray) {
                        const originalIds = processedData.map(d => d.id).filter(id => typeof id === 'string' && id.includes('-'));
                        if (originalIds.length > 0) {
                            await db[item.table].bulkDelete(originalIds);
                        }
                        await db[item.table].bulkPut(returnedData);
                    } else {
                        const oldId = item.data.id;
                        if (typeof oldId === 'string' && oldId.includes('-')) {
                            await db[item.table].delete(oldId);
                            const newId = returnedData[0].id;
                            
                            // Cascade ID update to other items in local IndexedDB
                            await db[item.table].put(returnedData[0]);

                            // Cascade ID update in remaining sync queue entries
                            const remainingQueue = await db.sync_queue.toArray();
                            for (const qItem of remainingQueue) {
                                if (qItem.id === item.id) continue;
                                let updated = false;
                                const updateRefs = (obj) => {
                                    if (!obj || typeof obj !== 'object') return obj;
                                    if (Array.isArray(obj)) {
                                        return obj.map(o => {
                                            const res = updateRefs(o);
                                            if (res !== o) updated = true;
                                            return res;
                                        });
                                    }
                                    const copy = { ...obj };
                                    for (const k in copy) {
                                        if (copy[k] === oldId) {
                                            copy[k] = newId;
                                            updated = true;
                                        } else if (typeof copy[k] === 'object') {
                                            const res = updateRefs(copy[k]);
                                            if (res !== copy[k]) {
                                                copy[k] = res;
                                                updated = true;
                                            }
                                        }
                                    }
                                    return copy;
                                };
                                const newPayload = updateRefs(qItem.data);
                                if (updated) {
                                    await db.sync_queue.update(qItem.id, { data: newPayload });
                                }
                            }
                            
                            // Keep in-memory mapping as backup for current sync run
                            idMapping[oldId] = newId;
                        } else {
                            await db[item.table].put(returnedData[0]);
                        }
                    }
                }
            } else if (item.action === 'UPDATE') {
                const dataObj = Array.isArray(processedData) ? processedData[0] : processedData;
                let { id, ...updateData } = dataObj;
                if (item.table === 'products') {
                    updateData = sanitizeProductPayload(updateData);
                }
                if (id) {
                    if (item.table === 'products' && typeof id === 'string' && id.includes('-')) {
                        // Product has offline UUID, cannot update directly by UUID in Supabase. Reconcile it!
                        console.warn('SyncService: Product UPDATE has offline UUID ID, triggering reconcileOfflineProducts...');
                        await reconcileOfflineProducts();
                        await db.sync_queue.delete(item.id);
                        continue;
                    }
                    ({ error } = await supabase.from(item.table).update(updateData).eq('id', id));
                    if (error && item.table === 'categories' && (error.code === 'PGRST204' || error.code === '42703' || error.message?.includes('description') || error.message?.includes('low_stock_threshold') || error.message?.includes('schema cache'))) {
                        const { description: _d, low_stock_threshold: _l, ...strippedUpdate } = updateData;
                        ({ error } = await supabase.from(item.table).update(strippedUpdate).eq('id', id));
                    }
                    if (error && item.table === 'suppliers' && (error.code === 'PGRST204' || error.code === '42703' || error.message?.includes('brand') || error.message?.includes('product_type') || error.message?.includes('other_details') || error.message?.includes('outstanding_balance') || error.message?.includes('schema cache'))) {
                        const { brand: _b, product_type: _p, other_details: _o, outstanding_balance: _ob, ...strippedUpdate } = updateData;
                        ({ error } = await supabase.from(item.table).update(strippedUpdate).eq('id', id));
                    }
                    if (error && (item.table === 'supplier_payments' || item.table === 'customer_payments') && (error.code === 'PGRST204' || error.code === '42703' || String(error.status) === '400' || error.message?.includes('schema cache'))) {
                        const { bill_number: _b, details: _d, payment_mode: _pm, transaction_ref: _tr, payment_type: _pt, note: _n, ...strippedUpdate } = updateData;
                        if (updateData.note && !strippedUpdate.description) strippedUpdate.description = updateData.note;
                        ({ error } = await supabase.from(item.table).update(strippedUpdate).eq('id', id));
                    }
                } else {
                    // Can't update without an ID, skip
                    await db.sync_queue.delete(item.id);
                    continue;
                }
            } else if (item.action === 'DELETE') {
                const dataObj = Array.isArray(processedData) ? processedData[0] : processedData;
                if (dataObj.id) {
                    ({ error } = await supabase.from(item.table).delete().eq('id', dataObj.id));
                } else {
                    await db.sync_queue.delete(item.id);
                    continue;
                }
            }

            if (!error) {
                await db.sync_queue.delete(item.id);
            } else {
                console.error(`Sync error for ${item.table}:`, error);
                const retries = (item.retry_count || 0) + 1;
                // If permanent missing table or exceeded max retries, remove to prevent queue stalls
                if (retries >= 5 || ['PGRST205', '42P01'].includes(error.code) || (retries >= 3 && ['PGRST204', '42703', '22P02'].includes(error.code)) || (retries >= 3 && String(error.status) === '400') || error.message?.includes('Could not find')) {
                    console.warn(`Removing un-syncable item ${item.id} after ${retries} attempts.`);
                    await db.sync_queue.delete(item.id);
                } else {
                    await db.sync_queue.update(item.id, { retry_count: retries });
                }
            }
        } catch (e) {
            console.error('Sync failed:', e);
        }
    }

    // Always run reconciliation after queue pass to catch any un-queued or dropped offline products
    try {
        await reconcileOfflineProducts();
    } catch (_) {}

    try {
        window.dispatchEvent(new CustomEvent('sync_completed'));
    } catch (_) {}
};

// Periodically check for sync if online
setInterval(syncOfflineData, 30000);

window.addEventListener('online', syncOfflineData);
