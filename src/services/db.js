import Dexie from 'dexie';

export const db = new Dexie('SanitaryPOS_Local');

db.version(1).stores({
  products: 'id, name, brand, category_id, shop_id',
  categories: 'id, name, shop_id',
  suppliers: 'id, name, shop_id',
  customers: 'id, name, shop_id',
  sync_queue: '++id, table, action, data, timestamp'
});

db.version(2).stores({
  products: 'id, name, brand, category_id, shop_id',
  categories: 'id, name, shop_id',
  suppliers: 'id, name, shop_id',
  customers: 'id, name, shop_id',
  sync_queue: '++id, table, action, data, timestamp',
  audit_logs: '++id, action, entity, entity_id, user_id, timestamp',
  held_carts: '++id, customer_id, shop_id, saved_at'
});

db.version(6).stores({
  products: 'id, name, brand, category_id, shop_id',
  categories: 'id, name, shop_id',
  suppliers: 'id, name, shop_id',
  customers: 'id, name, shop_id',
  brands: 'id, name, shop_id',
  sales: 'id, customer_id, shop_id, created_at',
  sale_items: 'id, sale_id, product_id',
  purchases: 'id, supplier_id, shop_id, created_at',
  purchase_items: 'id, purchase_id, product_id',
  expenses: 'id, category, shop_id, date',
  users: 'id, username, shop_id, role',
  shops: 'id, name',
  customer_payments: 'id, customer_id, shop_id, created_at',
  supplier_payments: 'id, supplier_id, shop_id, created_at',
  sync_queue: '++id, table, action, data, timestamp',
  audit_logs: '++id, action, entity, entity_id, user_id, timestamp',
  held_carts: '++id, customer_id, shop_id, saved_at'
});

db.version(7).stores({
  products: 'id, name, brand, category_id, shop_id',
  categories: 'id, name, shop_id',
  suppliers: 'id, name, shop_id',
  customers: 'id, name, shop_id',
  brands: 'id, name, shop_id',
  sales: 'id, customer_id, shop_id, created_at',
  sale_items: 'id, sale_id, product_id',
  purchases: 'id, supplier_id, shop_id, created_at',
  purchase_items: 'id, purchase_id, product_id',
  expenses: 'id, category, shop_id, date',
  users: 'id, username, shop_id, role',
  shops: 'id, name',
  customer_payments: 'id, customer_id, shop_id, created_at',
  supplier_payments: 'id, supplier_id, shop_id, created_at',
  sync_queue: '++id, table, action, data, timestamp',
  audit_logs: '++id, action, entity, entity_id, user_id, timestamp',
  held_carts: '++id, customer_id, shop_id, saved_at',
  trash: '++id, original_table, original_id, shop_id, deleted_at, deleted_by'
});

db.version(8).stores({
  products: 'id, name, brand, category_id, shop_id',
  categories: 'id, name, shop_id',
  suppliers: 'id, name, shop_id',
  customers: 'id, name, shop_id',
  brands: 'id, name, shop_id',
  sales: 'id, customer_id, shop_id, created_at',
  sale_items: 'id, sale_id, product_id',
  purchases: 'id, supplier_id, shop_id, created_at',
  purchase_items: 'id, purchase_id, product_id',
  expenses: 'id, category, shop_id, date',
  users: 'id, username, shop_id, role',
  shops: 'id, name',
  customer_payments: 'id, customer_id, shop_id, created_at',
  supplier_payments: 'id, supplier_id, shop_id, created_at',
  sync_queue: '++id, table, action, data, timestamp',
  audit_logs: '++id, action, entity, entity_id, user_id, timestamp',
  held_carts: '++id, customer_id, shop_id, saved_at',
  trash: '++id, original_table, original_id, shop_id, deleted_at, deleted_by'
});

