import { db } from './db';
import { supabase } from './supabase';

// Tables that only exist locally and should NOT be synced to Supabase
const LOCAL_ONLY_TABLES = ['held_carts', 'held_purchases']
// Note: audit_logs intentionally removed — they now sync to Supabase;

export const syncOfflineData = async () => {
    if (!navigator.onLine) return;

    const queue = await db.sync_queue.toArray();
    if (queue.length === 0) return;

    // Filter out local-only table entries and clean them from queue
    const syncable = [];
    for (const item of queue) {
        if (LOCAL_ONLY_TABLES.includes(item.table)) {
            await db.sync_queue.delete(item.id);
        } else {
            syncable.push(item);
        }
    }

    if (syncable.length === 0) return;
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
                const payload = isArray ? processedData.map(d => {
                    const obj = { ...d };
                    if (typeof obj.id === 'string' && obj.id.includes('-')) delete obj.id;
                    return obj;
                }) : (() => {
                    const obj = { ...processedData };
                    if (typeof obj.id === 'string' && obj.id.includes('-')) delete obj.id;
                    return obj;
                })();

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

                // If sales table doesn't have online_provider or transaction_ref columns yet in Supabase, retry without them
                if (err && item.table === 'sales' && (err.code === 'PGRST204' || err.code === '42703' || err.message?.includes('online_provider') || err.message?.includes('transaction_ref'))) {
                    console.warn('SyncService: Retrying sales insert without top-level online columns (details preserved in payment_details JSONB)');
                    const strippedPayload = isArray ? payload.map(d => {
                        const copy = { ...d };
                        delete copy.online_provider;
                        delete copy.transaction_ref;
                        return copy;
                    }) : (() => {
                        const copy = { ...payload };
                        delete copy.online_provider;
                        delete copy.transaction_ref;
                        return copy;
                    })();
                    const retry = await supabase.from(item.table).insert(strippedPayload).select();
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
                const { id, ...updateData } = dataObj;
                if (id) {
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
                // If table/column error or exceeded max 5 retries, remove to prevent queue stalls
                if (retries >= 5 || ['PGRST205', '42P01', 'PGRST204', '42703', '22P02'].includes(error.code) || String(error.status) === '400' || error.message?.includes('schema cache') || error.message?.includes('Could not find')) {
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

    try {
        window.dispatchEvent(new CustomEvent('sync_completed'));
    } catch (_) {}
};

// Periodically check for sync if online
setInterval(syncOfflineData, 30000);

window.addEventListener('online', syncOfflineData);
