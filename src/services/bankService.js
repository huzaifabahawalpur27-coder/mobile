import { supabase } from './supabase';
import { db, addToSyncQueue } from './db';
import { newOpId, isMissingFunction } from './atomicOps';
import { roundMoney, isCountedSale, netAmount, paidAmount, isCashName, isCashAccount } from '../utils/moneyMath';

const getClient = () => {
  return supabase;
};

/**
 * Fetch all bank accounts for a specific shop.
 * Falls back to local Dexie cache if network is unavailable.
 */
export const getBankAccounts = async (shopId) => {
  if (!shopId) return [];

  const numericShopId = !isNaN(Number(shopId)) ? Number(shopId) : shopId;

  // Try Supabase first if online
  if (navigator.onLine) {
    try {
      const client = getClient();
      const { data, error } = await client
        .from('bank_accounts')
        .select('*')
        .eq('shop_id', numericShopId)
        .order('is_default', { ascending: false })
        .order('account_name', { ascending: true });

      if (!error && data) {
        // Sync into Dexie cache
        try {
          if (data.length > 0) {
            await db.bank_accounts.bulkPut(data);
          }
        } catch (dexieErr) {
          console.warn('Dexie bank_accounts cache warning:', dexieErr);
        }
        return data.map(normalizeAccount);
      }
    } catch (err) {
      console.warn('Supabase getBankAccounts failed, falling back to local Dexie cache:', err);
    }
  }

  // Fallback to Dexie (robust type matching)
  try {
    const all = await db.bank_accounts.toArray();
    const local = all.filter(a => String(a.shop_id) === String(shopId));
    return local
      .sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0))
      .map(normalizeAccount);
  } catch (err) {
    console.error('Error fetching bank accounts from Dexie:', err);
    return [];
  }
};

/**
 * Normalizes account numbers and balances to numbers.
 */
const normalizeAccount = (acc) => ({
  ...acc,
  current_balance: Number(acc.current_balance || 0),
  opening_balance: Number(acc.opening_balance || 0),
  is_default: Boolean(acc.is_default)
});

/**
 * Normalizes transaction values (numbers and transaction_type).
 */
const normalizeTransaction = (tx) => {
  const rawType = String(tx.transaction_type || '').toLowerCase();
  const isCredit = rawType === 'credit' || rawType === 'deposit';
  return {
    ...tx,
    transaction_type: isCredit ? 'CREDIT' : 'DEBIT',
    amount: Number(tx.amount || 0),
    balance_before: Number(tx.balance_before || 0),
    balance_after: Number(tx.balance_after || 0)
  };
};

/**
 * Create a new bank account for a shop.
 */