// v9: audit_logs switches from auto-int PK (++id) to UUID PK (id)
// so syncService can strip it before Supabase INSERT (BIGSERIAL generates its own)
db.version(9).stores({
  products: 'id, name, brand, category_id, shop_id',
  categories: 'id, name, shop_id',
  suppliers: 'id, name, shop_id',
  customers: 'id, name, shop_id',
  brands: 'id, name, shop_id',
  sales: 'id, customer_id, shop_id, created_at',
  sale_items: 'id, sale_id, product_id',
  purchases: 'id, supplier_id, shop_id, created_at',
  purchase_items: 'id, purchase_id, product_id',
  expenses: 'id, category, shop_id, date',
  users: 'id, username, shop_id, role',
  shops: 'id, name',
  customer_payments: 'id, customer_id, shop_id, created_at',
  supplier_payments: 'id, supplier_id, shop_id, created_at',
  sync_queue: '++id, table, action, data, timestamp',
  audit_logs: 'id, action, entity, entity_id, user_id, shop_id, timestamp',
  held_carts: '++id, customer_id, shop_id, saved_at',
  trash: '++id, original_table, original_id, shop_id, deleted_at, deleted_by'
});

// v10: brand_categories junction table for brand-category linking
db.version(10).stores({
  products: 'id, name, brand, category_id, shop_id',
  categories: 'id, name, shop_id',
  suppliers: 'id, name, shop_id',
  customers: 'id, name, shop_id',
  brands: 'id, name, shop_id',
  sales: 'id, customer_id, shop_id, created_at',
  sale_items: 'id, sale_id, product_id',
  purchases: 'id, supplier_id, shop_id, created_at',
  purchase_items: 'id, purchase_id, product_id',
  expenses: 'id, category, shop_id, date',
  users: 'id, username, shop_id, role',
  shops: 'id, name',
  customer_payments: 'id, customer_id, shop_id, created_at',
  supplier_payments: 'id, supplier_id, shop_id, created_at',
  sync_queue: '++id, table, action, data, timestamp',
  audit_logs: 'id, action, entity, entity_id, user_id, shop_id, timestamp',
  held_carts: '++id, customer_id, shop_id, saved_at',
  trash: '++id, original_table, original_id, shop_id, deleted_at, deleted_by',
  brand_categories: '++id, brand_id, category_id, shop_id'
});

// v11: units table for product unit-of-measure (Piece, Kg, Feet, etc.)
db.version(11).stores({
  products: 'id, name, brand, category_id, shop_id',
  categories: 'id, name, shop_id',
  suppliers: 'id, name, shop_id',
  customers: 'id, name, shop_id',
  brands: 'id, name, shop_id',
  sales: 'id, customer_id, shop_id, created_at',
  sale_items: 'id, sale_id, product_id',
  purchases: 'id, supplier_id, shop_id, created_at',
  purchase_items: 'id, purchase_id, product_id',
  expenses: 'id, category, shop_id, date',
  users: 'id, username, shop_id, role',
  shops: 'id, name',
  customer_payments: 'id, customer_id, shop_id, created_at',
  supplier_payments: 'id, supplier_id, shop_id, created_at',
  sync_queue: '++id, table, action, data, timestamp',
  audit_logs: 'id, action, entity, entity_id, user_id, shop_id, timestamp',
  held_carts: '++id, customer_id, shop_id, saved_at',
  trash: '++id, original_table, original_id, shop_id, deleted_at, deleted_by',
  brand_categories: '++id, brand_id, category_id, shop_id',
  units: '++id, name, abbreviation, shop_id'
});

