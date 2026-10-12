import { supabase } from './supabase';
import { supabaseAdmin } from './supabaseAdmin';
import { db, addToSyncQueue } from './db';

const getClient = () => {
  return supabaseAdmin || supabase;
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

      if (!error && data && data.length > 0) {
        // Sync into Dexie cache
        try {
          await db.bank_accounts.bulkPut(data);
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
    status: accountData.status || 'ACTIVE',
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
  const localId = Date.now();
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

/**
 * Deduct an amount from a bank account (e.g. for phone or product purchase payment).
 */
export const deductBankBalance = async ({
  shopId,
  accountId,
  amount,
  purchaseId = null,
  description = ''
}) => {
  const deductAmount = Math.abs(Number(amount || 0));
  if (!accountId || deductAmount <= 0) return null;

  // 1. Get current account info
  let account = null;
  const client = getClient();

  if (navigator.onLine) {
    try {
      const { data } = await client
        .from('bank_accounts')
        .select('*')
        .eq('id', accountId)
        .single();
      if (data) account = data;
    } catch (err) {
      console.warn('Error fetching account for deduction:', err);
    }
  }

  if (!account) {
    account = await db.bank_accounts.get(Number(accountId));
  }

  const currentBalance = Number(account?.current_balance || 0);
  const newBalance = currentBalance - deductAmount;

  // 2. Update bank_accounts balance
  if (navigator.onLine) {
    try {
      const { error: updateError } = await client
        .from('bank_accounts')
        .update({
          current_balance: newBalance,
          updated_at: new Date().toISOString()
        })
        .eq('id', accountId);

      if (updateError) {
        console.warn('Error updating bank_accounts in Supabase:', updateError);
      }
    } catch (err) {
      console.warn('Network error updating bank account balance:', err);
    }
  }

  // Update Dexie
  try {
    const local = await db.bank_accounts.get(Number(accountId));
    if (local) {
      await db.bank_accounts.update(Number(accountId), {
        current_balance: newBalance,
        updated_at: new Date().toISOString()
      });
    }
  } catch (dexieErr) {
    console.warn('Failed to update Dexie bank_accounts:', dexieErr);
  }

  // 3. Record transaction in bank_account_transactions
  const desc = description || `Purchase payment deduction (Purchase #${purchaseId || 'N/A'})`;
  await recordBankTransaction({
    shopId,
    accountId,
    transactionType: 'DEBIT',
    amount: deductAmount,
    balanceBefore: currentBalance,
    balanceAfter: newBalance,
    referenceType: 'PURCHASE',
    referenceId: purchaseId ? String(purchaseId) : null,
    description: desc
  });

  return {
    accountId,
    balanceBefore: currentBalance,
    balanceAfter: newBalance,
    deducted: deductAmount
  };
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
  const creditAmount = Math.abs(Number(amount || 0));
  if (!accountId || creditAmount <= 0) return null;

  let account = null;
  const client = getClient();

  if (navigator.onLine) {
    try {
      const { data } = await client
        .from('bank_accounts')
        .select('*')
        .eq('id', accountId)
        .single();
      if (data) account = data;
    } catch (err) {
      console.warn('Error fetching account for credit:', err);
    }
  }

  if (!account) {
    account = await db.bank_accounts.get(Number(accountId));
  }

  const currentBalance = Number(account?.current_balance || 0);
  const newBalance = currentBalance + creditAmount;

  if (navigator.onLine) {
    try {
      await client
        .from('bank_accounts')
        .update({
          current_balance: newBalance,
          updated_at: new Date().toISOString()
        })
        .eq('id', accountId);
    } catch (err) {
      console.warn('Network error updating bank balance:', err);
    }
  }

  try {
    const local = await db.bank_accounts.get(Number(accountId));
    if (local) {
      await db.bank_accounts.update(Number(accountId), {
        current_balance: newBalance,
        updated_at: new Date().toISOString()
      });
    }
  } catch (dexieErr) {
    console.warn('Dexie update failed:', dexieErr);
  }

  await recordBankTransaction({
    shopId,
    accountId,
    transactionType: 'CREDIT',
    amount: creditAmount,
    balanceBefore: currentBalance,
    balanceAfter: newBalance,
    referenceType,
    referenceId: referenceId ? String(referenceId) : null,
    description
  });

  return {
    accountId,
    balanceBefore: currentBalance,
    balanceAfter: newBalance,
    credited: creditAmount
  };
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
  const record = {
    shop_id: shopId,
    account_id: accountId,
    transaction_type: transactionType,
    amount: Number(amount || 0),
    balance_before: Number(balanceBefore || 0),
    balance_after: Number(balanceAfter || 0),
    reference_type: referenceType,
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
  const localRecord = { ...record, id: Date.now() };
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
        return data;
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
    return list.slice(0, limit);
  } catch (err) {
    console.error('Dexie getAccountTransactions failed:', err);
    return [];
  }
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

      if (!error && data) return data;
    } catch (err) {
      console.warn('getAllBankTransactions Supabase warning:', err);
    }
  }

  try {
    const all = await db.bank_account_transactions.toArray();
    return all
      .filter(tx => String(tx.shop_id) === String(shopId))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, limit);
  } catch (err) {
    console.error('getAllBankTransactions Dexie error:', err);
    return [];
  }
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
  const numericAmount = Math.abs(Number(amount || 0));
  if (!accountId || numericAmount <= 0) {
    throw new Error('Please enter a valid amount greater than 0.');
  }

  const numAccountId = Number(accountId);
  let account = await db.bank_accounts.get(numAccountId);

  if (!account && navigator.onLine) {
    try {
      const { data } = await getClient()
        .from('bank_accounts')
        .select('*')
        .eq('id', numAccountId)
        .single();
      if (data) account = data;
    } catch (err) {
      console.warn('adjustBankBalance fetch error:', err);
    }
  }

  if (!account) throw new Error('Bank account not found.');

  const balanceBefore = Number(account.current_balance || 0);
  let balanceAfter = balanceBefore;
  let txType = 'CREDIT';

  if (type === 'DEPOSIT') {
    balanceAfter = balanceBefore + numericAmount;
    txType = 'CREDIT';
  } else if (type === 'WITHDRAWAL') {
    balanceAfter = balanceBefore - numericAmount;
    txType = 'DEBIT';
  } else if (type === 'ADJUSTMENT') {
    // If setting a target balance
    balanceAfter = Number(amount || 0);
    txType = balanceAfter >= balanceBefore ? 'CREDIT' : 'DEBIT';
  }

  // Update account balance
  await updateBankAccount(numAccountId, {
    shop_id: shopId,
    current_balance: balanceAfter
  });

  // Record audit transaction
  await recordBankTransaction({
    shopId,
    accountId: numAccountId,
    transactionType: txType,
    amount: type === 'ADJUSTMENT' ? Math.abs(balanceAfter - balanceBefore) : numericAmount,
    balanceBefore,
    balanceAfter,
    referenceType: type,
    referenceId: `MANUAL-${Date.now()}`,
    description: notes || `Manual ${type.toLowerCase()} of Rs. ${numericAmount.toLocaleString()}`
  });

  return {
    accountId: numAccountId,
    balanceBefore,
    balanceAfter,
    difference: balanceAfter - balanceBefore
  };
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
  const transferAmount = Math.abs(Number(amount || 0));
  if (transferAmount <= 0) throw new Error('Transfer amount must be greater than 0');
  if (fromAccountId === toAccountId) throw new Error('Source and destination accounts must be different');

  const fromAccId = Number(fromAccountId);
  const toAccId = Number(toAccountId);

  // 1. Deduct from source
  await deductBankBalance({
    shopId,
    accountId: fromAccId,
    amount: transferAmount,
    description: `Transfer OUT to Account #${toAccId}: ${description || 'Internal Transfer'}`
  });

  // 2. Credit to destination
  await creditBankBalance({
    shopId,
    accountId: toAccId,
    amount: transferAmount,
    referenceType: 'TRANSFER',
    referenceId: `TX-FROM-${fromAccId}`,
    description: `Transfer IN from Account #${fromAccId}: ${description || 'Internal Transfer'}`
  });

  return { success: true, amount: transferAmount };
};

