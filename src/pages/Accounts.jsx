import { useState, useEffect } from 'react'
import { Landmark, Plus, ArrowLeftRight, ArrowDownRight, ArrowUpRight, Check, Star, Trash2, Edit3, History, RefreshCw, AlertCircle, ShieldAlert, FileText, Copy, CheckCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  getBankAccounts,
  updateBankAccount,
  deleteBankAccount,
  adjustBankBalance,
  transferBetweenAccounts,
  getAllBankTransactions,
  editBankTransaction
} from '../services/bankService'
import BankAccountModal from '../components/BankAccountModal'

export default function Accounts() {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Modals
  const [showAddModal, setShowAddModal] = useState(false)
  const [showAdjustModal, setShowAdjustModal] = useState(false)
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const [showSqlModal, setShowSqlModal] = useState(false)
  const [copiedSql, setCopiedSql] = useState(false)

  // Selected State
  const [selectedAccount, setSelectedAccount] = useState(null)

  // Adjustment Form State
  const [adjustForm, setAdjustForm] = useState({
    type: 'DEPOSIT', // 'DEPOSIT' | 'WITHDRAWAL' | 'ADJUSTMENT'
    amount: '',
    notes: ''
  })
  const [adjusting, setAdjusting] = useState(false)

  // Transfer Form State
  const [transferForm, setTransferForm] = useState({
    fromAccountId: '',
    toAccountId: '',
    amount: '',
    notes: ''
  })
  const [transferring, setTransferring] = useState(false)

  // Edit Form State
  const [editForm, setEditForm] = useState({
    id: null,
    account_name: '',
    bank_name: '',
    account_number: '',
    is_default: false
  })
  const [editing, setEditing] = useState(false)

  const [message, setMessage] = useState({ type: '', text: '' })

  // Correct a mistaken entry (wrong amount, wrong account, deposit/withdrawal swapped)
  const [editTx, setEditTx] = useState(null)
  const [txForm, setTxForm] = useState({ amount: '', direction: 'deposit', accountId: '', description: '', reason: '' })
  const [savingTx, setSavingTx] = useState(false)

  const loadData = async () => {
    if (!user?.shop_id) return
    setLoading(true)
    try {
      const [accs, txs] = await Promise.all([
        getBankAccounts(user.shop_id),
        getAllBankTransactions(user.shop_id, 50)
      ])
      setAccounts(accs)
      setTransactions(txs)
    } catch (err) {
      console.error('Error loading bank accounts:', err)
      setMessage({ type: 'error', text: 'Failed to load accounts. Working in offline mode.' })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [user?.shop_id])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadData()
  }

  // Calculate Totals
  const totalBalance = accounts.reduce((sum, a) => sum + (Number(a.current_balance) || 0), 0)
  const defaultAccount = accounts.find(a => a.is_default) || accounts[0]

  // Set as Default
  const handleSetDefault = async (acc) => {
    try {
      await updateBankAccount(acc.id, {
        shop_id: user.shop_id,
        is_default: true
      })
      setMessage({ type: 'success', text: `${acc.account_name} is now your primary account.` })
      await loadData()
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to set default account: ' + err.message })
    }
  }

  // Delete Account (Guarded against vaporizing funds)
  const handleDelete = async (acc) => {
    const bal = Number(acc.current_balance || 0)
    if (Math.abs(bal) > 0.01) {
      alert(`⚠️ Account "${acc.account_name}" has an active balance of Rs. ${bal.toLocaleString()}.

Financial Protection: You cannot delete an account with existing funds. Please transfer or adjust the remaining balance to Rs. 0 before deleting.`)
      return
    }

    if (confirm(`Are you sure you want to delete ${acc.account_name} (${acc.bank_name})? Any past purchase references will remain in logs.`)) {
      try {
        await deleteBankAccount(acc.id, user.shop_id)
        setMessage({ type: 'success', text: `${acc.account_name} deleted successfully.` })
        await loadData()
      } catch (err) {
        setMessage({ type: 'error', text: 'Failed to delete account: ' + err.message })
      }
    }
  }

  // Open Adjust Modal
  const openAdjust = (acc, type = 'DEPOSIT') => {
    setSelectedAccount(acc)
    setAdjustForm({
      type,
      amount: '',
      notes: ''
    })
    setShowAdjustModal(true)
  }

  // Submit Adjustment
  const handleAdjustSubmit = async (e) => {
    e.preventDefault()
    if (!selectedAccount) return
    setAdjusting(true)
    try {
      await adjustBankBalance({
        shopId: user.shop_id,
        accountId: selectedAccount.id,
        type: adjustForm.type,
        amount: adjustForm.amount,
        notes: adjustForm.notes
      })
      setShowAdjustModal(false)
      setMessage({
        type: 'success',
        text: `Successfully recorded ${adjustForm.type.toLowerCase()} of Rs. ${Number(adjustForm.amount).toLocaleString()} for ${selectedAccount.account_name}.`
      })
      await loadData()
    } catch (err) {
      alert(err.message || 'Error processing adjustment')
    } finally {
      setAdjusting(false)
    }
  }

  // Open Transfer Modal
  const openTransfer = (fromAcc = null) => {
    const fromId = fromAcc ? String(fromAcc.id) : (accounts[0] ? String(accounts[0].id) : '')
    const remaining = accounts.filter(a => String(a.id) !== fromId)
    const toId = remaining[0] ? String(remaining[0].id) : ''
    setTransferForm({
      fromAccountId: fromId,
      toAccountId: toId,
      amount: '',
      notes: ''
    })
    setShowTransferModal(true)
  }

  // Submit Transfer
  const handleTransferSubmit = async (e) => {
    e.preventDefault()
    if (!transferForm.fromAccountId || !transferForm.toAccountId) {
      alert('Please select both source and destination accounts.')
      return
    }
    if (transferForm.fromAccountId === transferForm.toAccountId) {
      alert('Source and destination accounts must be different.')
      return
    }
    setTransferring(true)
    try {
      await transferBetweenAccounts({
        shopId: user.shop_id,
        fromAccountId: transferForm.fromAccountId,
        toAccountId: transferForm.toAccountId,
        amount: transferForm.amount,
        description: transferForm.notes
      })
      setShowTransferModal(false)
      setMessage({
        type: 'success',
        text: `Transferred Rs. ${Number(transferForm.amount).toLocaleString()} successfully.`
      })
      await loadData()
    } catch (err) {
      alert(err.message || 'Transfer failed')
    } finally {
      setTransferring(false)
    }
  }

  // Open Edit Modal
  const openEdit = (acc) => {
    setSelectedAccount(acc)
    setEditForm({
      id: acc.id,
      account_name: acc.account_name || '',
      bank_name: acc.bank_name || '',
      account_number: acc.account_number || '',
      is_default: Boolean(acc.is_default)
    })
    setShowEditModal(true)
  }

  // Transfers have a matching entry on the other account; entries not yet synced have
  // no server id. Neither can be corrected here.
  const txEditBlock = (tx) => {
    if (String(tx?.reference_type || '').toLowerCase().startsWith('transfer')) return 'Transfers cannot be edited; make a new transfer to correct one.'
    if (!/^\d+$/.test(String(tx?.id ?? ''))) return 'This entry has not synced yet.'
    return null
  }
  const txIsDeposit = (tx) => ['credit', 'deposit'].includes(String(tx?.transaction_type || '').toLowerCase())

  const openEditTx = (tx) => {
    const blocked = txEditBlock(tx)
    if (blocked) { alert(blocked); return }
    setEditTx(tx)
    setTxForm({
      amount: String(Number(tx.amount) || ''),
      direction: txIsDeposit(tx) ? 'deposit' : 'withdrawal',
      accountId: String(tx.account_id),
      description: (tx.description || '').replace(/\s*\[Corrected [^\]]*\]/g, '').trim(),
      reason: ''
    })
  }

  // What the correction will do to the balances (shown before saving)
  const txEditPreview = (() => {
    if (!editTx) return null
    const amt = Number(txForm.amount) || 0
    const oldEffect = (txIsDeposit(editTx) ? 1 : -1) * (Number(editTx.amount) || 0)
    const newEffect = (txForm.direction === 'deposit' ? 1 : -1) * amt
    const sameAccount = String(txForm.accountId) === String(editTx.account_id)
    const name = (id) => accounts.find(a => String(a.id) === String(id))?.account_name || 'Account'
    const fmt = (n) => `${n >= 0 ? '+' : '-'}Rs. ${Math.abs(n).toLocaleString()}`
    if (sameAccount) {
      const delta = newEffect - oldEffect
      return delta === 0 ? 'Balance unchanged.' : `${name(editTx.account_id)} balance: ${fmt(delta)}`
    }
    return `${name(editTx.account_id)}: ${fmt(-oldEffect)} • ${name(txForm.accountId)}: ${fmt(newEffect)}`
  })()

  const handleEditTxSubmit = async (e) => {
    e.preventDefault()
    if (!editTx) return
    const amt = Number(txForm.amount)
    if (!(amt > 0)) { alert('Please enter an amount greater than 0.'); return }
    if (!txForm.reason.trim()) { alert('Please write why this entry is being corrected.'); return }
    if (!confirm(`Correct this entry?\n\n${txEditPreview}\n\nThe original amount and your reason are kept in the entry's note.`)) return
    setSavingTx(true)
    try {
      await editBankTransaction({
        transactionId: editTx.id,
        amount: amt,
        direction: txForm.direction,
        accountId: String(txForm.accountId) !== String(editTx.account_id) ? txForm.accountId : null,
        description: txForm.description,
        reason: txForm.reason
      })
      setEditTx(null)
      setMessage({ type: 'success', text: 'Transaction corrected and account balance updated.' })
      await loadData()
    } catch (err) {
      alert('Could not correct the transaction: ' + (err?.message || err))
    } finally {
      setSavingTx(false)
    }
  }

  // Submit Edit
  const handleEditSubmit = async (e) => {
    e.preventDefault()
    setEditing(true)
    try {
      await updateBankAccount(editForm.id, {
        shop_id: user.shop_id,
        account_name: editForm.account_name.trim(),
        bank_name: editForm.bank_name.trim(),
        account_number: editForm.account_number.trim(),
        is_default: editForm.is_default
      })
      setShowEditModal(false)
      setMessage({ type: 'success', text: 'Bank account updated successfully.' })
      await loadData()
    } catch (err) {
      alert('Failed to update account: ' + err.message)
    } finally {
      setEditing(false)
    }
  }

  const sqlSetupScript = `-- Run this in Supabase SQL Editor if you want Cloud Sync for Bank Accounts
CREATE TABLE IF NOT EXISTS public.bank_accounts (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    account_name TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    account_number TEXT,
    current_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
    opening_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
    is_default BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bank_account_transactions (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
    transaction_type TEXT NOT NULL, -- 'CREDIT', 'DEBIT'
    amount NUMERIC(15,2) NOT NULL,
    balance_before NUMERIC(15,2) NOT NULL,
    balance_after NUMERIC(15,2) NOT NULL,
    reference_type TEXT, -- 'PURCHASE', 'DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'OPENING_BALANCE'
    reference_id TEXT,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_account_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS bank_accounts_shop_access ON public.bank_accounts
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS bank_account_txs_shop_access ON public.bank_account_transactions
    FOR ALL USING (true) WITH CHECK (true);`

  const handleCopySql = () => {
    navigator.clipboard.writeText(sqlSetupScript)
    setCopiedSql(true)
    setTimeout(() => setCopiedSql(false), 2500)
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Top Banner / Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-blue-600 text-white shadow-md shadow-blue-200">
              <Landmark className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight">Business Bank & Cash Accounts</h1>
              <p className="text-xs text-gray-500 font-medium">Manage liquid cash in hand, bank balances, automatic POS sales routing, and transfers</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 transition flex items-center gap-1.5 text-xs font-semibold"
            title="Refresh Balances"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-blue-600' : ''}`} />
            <span className="hidden sm:inline">Sync</span>
          </button>

          {accounts.length > 1 && (
            <button
              onClick={() => openTransfer()}
              className="px-3.5 py-2.5 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 rounded-xl transition text-xs font-bold flex items-center gap-1.5 shadow-sm"
            >
              <ArrowLeftRight className="w-4 h-4" />
              Transfer Funds
            </button>
          )}

          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition text-xs font-bold flex items-center gap-1.5 shadow-md shadow-blue-200 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add Bank Account
          </button>
        </div>
      </div>

      {/* Messages */}
      {message.text && (
        <div className={`p-3.5 rounded-xl text-xs font-semibold flex items-center justify-between ${
          message.type === 'error'
            ? 'bg-rose-50 border border-rose-200 text-rose-700'
            : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
        }`}>
          <span>{message.text}</span>
          <button onClick={() => setMessage({ type: '', text: '' })} className="font-bold text-gray-400 hover:text-gray-600 ml-4">✕</button>
        </div>
      )}

      {/* Liquidity Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Liquidity */}
        <div className="bg-gradient-to-br from-blue-700 via-blue-800 to-indigo-900 rounded-2xl p-5 text-white shadow-lg relative overflow-hidden">
          <div className="relative z-10 space-y-2">
            <div className="flex items-center justify-between text-blue-200 text-xs font-bold uppercase tracking-wider">
              <span>Total Liquid Funds (Cash & Bank)</span>
              <span className="p-1.5 bg-white/10 rounded-lg">🏦</span>
            </div>
            <div className="text-3xl font-black tracking-tight">
              Rs. {totalBalance.toLocaleString()}
            </div>
            <p className="text-[11px] text-blue-200/80 font-medium pt-1">
              Combined balance across {accounts.length} business account{accounts.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="absolute -right-6 -bottom-6 w-32 h-32 bg-white/5 rounded-full blur-2xl pointer-events-none" />
        </div>

        {/* Primary Account */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-gray-500 text-xs font-bold uppercase tracking-wider">
            <span>Primary Settlement Account</span>
            <span className="text-amber-500 font-bold flex items-center gap-1 text-[11px]">
              <Star className="w-3.5 h-3.5 fill-amber-400" /> Default
            </span>
          </div>
          {defaultAccount ? (
            <div>
              <p className="text-lg font-black text-gray-800 truncate">{defaultAccount.account_name}</p>
              <p className="text-xs text-gray-500">{defaultAccount.bank_name} {defaultAccount.account_number ? `• ${defaultAccount.account_number}` : ''}</p>
              <p className="text-xl font-bold text-emerald-600 mt-2 font-mono">
                Rs. {defaultAccount.current_balance.toLocaleString()}
              </p>
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic py-3">No default account set. Add an account to get started.</p>
          )}
        </div>

        {/* Quick Operations Banner */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex flex-col justify-between">
          <div>
            <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-2">
              Settlement & Cloud Status
            </div>
            <p className="text-xs text-gray-600 font-medium">
              Bank balances deduct automatically on purchase entry and synchronize across devices.
            </p>
          </div>
          <div className="pt-3 flex items-center justify-between border-t border-gray-100 mt-2">
            <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100">
              ● Live Sync Ready
            </span>
            <button
              onClick={() => setShowSqlModal(true)}
              className="text-[11px] text-blue-600 hover:text-blue-800 font-bold hover:underline flex items-center gap-1"
            >
              <FileText className="w-3.5 h-3.5" /> Supabase SQL
            </button>
          </div>
        </div>
      </div>

      {/* Account List Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <span>Linked Accounts</span>
            <span className="text-xs bg-gray-100 text-gray-600 font-black px-2 py-0.5 rounded-full">{accounts.length}</span>
          </h2>
          {accounts.length > 0 && (
            <button
              onClick={() => setShowHistoryModal(true)}
              className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <History className="w-3.5 h-3.5" /> View All Transactions
            </button>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-44 bg-gray-100 rounded-2xl" />
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-12 text-center space-y-4">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto text-2xl">
              🏦
            </div>
            <div className="max-w-md mx-auto">
              <h3 className="text-base font-bold text-gray-800">No Bank Accounts Linked Yet</h3>
              <p className="text-xs text-gray-500 mt-1">
                Add your business bank accounts (Meezan Bank, HBL, Bank Alfalah, SadaPay, etc.) so you can deduct phone purchases and track your capital in real time.
              </p>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition shadow-md shadow-blue-200 cursor-pointer inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add First Bank Account
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map(acc => {
              const isDefault = Boolean(acc.is_default)
              return (
                <div
                  key={acc.id}
                  className={`bg-white rounded-2xl border transition hover:shadow-md flex flex-col justify-between p-5 relative overflow-hidden ${
                    isDefault ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200'
                  }`}
                >
                  {/* Top indicator ribbon */}
                  <div className={`absolute top-0 left-0 right-0 h-1.5 ${
                    isDefault ? 'bg-blue-600' : 'bg-gray-300'
                  }`} />

                  <div>
                    {/* Header: Title + Star */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="font-extrabold text-gray-900 text-base truncate">{acc.account_name}</h3>
                          {isDefault && (
                            <span className="shrink-0 bg-blue-50 text-blue-700 text-[10px] font-black px-2 py-0.5 rounded-full border border-blue-200">
                              Primary
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-semibold text-gray-500 flex items-center gap-1 mt-0.5">
                          <span className="text-gray-700 font-bold">{acc.bank_name}</span>
                          {acc.account_number && <span>• {acc.account_number}</span>}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {!isDefault && (
                          <button
                            onClick={() => handleSetDefault(acc)}
                            className="p-1 text-gray-300 hover:text-amber-500 transition cursor-pointer"
                            title="Make Default Primary Account"
                          >
                            <Star className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(acc)}
                          className="p-1 text-gray-400 hover:text-blue-600 transition cursor-pointer"
                          title="Edit Details"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(acc)}
                          className="p-1 text-gray-300 hover:text-red-500 transition cursor-pointer"
                          title="Delete Account"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Balance */}
                    <div className="my-4 bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-0.5">Available Balance</span>
                      <p className={`text-2xl font-black font-mono ${
                        acc.current_balance < 0 ? 'text-red-600' : 'text-gray-900'
                      }`}>
                        Rs. {acc.current_balance.toLocaleString()}
                      </p>
                      <div className="flex justify-between items-center text-[10px] text-gray-400 font-semibold mt-1 pt-1 border-t border-gray-200/50">
                        <span>Opening: Rs. {acc.opening_balance.toLocaleString()}</span>
                        <span className="text-emerald-600 font-bold">● Active</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="pt-2 border-t border-gray-100 flex items-center gap-2">
                    <button
                      onClick={() => openAdjust(acc, 'DEPOSIT')}
                      className="flex-1 py-1.5 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <ArrowDownRight className="w-3.5 h-3.5 text-emerald-600" />
                      Deposit
                    </button>
                    <button
                      onClick={() => openAdjust(acc, 'WITHDRAWAL')}
                      className="flex-1 py-1.5 px-2 bg-rose-50 hover:bg-rose-100 text-rose-800 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5 text-rose-600" />
                      Withdraw
                    </button>
                    <button
                      onClick={() => {
                        setSelectedAccount(acc)
                        setShowHistoryModal(true)
                      }}
                      className="p-1.5 border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-lg transition"
                      title="Account History"
                    >
                      <History className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Recent Bank Transactions Audit Feed */}
      {transactions.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-extrabold text-gray-800 text-base flex items-center gap-2">
              <History className="w-4 h-4 text-blue-600" />
              Recent Bank Deductions & Entries
            </h3>
            <span className="text-xs text-gray-400 font-medium">Last {transactions.length} records</span>
          </div>

          <div className="divide-y divide-gray-100">
            {transactions.slice(0, 10).map((tx, idx) => {
              const isCredit = tx.transaction_type === 'CREDIT' || 
                tx.transaction_type === 'credit' || 
                tx.transaction_type === 'deposit' ||
                tx.reference_type?.toLowerCase() === 'sale' ||
                tx.reference_type?.toLowerCase() === 'deposit'
              const acc = accounts.find(a => String(a.id) === String(tx.account_id))
              const dateStr = new Date(tx.created_at).toLocaleDateString('en-PK', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })

              return (
                <div key={tx.id || idx} className="py-2.5 flex items-center justify-between text-xs hover:bg-gray-50/70 px-2 rounded-lg transition">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-xl shrink-0 ${
                      isCredit ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                    }`}>
                      {isCredit ? <ArrowDownRight className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-gray-800 truncate">
                        {tx.description || (isCredit ? 'Deposit' : 'Purchase Payment')}
                      </p>
                      <p className="text-[10px] text-gray-400 font-medium">
                        {acc ? `${acc.account_name} (${acc.bank_name})` : 'Bank Account'} • {dateStr}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0 pl-3">
                    <p className={`font-mono font-bold text-sm ${isCredit ? 'text-emerald-600' : 'text-gray-900'}`}>
                      {isCredit ? '+' : '-'}Rs. {Number(tx.amount).toLocaleString()}
                    </p>
                    <p className="text-[10px] text-gray-400 font-mono">
                      Bal: Rs. {Number(tx.balance_after).toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEditTx(tx)}
                    disabled={Boolean(txEditBlock(tx))}
                    title={txEditBlock(tx) || 'Correct this entry'}
                    aria-label="Correct this entry"
                    className="ml-2 p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Adjust / Deposit / Withdraw Modal */}
      {showAdjustModal && selectedAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-gray-900 text-base">Adjust Funds: {selectedAccount.account_name}</h3>
                <p className="text-xs text-gray-500 font-semibold">{selectedAccount.bank_name} • Current Bal: Rs. {selectedAccount.current_balance.toLocaleString()}</p>
              </div>
              <button onClick={() => setShowAdjustModal(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">✕</button>
            </div>

            <form onSubmit={handleAdjustSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1.5">Operation Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAdjustForm(prev => ({ ...prev, type: 'DEPOSIT' }))}
                    className={`py-2 rounded-xl font-bold transition flex items-center justify-center gap-1.5 ${
                      adjustForm.type === 'DEPOSIT'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <ArrowDownRight className="w-4 h-4" /> Deposit / Add Funds
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustForm(prev => ({ ...prev, type: 'WITHDRAWAL' }))}
                    className={`py-2 rounded-xl font-bold transition flex items-center justify-center gap-1.5 ${
                      adjustForm.type === 'WITHDRAWAL'
                        ? 'bg-rose-600 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <ArrowUpRight className="w-4 h-4" /> Withdraw / Cash Out
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1.5">Amount (Rs.) *</label>
                <input
                  type="number"
                  min="1"
                  required
                  placeholder="e.g. 50000"
                  value={adjustForm.amount}
                  onChange={e => setAdjustForm(prev => ({ ...prev, amount: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  autoFocus
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1.5">Description / Note</label>
                <input
                  type="text"
                  placeholder="e.g. Cash deposited from shop vault, ATM withdrawal"
                  value={adjustForm.notes}
                  onChange={e => setAdjustForm(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowAdjustModal(false)}
                  className="px-4 py-2 border rounded-xl font-bold text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adjusting}
                  className={`px-5 py-2 text-white font-bold rounded-xl transition ${
                    adjustForm.type === 'DEPOSIT'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {adjusting ? 'Saving...' : 'Confirm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transfer Funds Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-indigo-700" />
                <h3 className="font-extrabold text-indigo-900 text-base">Transfer Between Accounts</h3>
              </div>
              <button onClick={() => setShowTransferModal(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">✕</button>
            </div>

            <form onSubmit={handleTransferSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1">From Account (Source) *</label>
                <select
                  value={transferForm.fromAccountId}
                  onChange={e => setTransferForm(prev => ({ ...prev, fromAccountId: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-xl font-semibold outline-none bg-white"
                >
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.account_name} ({a.bank_name}) — Rs. {a.current_balance.toLocaleString()}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">To Account (Destination) *</label>
                <select
                  value={transferForm.toAccountId}
                  onChange={e => setTransferForm(prev => ({ ...prev, toAccountId: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-xl font-semibold outline-none bg-white"
                >
                  {accounts.map(a => (
                    <option key={a.id} value={a.id} disabled={String(a.id) === String(transferForm.fromAccountId)}>
                      {a.account_name} ({a.bank_name}) — Rs. {a.current_balance.toLocaleString()}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Transfer Amount (Rs.) *</label>
                <input
                  type="number"
                  min="1"
                  required
                  placeholder="e.g. 100000"
                  value={transferForm.amount}
                  onChange={e => setTransferForm(prev => ({ ...prev, amount: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border rounded-xl font-bold outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Notes (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. IBFT transfer from Meezan to HBL"
                  value={transferForm.notes}
                  onChange={e => setTransferForm(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowTransferModal(false)}
                  className="px-4 py-2 border rounded-xl font-bold text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={transferring}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition shadow-md shadow-indigo-200"
                >
                  {transferring ? 'Transferring...' : 'Execute Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Account Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-extrabold text-gray-900 text-base">Edit Account Details</h3>
              <button onClick={() => setShowEditModal(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">✕</button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1">Account Display Name *</label>
                <input
                  type="text"
                  required
                  value={editForm.account_name}
                  onChange={e => setEditForm(prev => ({ ...prev, account_name: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-xl font-semibold outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Bank / Institution Name *</label>
                <input
                  type="text"
                  required
                  value={editForm.bank_name}
                  onChange={e => setEditForm(prev => ({ ...prev, bank_name: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-xl font-semibold outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Account Number / IBAN</label>
                <input
                  type="text"
                  value={editForm.account_number}
                  onChange={e => setEditForm(prev => ({ ...prev, account_number: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-xl font-mono outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="editIsDefault"
                  checked={editForm.is_default}
                  onChange={e => setEditForm(prev => ({ ...prev, is_default: e.target.checked }))}
                  className="w-4 h-4 rounded text-blue-600"
                />
                <label htmlFor="editIsDefault" className="font-bold text-gray-700">Set as Primary Default Account</label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 border rounded-xl font-bold text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editing}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition"
                >
                  {editing ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Correct Transaction Modal */}
      {editTx && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="edit-tx-title">
          <form onSubmit={handleEditTxSubmit} className="w-full max-w-md max-h-[90dvh] bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col">
            <div className="px-5 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h3 id="edit-tx-title" className="font-extrabold text-gray-900 text-base flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-blue-600" /> Correct Transaction
              </h3>
              <button type="button" onClick={() => setEditTx(null)} aria-label="Close" className="p-2 -mr-2 text-gray-400 hover:text-gray-600 text-xl font-bold">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-xs text-gray-600">
                <p className="font-bold text-gray-800">Currently: {txIsDeposit(editTx) ? 'Deposit' : 'Withdrawal'} of Rs. {Number(editTx.amount).toLocaleString()}</p>
                <p>{accounts.find(a => String(a.id) === String(editTx.account_id))?.account_name || 'Account'} • {new Date(editTx.created_at).toLocaleString('en-PK')}</p>
                {editTx.reference_type && !['deposit', 'withdrawal', 'adjustment', 'manual'].includes(String(editTx.reference_type).toLowerCase()) && (
                  <p className="mt-1 text-amber-700">Linked to a {String(editTx.reference_type).toLowerCase()} record: only the bank entry changes, not that record.</p>
                )}
              </div>

              <fieldset>
                <legend className="block text-xs font-bold text-gray-700 mb-1">Type</legend>
                <div className="grid grid-cols-2 gap-2">
                  {[{ id: 'deposit', label: 'Deposit (money in)' }, { id: 'withdrawal', label: 'Withdrawal (money out)' }].map(opt => (
                    <label key={opt.id} className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-bold cursor-pointer ${txForm.direction === opt.id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}>
                      <input type="radio" name="tx-direction" value={opt.id} checked={txForm.direction === opt.id} onChange={() => setTxForm(f => ({ ...f, direction: opt.id }))} className="sr-only" />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <label htmlFor="edit-tx-amount" className="block text-xs font-bold text-gray-700 mb-1">Correct amount (Rs.)</label>
                <input id="edit-tx-amount" type="number" min="0.01" step="0.01" inputMode="decimal" required
                  value={txForm.amount} onChange={e => setTxForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-300 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <div>
                <label htmlFor="edit-tx-account" className="block text-xs font-bold text-gray-700 mb-1">Account</label>
                <select id="edit-tx-account" value={txForm.accountId} onChange={e => setTxForm(f => ({ ...f, accountId: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {accounts.map(a => (
                    <option key={a.id} value={String(a.id)}>{a.account_name}{a.bank_name ? ` (${a.bank_name})` : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="edit-tx-desc" className="block text-xs font-bold text-gray-700 mb-1">Description</label>
                <input id="edit-tx-desc" type="text" value={txForm.description} onChange={e => setTxForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <div>
                <label htmlFor="edit-tx-reason" className="block text-xs font-bold text-gray-700 mb-1">Reason for correction *</label>
                <input id="edit-tx-reason" type="text" required placeholder="e.g. typed 50,000 instead of 5,000"
                  value={txForm.reason} onChange={e => setTxForm(f => ({ ...f, reason: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {txEditPreview && (
                <p className="rounded-xl bg-blue-50 border border-blue-100 px-3 py-2 text-xs font-bold text-blue-800" aria-live="polite">{txEditPreview}</p>
              )}
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 shrink-0">
              <button type="button" onClick={() => setEditTx(null)} className="px-4 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-xl text-xs">Cancel</button>
              <button type="submit" disabled={savingTx} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl text-xs">
                {savingTx ? 'Saving…' : 'Save correction'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Account Transactions History Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden max-h-[85dvh] flex flex-col">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-blue-600" />
                <h3 className="font-extrabold text-gray-900 text-base">
                  {selectedAccount ? `Transaction History: ${selectedAccount.account_name}` : 'All Account Transactions'}
                </h3>
              </div>
              <button onClick={() => { setShowHistoryModal(false); setSelectedAccount(null) }} className="text-gray-400 hover:text-gray-600 text-xl font-bold">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-2 divide-y divide-gray-100">
              {(() => {
                const filtered = selectedAccount
                  ? transactions.filter(t => String(t.account_id) === String(selectedAccount.id))
                  : transactions

                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-12 text-gray-400 text-xs">
                      No transactions recorded for this account yet.
                    </div>
                  )
                }

                return filtered.map((tx, idx) => {
                  const isCredit = tx.transaction_type === 'CREDIT' || 
                    tx.transaction_type === 'credit' || 
                    tx.transaction_type === 'deposit' ||
                    tx.reference_type?.toLowerCase() === 'sale' ||
                    tx.reference_type?.toLowerCase() === 'deposit'
                  const acc = accounts.find(a => String(a.id) === String(tx.account_id))
                  const dateStr = new Date(tx.created_at).toLocaleString('en-PK')

                  return (
                    <div key={tx.id || idx} className="pt-2.5 pb-2 flex items-center justify-between text-xs">
                      <div className="min-w-0 pr-2">
                        <p className="font-bold text-gray-900">{tx.description || tx.reference_type}</p>
                        <p className="text-[11px] text-gray-500">
                          {acc?.account_name} • Ref: {tx.reference_type || 'MANUAL'} • {dateStr}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`font-mono font-bold text-sm ${isCredit ? 'text-emerald-600' : 'text-gray-900'}`}>
                          {isCredit ? '+' : '-'}Rs. {Number(tx.amount).toLocaleString()}
                        </p>
                        <p className="text-[10px] text-gray-400 font-mono">
                          Bal After: Rs. {Number(tx.balance_after).toLocaleString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openEditTx(tx)}
                        disabled={Boolean(txEditBlock(tx))}
                        title={txEditBlock(tx) || 'Correct this entry'}
                        aria-label="Correct this entry"
                        className="ml-2 p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    </div>
                  )
                })
              })()}
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 text-right shrink-0">
              <button
                onClick={() => { setShowHistoryModal(false); setSelectedAccount(null) }}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-xl text-xs transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cloud SQL Setup Modal */}
      {showSqlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden max-h-[85dvh] flex flex-col">
            <div className="px-6 py-4 bg-blue-50 border-b border-blue-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Landmark className="w-5 h-5 text-blue-700" />
                <h3 className="font-extrabold text-blue-900 text-base">Supabase Cloud Database Setup (Optional)</h3>
              </div>
              <button onClick={() => setShowSqlModal(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">✕</button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              <p className="text-gray-600">
                Accounts work 100% offline using your browser storage. If you want multi-device cloud synchronization, execute this query once in your <strong>Supabase SQL Editor</strong>:
              </p>

              <div className="relative">
                <pre className="bg-slate-900 text-slate-100 p-4 rounded-xl text-[11px] font-mono overflow-x-auto max-h-64 custom-scrollbar">
                  {sqlSetupScript}
                </pre>
                <button
                  onClick={handleCopySql}
                  className="absolute top-2 right-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow"
                >
                  {copiedSql ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedSql ? 'Copied!' : 'Copy SQL'}
                </button>
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 text-right shrink-0">
              <button
                onClick={() => setShowSqlModal(false)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-xl text-xs transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Bank Account Modal */}
      {showAddModal && (
        <BankAccountModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          shopId={user?.shop_id}
          onSuccess={(newAcc) => {
            setAccounts(prev => [newAcc, ...prev])
            setMessage({ type: 'success', text: `Bank account ${newAcc.account_name} created successfully.` })
          }}
        />
      )}
    </div>
  )
}