// v12: branches store and branch_id indexes for multi-tenant branch support
db.version(12).stores({
  products: 'id, name, brand, category_id, shop_id',
  categories: 'id, name, shop_id',
  suppliers: 'id, name, shop_id',
  customers: 'id, name, shop_id',
  brands: 'id, name, shop_id',
  sales: 'id, customer_id, shop_id, branch_id, created_at',
  sale_items: 'id, sale_id, product_id',
  purchases: 'id, supplier_id, shop_id, branch_id, created_at',
  purchase_items: 'id, purchase_id, product_id',
  expenses: 'id, category, shop_id, branch_id, date',
  users: 'id, username, shop_id, role',
  shops: 'id, name',
  customer_payments: 'id, customer_id, shop_id, created_at',
  supplier_payments: 'id, supplier_id, shop_id, created_at',
  sync_queue: '++id, table, action, data, timestamp',
  audit_logs: 'id, action, entity, entity_id, user_id, shop_id, timestamp',
  held_carts: '++id, customer_id, shop_id, saved_at',
  trash: '++id, original_table, original_id, shop_id, deleted_at, deleted_by',
  brand_categories: '++id, brand_id, category_id, shop_id',
  units: '++id, name, abbreviation, shop_id',
  branches: 'id, shop_id, name, is_main, is_active'
});

// v13: phones inventory store for IMEI-first tracking
db.version(13).stores({
  products: 'id, name, brand, category_id, shop_id',
  categories: 'id, name, shop_id',
  suppliers: 'id, name, shop_id',
  customers: 'id, name, shop_id',
  brands: 'id, name, shop_id',
  sales: 'id, customer_id, shop_id, branch_id, created_at',
  sale_items: 'id, sale_id, product_id',
  purchases: 'id, supplier_id, shop_id, branch_id, created_at',
  purchase_items: 'id, purchase_id, product_id',
  expenses: 'id, category, shop_id, branch_id, date',
  users: 'id, username, shop_id, role',
  shops: 'id, name',
  customer_payments: 'id, customer_id, shop_id, created_at',
  supplier_payments: 'id, supplier_id, shop_id, created_at',
  sync_queue: '++id, table, action, data, timestamp',
  audit_logs: 'id, action, entity, entity_id, user_id, shop_id, timestamp',
  held_carts: '++id, customer_id, shop_id, saved_at',
  trash: '++id, original_table, original_id, shop_id, deleted_at, deleted_by',
  brand_categories: '++id, brand_id, category_id, shop_id',
  units: '++id, name, abbreviation, shop_id',
  branches: 'id, shop_id, name, is_main, is_active',
  phones: 'id, shop_id, branch_id, imei_1, imei_2, brand, model, status, condition, pta_status'
});

// v14: phone_custody store for tracking temporary issues, reservations, and personal use
db.version(14).stores({
  products: 'id, name, brand, category_id, shop_id',
  categories: 'id, name, shop_id',
  suppliers: 'id, name, shop_id',
  customers: 'id, name, shop_id',
  brands: 'id, name, shop_id',
  sales: 'id, customer_id, shop_id, branch_id, created_at',
  sale_items: 'id, sale_id, product_id',
  purchases: 'id, supplier_id, shop_id, branch_id, created_at',
  purchase_items: 'id, purchase_id, product_id',
  expenses: 'id, category, shop_id, branch_id, date',
  users: 'id, username, shop_id, role',
  shops: 'id, name',
  customer_payments: 'id, customer_id, shop_id, created_at',
  supplier_payments: 'id, supplier_id, shop_id, created_at',
  sync_queue: '++id, table, action, data, timestamp',
  audit_logs: 'id, action, entity, entity_id, user_id, shop_id, timestamp',
  held_carts: '++id, customer_id, shop_id, saved_at',
  trash: '++id, original_table, original_id, shop_id, deleted_at, deleted_by',
  brand_categories: '++id, brand_id, category_id, shop_id',
  units: '++id, name, abbreviation, shop_id',
  branches: 'id, shop_id, name, is_main, is_active',
  phones: 'id, shop_id, branch_id, imei_1, imei_2, brand, model, status, condition, pta_status',
  phone_custody: 'id, shop_id, branch_id, phone_id, status, issue_type, recipient_name, created_at'
});