export const createBankAccount = async (accountData) => {
  const shopId = accountData.shop_id;
  const openingBalance = Number(accountData.opening_balance || 0);

  const payload = {
    shop_id: shopId,
    account_name: accountData.account_name?.trim() || 'Main Bank',
    bank_name: accountData.bank_name?.trim() || '',
    account_number: accountData.account_number?.trim() || '',
    current_balance: openingBalance,
    opening_balance: openingBalance,
    is_default: Boolean(accountData.is_default),
    status: (accountData.status || 'active').toLowerCase(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  // If this is set as default, unset other default accounts for this shop
  if (payload.is_default) {
    await unsetOtherDefaults(shopId);
  }

  let createdAccount = null;

  if (navigator.onLine) {
    try {
      const client = getClient();
      const { data, error } = await client
        .from('bank_accounts')
        .insert(payload)
        .select()
        .single();

      if (!error && data) {
        createdAccount = normalizeAccount(data);
        await db.bank_accounts.put(createdAccount);

        // Record opening transaction if opening balance > 0
        if (openingBalance > 0) {
          await recordBankTransaction({
            shopId,
            accountId: data.id,
            transactionType: 'CREDIT',
            amount: openingBalance,
            balanceBefore: 0,
            balanceAfter: openingBalance,
            referenceType: 'OPENING_BALANCE',
            referenceId: String(data.id),
            description: `Initial opening balance deposit for ${payload.account_name}`
          });
        }
        return createdAccount;
      } else if (error) {
        console.warn('Error inserting bank_account to Supabase:', error);
      }
    } catch (err) {
      console.warn('Network error inserting bank account:', err);
    }
  }

  // Offline / local fallback
  const localId = `temp-${Date.now()}`;
  const localAccount = {
    ...payload,
    id: localId
  };
  await db.bank_accounts.put(localAccount);
  await addToSyncQueue('bank_accounts', 'INSERT', localAccount);

  return normalizeAccount(localAccount);
};

/**
 * Unsets is_default for other accounts in shop.
 */
const unsetOtherDefaults = async (shopId) => {
  try {
    const client = getClient();
    await client
      .from('bank_accounts')
      .update({ is_default: false })
      .eq('shop_id', shopId);
  } catch (err) {
    console.warn('Failed unsetting remote default accounts:', err);
  }
};

const NETWORK_RE = /fetch|network|load failed|timeout|err_name_not_resolved|connection/i;
const isNetworkError = (err) => NETWORK_RE.test(`${err?.message || ''} ${err?.details || ''}`);
const isServerId = (id) => /^\d+$/.test(String(id ?? ''));
const dexieKey = (id) => (isServerId(id) ? Number(id) : id);

const readLocalAccount = async (accountId) => {
  try {
    return (await db.bank_accounts.get(dexieKey(accountId))) ?? (await db.bank_accounts.get(String(accountId))) ?? null;
  } catch {
    return null;
  }
};

const writeLocalBalance = async (accountId, balance) => {
  try {
    const local = await readLocalAccount(accountId);
    if (local) {
      await db.bank_accounts.update(local.id, { current_balance: balance, updated_at: new Date().toISOString() });
    }
  } catch (dexieErr) {
    console.warn('Failed to update Dexie bank_accounts:', dexieErr);
  }
};

/**
 * Old behaviour, used only where sql/atomic_bank_balance.sql has not been run: read the
 * server's balance, write the new one, then add the statement entry.
 */
export const legacyBankDelta = async ({ shopId, accountId, delta, referenceType, referenceId, description }) => {
  const client = getClient();
  const { data: account, error } = await client.from('bank_accounts').select('*').eq('id', accountId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!account) return { ok: false, error: `Account ${accountId} not found in this shop` };
  const balanceBefore = Number(account.current_balance || 0);
  const balanceAfter = roundMoney(balanceBefore + delta);
  const { error: upErr } = await client
    .from('bank_accounts')
    .update({ current_balance: balanceAfter, updated_at: new Date().toISOString() })
    .eq('id', accountId);
  if (upErr) return { ok: false, error: upErr.message };
  await writeLocalBalance(accountId, balanceAfter);
  await recordBankTransaction({
    shopId: shopId || account.shop_id,
    accountId,
    transactionType: delta > 0 ? 'CREDIT' : 'DEBIT',
    amount: Math.abs(delta),
    balanceBefore,
    balanceAfter,
    referenceType,
    referenceId,
    description
  });
  return { ok: true, legacy: true, balanceBefore, balanceAfter };
};

/**
 * Moves an account balance by a signed amount (+ money in, - money out) and writes the
 * statement entry.
 *
 * Online: one database call (sql/atomic_bank_balance.sql) adds the amount to the
 * balance the server holds, so two devices or two quick payments cannot overwrite each
 * other. Offline (or when the connection drops): this device's copy is updated and the
 * same call is queued with a unique id; it is applied once when the connection returns.
 */
const applyBankDelta = async ({ shopId, accountId, delta, referenceType, referenceId = null, description = '' }) => {
  const change = roundMoney(delta);
  if (!accountId || !change) return null;

  const args = {
    p_account_id: isServerId(accountId) ? Number(accountId) : accountId,
    p_delta: change,
    p_reference_type: String(referenceType || 'manual').toLowerCase(),
    p_reference_id: referenceId ? String(referenceId) : null,
    p_description: description || null,
    p_op_id: newOpId()
  };
  const online = !(typeof navigator !== 'undefined' && navigator.onLine === false);

  if (online && isServerId(accountId)) {
    let failure = null;
    try {
      const { data, error } = await getClient().rpc('adjust_bank_balance', args);
      if (!error && data && data.success !== false) {
        const balanceAfter = Number(data.balance_after ?? 0);
        const balanceBefore = Number(data.balance_before ?? roundMoney(balanceAfter - change));
        await writeLocalBalance(accountId, balanceAfter);
        if (data.transaction) {
          try { await db.bank_account_transactions.put(data.transaction); } catch { /* cache only */ }
        }
        return { accountId, balanceBefore, balanceAfter };
      }
      failure = error || { message: data?.error || 'Rejected by server' };
    } catch (err) {
      failure = err;
    }

    if (isMissingFunction(failure)) {
      console.warn('adjust_bank_balance is not installed yet (run sql/atomic_bank_balance.sql); using the old write.');
      const legacy = await legacyBankDelta({ shopId, accountId, delta: change, referenceType, referenceId, description });
      if (legacy.ok) return { accountId, balanceBefore: legacy.balanceBefore, balanceAfter: legacy.balanceAfter };
      if (!isNetworkError({ message: legacy.error })) throw new Error(legacy.error || 'Could not update the account balance');
    } else if (!isNetworkError(failure)) {
      // Refused by the server (account deleted, no session...): nothing was changed
      throw new Error(failure?.message || 'Could not update the account balance');
    }
    // Network problem: the server may or may not have applied it. Queue the same call;
    // its op id stops it being applied twice.
  }

  // Offline / queued: update this device's copy and keep a local statement entry
  const local = await readLocalAccount(accountId);
  const balanceBefore = Number(local?.current_balance || 0);
  const balanceAfter = roundMoney(balanceBefore + change);
  await writeLocalBalance(accountId, balanceAfter);

  const localTx = {
    id: `temp-${args.p_op_id}`,
    shop_id: Number(shopId) || shopId,
    account_id: args.p_account_id,
    transaction_type: change > 0 ? 'deposit' : 'withdrawal',
    amount: Math.abs(change),
    balance_before: balanceBefore,
    balance_after: balanceAfter,
    reference_type: args.p_reference_type,
    reference_id: args.p_reference_id,
    description: args.p_description,
    created_at: new Date().toISOString(),
    pending_sync: true
  };
  try {
    await db.bank_account_transactions.put(localTx);
  } catch (dexieErr) {
    console.warn('Dexie bank transaction cache warning:', dexieErr);
  }

  if (isServerId(accountId)) {
    await addToSyncQueue('rpc', 'RPC', { fn: 'adjust_bank_balance', args });
  } else {
    // Account itself was created offline and has no server id yet: keep the entry in the
    // ordinary queue so it is not lost.
    await addToSyncQueue('bank_account_transactions', 'INSERT', { ...localTx, pending_sync: undefined });
  }
  return { accountId, balanceBefore, balanceAfter, queued: true };
};

/**
 * Deduct an amount from a bank account (e.g. for phone or product purchase payment).
 */
export const deductBankBalance = async ({
  shopId,
  accountId,
  amount,
  purchaseId = null,
  referenceType = null,
  referenceId = null,
  description = ''
}) => {
  const deductAmount = roundMoney(Math.abs(Number(amount || 0)));
  if (!accountId || deductAmount <= 0) return null;

  const result = await applyBankDelta({
    shopId,
    accountId,
    delta: -deductAmount,
    referenceType: referenceType || (purchaseId ? 'PURCHASE' : 'EXPENSE'),
    referenceId: referenceId ? String(referenceId) : (purchaseId ? String(purchaseId) : null),
    description: description || `Payment deduction (${purchaseId ? `Purchase #${purchaseId}` : 'Expense'})`
  });
  return result ? { ...result, deducted: deductAmount } : null;
};

/**
 * Credit an amount back to a bank account (e.g. purchase return or deposit).
 */
export const creditBankBalance = async ({
  shopId,
  accountId,
  amount,
  referenceType = 'DEPOSIT',
  referenceId = null,
  description = ''
}) => {
  const creditAmount = roundMoney(Math.abs(Number(amount || 0)));
  if (!accountId || creditAmount <= 0) return null;

  const result = await applyBankDelta({
    shopId,
    accountId,
    delta: creditAmount,
    referenceType,
    referenceId: referenceId ? String(referenceId) : null,
    description
  });
  return result ? { ...result, credited: creditAmount } : null;
};

/**
 * Record a transaction into bank_account_transactions.
 */
export const recordBankTransaction = async ({
  shopId,
  accountId,
  transactionType,
  amount,
  balanceBefore,
  balanceAfter,
  referenceType,
  referenceId = null,
  description = ''
}) => {
  const normTxType = String(transactionType || '').toLowerCase();
  const dbTransactionType = (normTxType === 'credit' || normTxType === 'deposit') ? 'deposit' : 'withdrawal';

  const record = {
    shop_id: Number(shopId) || shopId,
    account_id: Number(accountId) || accountId,
    transaction_type: dbTransactionType,
    amount: Number(amount || 0),
    balance_before: Number(balanceBefore || 0),
    balance_after: Number(balanceAfter || 0),
    reference_type: String(referenceType || 'manual').toLowerCase(),
    reference_id: referenceId ? String(referenceId) : null,
    description: description || null,
    created_at: new Date().toISOString()
  };

  if (navigator.onLine) {
    try {
      const client = getClient();
      const { data, error } = await client
        .from('bank_account_transactions')
        .insert(record)
        .select()
        .single();

      if (!error && data) {
        try {
          await db.bank_account_transactions.put(data);
        } catch {
          // Ignore dexie write error
        }
        return data;
      }
    } catch (err) {
      console.warn('Failed recording bank transaction to Supabase:', err);
    }
  }

  // Offline / Dexie fallback
  const localRecord = { ...record, id: `temp-${Date.now()}` };
  try {
    await db.bank_account_transactions.put(localRecord);
    await addToSyncQueue('bank_account_transactions', 'INSERT', localRecord);
  } catch (dexieErr) {
    console.warn('Dexie queue warning:', dexieErr);
  }
  return localRecord;
};

/**
 * Fetch transaction history for a bank account.
 */
export const getAccountTransactions = async (accountId, shopId, limit = 50) => {
  if (!accountId) return [];

  if (navigator.onLine) {
    try {
      const client = getClient();
      let query = client
        .from('bank_account_transactions')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (shopId) {
        query = query.eq('shop_id', shopId);
      }

      const { data, error } = await query;
      if (!error && data) {
        return data.map(normalizeTransaction);
      }
    } catch (err) {
      console.warn('Error fetching account transactions from Supabase:', err);
    }
  }

  // Local fallback
  try {
    const list = await db.bank_account_transactions
      .where('account_id')
      .equals(Number(accountId))
      .reverse()
      .sortBy('created_at');
    return list.slice(0, limit).map(normalizeTransaction);
  } catch (err) {
    console.error('Dexie getAccountTransactions failed:', err);
    return [];
  }
};

/**
 * Entries made offline are kept on this device until the queued change reaches the
 * server, which then returns the real entry. Once nothing is waiting, drop the local
 * placeholders so the offline list does not show them twice.
 */
const dropSyncedLocalEntries = async () => {
  const waiting = await db.sync_queue
    .filter(q => q.action === 'RPC' && q.data?.fn === 'adjust_bank_balance')
    .count();
  if (waiting > 0) return;
  const placeholders = await db.bank_account_transactions.filter(t => t.pending_sync === true).primaryKeys();
  if (placeholders.length) await db.bank_account_transactions.bulkDelete(placeholders);
};

/**
 * Fetch all bank transactions for a whole shop.
 */
export const getAllBankTransactions = async (shopId, limit = 100) => {
  if (!shopId) return [];

  if (navigator.onLine) {
    try {
      const client = getClient();
      const { data, error } = await client
        .from('bank_account_transactions')
        .select('*')
        .eq('shop_id', Number(shopId) || shopId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!error && data) {
        try {
          if (data.length > 0) {
            await db.bank_account_transactions.bulkPut(data.map(normalizeTransaction));
          }
          await dropSyncedLocalEntries();
        } catch {
          // ignore cache error
        }
        return data.map(normalizeTransaction);
      }
    } catch (err) {
      console.warn('getAllBankTransactions Supabase warning:', err);
    }
  }

  try {
    const all = await db.bank_account_transactions.toArray();
    return all
      .filter(tx => String(tx.shop_id) === String(shopId))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, limit)
      .map(normalizeTransaction);
  } catch (err) {
    console.error('getAllBankTransactions Dexie error:', err);
    return [];
  }
};

/**
 * Correct a mistaken bank / cash entry (sql/edit_bank_transaction.sql). The database
 * changes the account balance by the difference only, moves the entry to another
 * account if asked, keeps later running balances consistent and notes the original
 * values with the reason. Needs a connection; transfers cannot be edited.
 */
export const editBankTransaction = async ({ transactionId, amount, direction, accountId = null, description = '', reason }) => {
  if (!navigator.onLine) throw new Error('Connect to the internet to correct a transaction.');
  if (!/^\d+$/.test(String(transactionId ?? ''))) {
    throw new Error('This entry has not synced to the server yet. Try again after it syncs.');
  }
  const { data, error } = await getClient().rpc('edit_bank_transaction', {
    p_tx_id: Number(transactionId),
    p_amount: Number(amount),
    p_direction: direction,
    p_account_id: accountId ? Number(accountId) : null,
    p_description: description?.trim() || null,
    p_reason: reason?.trim() || null
  });
  if (error) {
    if (error.code === 'PGRST202' || /could not find the function/i.test(error.message || '')) {
      throw new Error('Editing is not set up yet: run sql/edit_bank_transaction.sql in Supabase.');
    }
    throw new Error(error.message || 'Could not correct the transaction');
  }
  // Refresh this device's copy of the affected accounts
  try {
    const ids = [data?.account_id, data?.previous_account_id].filter(Boolean);
    if (ids.length) {
      const { data: accs } = await getClient().from('bank_accounts').select('*').in('id', ids);
      if (accs?.length) await db.bank_accounts.bulkPut(accs);
    }
  } catch {
    // cache refresh only
  }
  return data;
};

/**
 * Update an existing bank account.
 */
export const updateBankAccount = async (id, accountData) => {
  if (!id) return null;
  const numId = Number(id);

  const updates = {
    ...accountData,
    updated_at: new Date().toISOString()
  };

  if (updates.current_balance !== undefined) {
    updates.current_balance = Number(updates.current_balance || 0);
  }

  if (updates.is_default && accountData.shop_id) {
    await unsetOtherDefaults(accountData.shop_id);
  }

  if (navigator.onLine) {
    try {
      const client = getClient();
      await client
        .from('bank_accounts')
        .update(updates)
        .eq('id', numId);
    } catch (err) {
      console.warn('Supabase updateBankAccount warning:', err);
    }
  }

  try {
    await db.bank_accounts.update(numId, updates);
    await addToSyncQueue('bank_accounts', 'UPDATE', { id: numId, ...updates });
  } catch (dexieErr) {
    console.warn('Dexie updateBankAccount warning:', dexieErr);
  }

  return { id: numId, ...updates };
};

/**
 * Delete / Archive a bank account.
 */
export const deleteBankAccount = async (id, shopId) => {
  if (!id) return false;
  const numId = Number(id);

  if (navigator.onLine) {
    try {
      const client = getClient();
      await client
        .from('bank_accounts')
        .delete()
        .eq('id', numId);
    } catch (err) {
      console.warn('Supabase deleteBankAccount warning:', err);
    }
  }

  try {
    await db.bank_accounts.delete(numId);
    await addToSyncQueue('bank_accounts', 'DELETE', { id: numId, shop_id: shopId });
    return true;
  } catch (dexieErr) {
    console.warn('Dexie deleteBankAccount warning:', dexieErr);
    return false;
  }
};

/**
 * Record a manual Deposit, Withdrawal, or Balance Adjustment.
 */
export const adjustBankBalance = async ({
  shopId,
  accountId,
  type = 'DEPOSIT', // 'DEPOSIT' | 'WITHDRAWAL' | 'ADJUSTMENT'
  amount,
  notes = ''
}) => {
  const numericAmount = roundMoney(Math.abs(Number(amount || 0)));
  if (!accountId || (type !== 'ADJUSTMENT' && numericAmount <= 0)) {
    throw new Error('Please enter a valid amount greater than 0.');
  }

  let delta = type === 'WITHDRAWAL' ? -numericAmount : numericAmount;
  if (type === 'ADJUSTMENT') {
    // Setting a target balance: the change is measured from the latest balance
    const account = await fetchFreshAccount(accountId);
    if (!account) throw new Error('Bank account not found.');
    delta = roundMoney(Number(amount || 0) - Number(account.current_balance || 0));
    if (delta === 0) {
      const same = Number(account.current_balance || 0);
      return { accountId, balanceBefore: same, balanceAfter: same, difference: 0 };
    }
  }

  // The amount is added to (or taken from) the balance the server holds, never
  // written as an absolute number from this screen's copy.
  const result = await applyBankDelta({
    shopId,
    accountId,
    delta,
    referenceType: type,
    referenceId: `MANUAL-${Date.now()}`,
    description: notes || `Manual ${type.toLowerCase()} of Rs. ${Math.abs(delta).toLocaleString()}`
  });
  if (!result) throw new Error('Bank account not found.');

  return {
    accountId,
    balanceBefore: result.balanceBefore,
    balanceAfter: result.balanceAfter,
    difference: roundMoney(result.balanceAfter - result.balanceBefore)
  };
};

/** Latest copy of an account: the server's when online, this device's otherwise. */
const fetchFreshAccount = async (accountId) => {
  if (navigator.onLine && isServerId(accountId)) {
    try {
      const { data } = await getClient().from('bank_accounts').select('*').eq('id', Number(accountId)).maybeSingle();
      if (data) return data;
    } catch (err) {
      console.warn('fetchFreshAccount warning:', err);
    }
  }
  return readLocalAccount(accountId);
};

/**
 * Transfer funds between two bank accounts.
 */
export const transferBetweenAccounts = async ({
  shopId,
  fromAccountId,
  toAccountId,
  amount,
  description = ''
}) => {
  const transferAmount = roundMoney(Math.abs(Number(amount || 0)));
  if (transferAmount <= 0) throw new Error('Transfer amount must be greater than 0');
  if (String(fromAccountId) === String(toAccountId)) throw new Error('Source and destination accounts must be different');

  const fromAccId = dexieKey(fromAccountId);
  const toAccId = dexieKey(toAccountId);

  // Check the source balance against the latest copy, not this screen's
  const sourceAcc = await fetchFreshAccount(fromAccId);
  const currentSrcBal = Number(sourceAcc?.current_balance || 0);
  if (currentSrcBal < transferAmount) {
    throw new Error(`Insufficient balance in "${sourceAcc?.account_name || 'Source Account'}". Current balance: Rs. ${currentSrcBal.toLocaleString()}, Requested: Rs. ${transferAmount.toLocaleString()}`);
  }

  // Both entries are typed TRANSFER and share one reference, so neither side can be
  // edited on its own later (which would make the two accounts disagree).
  const transferRef = `TRF-${Date.now()}`;

  // 1. Deduct from source
  await deductBankBalance({
    shopId,
    accountId: fromAccId,
    amount: transferAmount,
    referenceType: 'TRANSFER',
    referenceId: transferRef,
    description: `Transfer OUT to Account #${toAccId}: ${description || 'Internal Transfer'}`
  });

  // 2. Credit to destination with automatic rollback if failed
  try {
    const credited = await creditBankBalance({
      shopId,
      accountId: toAccId,
      amount: transferAmount,
      referenceType: 'TRANSFER',
      referenceId: transferRef,
      description: `Transfer IN from Account #${fromAccId}: ${description || 'Internal Transfer'}`
    });
    if (!credited) throw new Error('Destination account not credited');
  } catch (creditErr) {
    console.error('Destination credit failed during transfer, rolling back source deduction:', creditErr);
    await creditBankBalance({
      shopId,
      accountId: fromAccId,
      amount: transferAmount,
      referenceType: 'TRANSFER_ROLLBACK',
      referenceId: transferRef,
      description: `Rollback Transfer to #${toAccId} (Credit Failed)`
    });
    throw new Error('Transfer failed while crediting destination account. Funds have been returned safely to the source account.');
  }

  return { success: true, amount: transferAmount };
};

/**
 * Find or auto-create an account for receiving POS sales.
 * Handles:
 * - 'cash': finds or creates 'Cash in Hand' (bank_name: 'Cash')
 * - Bank / Provider (e.g. 'hbl', 'meezan', 'jazzcash', 'easypaisa', 'bank', etc.):
 *   searches for existing account matching the provider name, or default bank, or auto-creates one.
 */
export const findOrCreateAccountForPayment = async ({
  shopId,
  method = 'cash',
  provider = null,
  accounts = []
}) => {
  let list = accounts;
  if (!list || list.length === 0) {
    list = await getBankAccounts(shopId);
  }

  const cleanMethod = (method || 'cash').toLowerCase().trim();
  const cleanProvider = (provider || '').toLowerCase().trim();
  const targetKey = cleanProvider || cleanMethod;

  // 1. CASH
  if (cleanMethod === 'cash' || targetKey === 'cash') {
    const existingCash = list.find(a => 
      isCashName(a.bank_name) || 
      isCashName(a.account_name)
    );
    if (existingCash) return existingCash;

    // Create Cash account
    const newCash = await createBankAccount({
      shop_id: shopId,
      account_name: 'Cash in Hand',
      bank_name: 'Cash',
      account_number: 'CASH',
      opening_balance: 0,
      is_default: list.length === 0,
      status: 'active'
    });
    return newCash;
  }

  // 2. BANK / ONLINE / SPECIFIC PROVIDER
  const PROVIDER_NAMES = {
    hbl: { name: 'HBL Business Account', bank: 'Habib Bank Limited (HBL)' },
    meezan: { name: 'Meezan Bank Account', bank: 'Meezan Bank' },
    ubl: { name: 'UBL Account', bank: 'United Bank Limited (UBL)' },
    mcb: { name: 'MCB Bank Account', bank: 'MCB Bank' },
    abl: { name: 'Allied Bank Account', bank: 'Allied Bank Limited (ABL)' },
    alfalah: { name: 'Bank Alfalah Account', bank: 'Bank Alfalah' },
    faysal: { name: 'Faysal Bank Account', bank: 'Faysal Bank' },
    bop: { name: 'Bank of Punjab Account', bank: 'Bank of Punjab (BOP)' },
    askari: { name: 'Askari Bank Account', bank: 'Askari Bank' },
    jazzcash: { name: 'JazzCash Wallet', bank: 'JazzCash' },
    easypaisa: { name: 'Easypaisa Wallet', bank: 'EasyPaisa' },
    sadapay: { name: 'SadaPay Account', bank: 'SadaPay' },
    nayapay: { name: 'NayaPay Account', bank: 'NayaPay' },
    other_bank: { name: 'Bank Transfer / Raast', bank: 'Bank Transfer' }
  };

  const info = PROVIDER_NAMES[targetKey] || {
    name: `${targetKey.toUpperCase()} Account`,
    bank: targetKey.toUpperCase()
  };

  // Search by keyword in existing accounts
  const matched = list.find(a => {
    const name = (a.account_name || '').toLowerCase();
    const bank = (a.bank_name || '').toLowerCase();
    return name.includes(targetKey) || bank.includes(targetKey) || (cleanProvider && (name.includes(cleanProvider) || bank.includes(cleanProvider)));
  });

  if (matched) return matched;

  // If no direct keyword match, check if there's a non-cash default or single bank account
  const nonCashAccounts = list.filter(a => 
    !isCashName(a.bank_name) && 
    !isCashName(a.account_name)
  );

  // If only one non-cash bank account exists and payment method is generic 'bank' or 'online', use it
  if (nonCashAccounts.length === 1 && (targetKey === 'bank' || targetKey === 'online' || targetKey === 'other_bank')) {
    return nonCashAccounts[0];
  }

  // Otherwise, create an account for this provider
  const newBankAcc = await createBankAccount({
    shop_id: shopId,
    account_name: info.name,
    bank_name: info.bank,
    account_number: targetKey.toUpperCase(),
    opening_balance: 0,
    is_default: false,
    status: 'active'
  });

  return newBankAcc;
};

/**
 * Automatically credits sale amount into the appropriate Cash or Bank account.
 * Supports:
 * - Single payment (cash, online/bank, partial paid)
 * - Split payments (multiple tenders with respective amounts)
 */
export const recordSaleToAccounts = async ({
  shopId,
  saleId,
  paymentType,
  paymentMethod,
  paymentDetails = [],
  totalPaid = 0,
  description = '',
  accountId = null
}) => {
  const paid = Number(totalPaid || 0);
  if (!shopId || paid <= 0) return null;

  try {
    // 1. Fetch current accounts
    let accounts = await getBankAccounts(shopId);

    // 2. Check if split payments
    if (paymentDetails && Array.isArray(paymentDetails) && paymentDetails.length > 0) {
      const results = [];
      for (const tender of paymentDetails) {
        const tenderAmount = Number(tender.amount || 0);
        if (tenderAmount <= 0) continue;

        const tenderMethod = (tender.method || paymentType || 'cash').toLowerCase();
        if (tenderMethod === 'credit') continue;

        const tenderProvider = (tender.provider || (tenderMethod !== 'cash' ? tenderMethod : null));
        const tenderAccId = tender.account_id || tender.accountId;

        let targetAccount = null;
        if (tenderAccId) {
          targetAccount = accounts.find(a => String(a.id) === String(tenderAccId));
        }
        if (!targetAccount) {
          targetAccount = await findOrCreateAccountForPayment({
            shopId,
            method: tenderMethod,
            provider: tenderProvider,
            accounts
          });
        }

        if (targetAccount) {
          const txDesc = description || `POS Sale #${saleId} (${targetAccount.bank_name ? `${targetAccount.bank_name} - ` : ''}${targetAccount.account_name})`;
          await creditBankBalance({
            shopId,
            accountId: targetAccount.id,
            amount: tenderAmount,
            referenceType: 'sale',
            referenceId: String(saleId),
            description: txDesc
          });
          results.push({ accountId: targetAccount.id, amount: tenderAmount });
          // refresh accounts cache for next item in case balance changed
          accounts = await getBankAccounts(shopId);
        }
      }
      return results;
    }

    // 3. Single payment method
    const method = (paymentMethod || paymentType || 'cash').toLowerCase();
    if (method === 'credit') return null; // Unpaid credit balance

    let targetAccount = null;
    if (accountId) {
      targetAccount = accounts.find(a => String(a.id) === String(accountId));
    }
    if (!targetAccount) {
      targetAccount = await findOrCreateAccountForPayment({
        shopId,
        method,
        provider: method !== 'cash' ? method : null,
        accounts
      });
    }

    if (targetAccount) {
      const txDesc = description || `POS Sale #${saleId} (${targetAccount.bank_name ? `${targetAccount.bank_name} - ` : ''}${targetAccount.account_name})`;
      await creditBankBalance({
        shopId,
        accountId: targetAccount.id,
        amount: paid,
        referenceType: 'sale',
        referenceId: String(saleId),
        description: txDesc
      });
      return [{ accountId: targetAccount.id, amount: paid }];
    }
  } catch (err) {
    console.error('Error auto-crediting sale to accounts:', err);
  }
  return null;
};

/**
 * Automatically deducts purchase amounts from the appropriate Cash or Bank account.
 * Supports:
 * - Single payment (cash, bank, partial paid)
 * - Split payments (multiple tenders across cash vaults, banks, fintech wallets)
 */
export const recordPurchaseToAccounts = async ({
  shopId,
  purchaseId,
  paymentType,
  paymentMethod,
  paymentDetails = [],
  totalPaid = 0,
  description = '',
  accountId = null
}) => {
  const paid = Number(totalPaid || 0);
  if (!shopId || paid <= 0) return null;

  try {
    let accounts = await getBankAccounts(shopId);

    // 1. Split payments handling
    if (paymentDetails && Array.isArray(paymentDetails) && paymentDetails.length > 0) {
      const results = [];
      for (const tender of paymentDetails) {
        const tenderAmount = Number(tender.amount || 0);
        if (tenderAmount <= 0) continue;

        const tenderMethod = (tender.method || paymentType || 'cash').toLowerCase();
        if (tenderMethod === 'credit') continue; // Credit is liability with supplier, not account outflow

        const tenderProvider = tender.provider || (tenderMethod !== 'cash' ? tenderMethod : null);
        const tenderAccId = tender.account_id || tender.accountId;

        let targetAccount = null;
        if (tenderAccId) {
          targetAccount = accounts.find(a => String(a.id) === String(tenderAccId));
        }
        if (!targetAccount) {
          targetAccount = await findOrCreateAccountForPayment({
            shopId,
            method: tenderMethod,
            provider: tenderProvider,
            accounts
          });
        }

        if (targetAccount) {
          const refStr = tender.ref ? ` • Ref: ${tender.ref}` : '';
          const txDesc = description || `Purchase PR-${String(purchaseId).slice(-6)} (${targetAccount.bank_name ? `${targetAccount.bank_name} - ` : ''}${targetAccount.account_name}${refStr})`;
          await deductBankBalance({
            shopId,
            accountId: targetAccount.id,
            amount: tenderAmount,
            purchaseId: purchaseId,
            referenceType: 'PURCHASE',
            referenceId: String(purchaseId),
            description: txDesc
          });
          results.push({ accountId: targetAccount.id, amount: tenderAmount });
          // refresh accounts cache in case of multiple deductions from same account
          accounts = await getBankAccounts(shopId);
        }
      }
      return results;
    }

    // 2. Single payment method deduction
    const method = (paymentMethod || paymentType || 'cash').toLowerCase();
    if (method === 'credit') return null;

    let targetAccount = null;
    if (accountId) {
      targetAccount = accounts.find(a => String(a.id) === String(accountId));
    }
    if (!targetAccount) {
      targetAccount = await findOrCreateAccountForPayment({
        shopId,
        method,
        provider: method !== 'cash' ? method : null,
        accounts
      });
    }

    if (targetAccount) {
      const txDesc = description || `Purchase PR-${String(purchaseId).slice(-6)} (${targetAccount.bank_name ? `${targetAccount.bank_name} - ` : ''}${targetAccount.account_name})`;
      await deductBankBalance({
        shopId,
        accountId: targetAccount.id,
        amount: paid,
        purchaseId: purchaseId,
        referenceType: 'PURCHASE',
        referenceId: String(purchaseId),
        description: txDesc
      });
      return [{ accountId: targetAccount.id, amount: paid }];
    }
  } catch (err) {
    console.error('Error auto-deducting purchase from accounts:', err);
  }
  return null;
};




/**
 * Takes a deleted sale's money back out of the accounts it went into.
 *
 * Works from the statement first (entries referenced to this sale), so a split
 * payment, the cash received on a credit sale and an account chosen at the till are
 * each reversed on the right account. Falls back to the sale's tender list, then to
 * its payment method. Never reverses more than is still recorded as paid on the sale.
 * Returns the list of { accountId, amount } reversed.
 */
export const reverseSaleFromAccounts = async ({ shopId, sale, description = '' }) => {
  if (!sale || !isCountedSale(sale)) return [];
  const method = String(sale.payment_type || sale.payment_method || 'cash').toLowerCase();
  const net = netAmount(sale);
  let remaining = sale.paid_amount != null || sale.amount_paid != null
    ? paidAmount(sale)
    : (method === 'cash' ? net : 0);
  remaining = Math.max(0, roundMoney(remaining));
  if (!shopId || remaining <= 0) return [];

  const accounts = await getBankAccounts(shopId);
  if (!accounts.length) return [];
  const desc = description || `Sale Deletion Reversal (Invoice #${sale.id})`;

  // 1. What the statement says this sale put into each account
  const perAccount = new Map();
  const saleRef = String(sale.id);
  let entries = [];
  try {
    if (navigator.onLine) {
      const { data } = await getClient()
        .from('bank_account_transactions')
        .select('account_id, transaction_type, amount, reference_type')
        .eq('shop_id', Number(shopId) || shopId)
        .eq('reference_id', saleRef)
        .in('reference_type', ['sale', 'sale_return']);
      entries = data || [];
    } else {
      const local = await db.bank_account_transactions.where('reference_id').equals(saleRef).toArray();
      entries = local.filter(t => ['sale', 'sale_return'].includes(String(t.reference_type || '').toLowerCase()));
    }
  } catch (err) {
    console.warn('reverseSaleFromAccounts: statement lookup failed, using the sale tenders:', err);
  }
  for (const t of entries) {
    const type = String(t.transaction_type || '').toLowerCase();
    const signed = (type === 'deposit' || type === 'credit') ? Number(t.amount || 0) : -Number(t.amount || 0);
    perAccount.set(String(t.account_id), roundMoney((perAccount.get(String(t.account_id)) || 0) + signed));
  }

  // 2. No statement entries: use the tender list saved on the sale
  if (perAccount.size === 0 && Array.isArray(sale.payment_details)) {
    for (const tender of sale.payment_details) {
      const amount = Number(tender?.amount || 0);
      const tMethod = String(tender?.method || '').toLowerCase();
      if (amount <= 0 || tMethod === 'credit') continue;
      const accId = tender.account_id || tender.accountId;
      let acc = accId ? accounts.find(a => String(a.id) === String(accId)) : null;
      if (!acc) {
        acc = tMethod === 'cash'
          ? accounts.find(isCashAccount)
          : (accounts.find(a => !isCashAccount(a) && [a.bank_name, a.account_name].some(n => String(n || '').toLowerCase().includes(String(tender.provider || tMethod).toLowerCase())))
            || accounts.find(a => !isCashAccount(a)));
      }
      if (acc) perAccount.set(String(acc.id), roundMoney((perAccount.get(String(acc.id)) || 0) + amount));
    }
  }

  // 3. Still nothing: decide from the payment method
  if (perAccount.size === 0) {
    const isBank = !['cash', 'credit', 'split'].includes(method);
    const acc = accounts.find(a => (isBank ? !isCashAccount(a) : isCashAccount(a))) || accounts[0];
    if (acc) perAccount.set(String(acc.id), remaining);
  }

  const reversed = [];
  for (const [accId, amount] of perAccount) {
    if (remaining <= 0) break;
    if (!accounts.some(a => String(a.id) === accId)) continue; // account deleted since
    const take = roundMoney(Math.min(remaining, amount));
    if (take <= 0) continue;
    await deductBankBalance({
      shopId,
      accountId: accId,
      amount: take,
      referenceType: 'SALE_DELETION',
      referenceId: saleRef,
      description: desc
    });
    remaining = roundMoney(remaining - take);
    reversed.push({ accountId: accId, amount: take });
  }
  return reversed;
};

/**
 * Statement entries for a date range (inclusive, local dates 'YYYY-MM-DD'), optionally
 * for one account and one direction ('in' | 'out'). Oldest first.
 */
export const getBankStatement = async ({ shopId, accountId = null, from = null, to = null, direction = null, limit = 2000 }) => {
  if (!shopId) return [];
  const startIso = from ? new Date(`${from}T00:00:00`).toISOString() : null;
  const endIso = to ? new Date(`${to}T23:59:59.999`).toISOString() : null;
  const wantIn = direction === 'in';
  const matchesDirection = (tx) => !direction || (tx.transaction_type === 'CREDIT') === wantIn;

  if (navigator.onLine) {
    try {
      let query = getClient()
        .from('bank_account_transactions')
        .select('*')
        .eq('shop_id', Number(shopId) || shopId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit);
      if (accountId) query = query.eq('account_id', Number(accountId) || accountId);
      if (startIso) query = query.gte('created_at', startIso);
      if (endIso) query = query.lte('created_at', endIso);
      const { data, error } = await query;
      if (!error && data) return data.map(normalizeTransaction).filter(matchesDirection);
    } catch (err) {
      console.warn('getBankStatement Supabase warning:', err);
    }
  }

  try {
    const all = await db.bank_account_transactions.toArray();
    return all
      .filter(tx => String(tx.shop_id) === String(shopId))
      .filter(tx => !accountId || String(tx.account_id) === String(accountId))
      .filter(tx => (!startIso || tx.created_at >= startIso) && (!endIso || tx.created_at <= endIso))
      .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
      .slice(0, limit)
      .map(normalizeTransaction)
      .filter(matchesDirection);
  } catch (err) {
    console.error('getBankStatement Dexie error:', err);
    return [];
  }
};

/**
 * Compares each account's balance with what its statement adds up to
 * (sql/atomic_money_ops.sql). Returns { ok, rows } or { ok: false, missing | error }.
 */
export const checkBankBalances = async () => {
  if (!navigator.onLine) return { ok: false, error: 'Connect to the internet to check balances.' };
  const { data, error } = await getClient().rpc('check_bank_balances');
  if (error) {
    if (isMissingFunction(error)) return { ok: false, missing: true, error: 'Run sql/atomic_money_ops.sql in Supabase to enable the balance check.' };
    return { ok: false, error: error.message || 'Could not check balances' };
  }
  return {
    ok: true,
    rows: (data || []).map(r => ({
      ...r,
      stored_balance: Number(r.stored_balance || 0),
      statement_balance: Number(r.statement_balance || 0),
      difference: Number(r.difference || 0)
    }))
  };
};