// v15: cash_sessions store for cash drawer sessions and shift management
db.version(15).stores({
  products: 'id, name, brand, category_id, shop_id',
  categories: 'id, name, shop_id',
  suppliers: 'id, name, shop_id',
  customers: 'id, name, shop_id',
  brands: 'id, name, shop_id',
  sales: 'id, customer_id, shop_id, branch_id, created_at',
  sale_items: 'id, sale_id, product_id',
  purchases: 'id, supplier_id, shop_id, branch_id, created_at',
  purchase_items: 'id, purchase_id, product_id',
  expenses: 'id, category, shop_id, branch_id, date',
  users: 'id, username, shop_id, role',
  shops: 'id, name',
  customer_payments: 'id, customer_id, shop_id, created_at',
  supplier_payments: 'id, supplier_id, shop_id, created_at',
  sync_queue: '++id, table, action, data, timestamp',
  audit_logs: 'id, action, entity, entity_id, user_id, shop_id, timestamp',
  held_carts: '++id, customer_id, shop_id, saved_at',
  trash: '++id, original_table, original_id, shop_id, deleted_at, deleted_by',
  brand_categories: '++id, brand_id, category_id, shop_id',
  units: '++id, name, abbreviation, shop_id',
  branches: 'id, shop_id, name, is_main, is_active',
  phones: 'id, shop_id, branch_id, imei_1, imei_2, brand, model, status, condition, pta_status',
  phone_custody: 'id, shop_id, branch_id, phone_id, status, issue_type, recipient_name, created_at',
  cash_sessions: 'id, shop_id, branch_id, user_id, status, opened_at'
});

// v16: bank_accounts and bank_account_transactions stores for payments, settlements, and bank balances
db.version(16).stores({
  products: 'id, name, brand, category_id, shop_id',
  categories: 'id, name, shop_id',
  suppliers: 'id, name, shop_id',
  customers: 'id, name, shop_id',
  brands: 'id, name, shop_id',
  sales: 'id, customer_id, shop_id, branch_id, created_at',
  sale_items: 'id, sale_id, product_id',
  purchases: 'id, supplier_id, shop_id, branch_id, created_at',
  purchase_items: 'id, purchase_id, product_id',
  expenses: 'id, category, shop_id, branch_id, date',
  users: 'id, username, shop_id, role',
  shops: 'id, name',
  customer_payments: 'id, customer_id, shop_id, created_at',
  supplier_payments: 'id, supplier_id, shop_id, created_at',
  sync_queue: '++id, table, action, data, timestamp',
  audit_logs: 'id, action, entity, entity_id, user_id, shop_id, timestamp',
  held_carts: '++id, customer_id, shop_id, saved_at',
  trash: '++id, original_table, original_id, shop_id, deleted_at, deleted_by',
  brand_categories: '++id, brand_id, category_id, shop_id',
  units: '++id, name, abbreviation, shop_id',
  branches: 'id, shop_id, name, is_main, is_active',
  phones: 'id, shop_id, branch_id, imei_1, imei_2, brand, model, status, condition, pta_status',
  phone_custody: 'id, shop_id, branch_id, phone_id, status, issue_type, recipient_name, created_at',
  cash_sessions: 'id, shop_id, branch_id, user_id, status, opened_at',
  bank_accounts: 'id, shop_id, account_name, bank_name, status, is_default',
  bank_account_transactions: 'id, shop_id, account_id, transaction_type, reference_id, created_at'
});

export const addToSyncQueue = async (table, action, data) => {
  await db.sync_queue.add({
    table,
    action,
    data,
    timestamp: new Date().toISOString()
  });
};

export const moveToTrash = async (table, originalId, data, userId, shopId) => {
  await db.trash.add({
    original_table: table,
    original_id: originalId,
    data: JSON.parse(JSON.stringify(data)),
    shop_id: shopId,
    deleted_by: userId,
    deleted_at: new Date().toISOString()
  });
};

export const restoreFromTrash = async (trashItem) => {
  const { original_table, data } = trashItem;
  if (db[original_table]) {
    await db[original_table].put(data);
  }
  await db.trash.delete(trashItem.id);
};

db.open().catch(async (err) => {
  if (err.name === 'UpgradeError' || err.name === 'VersionError') {
    console.warn('Detected local database schema conflict. Rebuilding database...', err);
    await db.delete();
    window.location.reload();
  }
});
