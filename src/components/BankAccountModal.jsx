import { useState } from 'react';
import { Landmark, X, PlusCircle, CheckCircle, AlertCircle } from 'lucide-react';
import { createBankAccount } from '../services/bankService';

const POPULAR_BANKS = [
  'Meezan Bank',
  'Habib Bank Limited (HBL)',
  'United Bank Limited (UBL)',
  'MCB Bank',
  'Allied Bank Limited (ABL)',
  'Bank Alfalah',
  'Faysal Bank',
  'Bank of Punjab (BOP)',
  'Askari Bank',
  'Standard Chartered',
  'Dubai Islamic Bank',
  'JS Bank',
  'SadaPay',
  'NayaPay',
  'JazzCash',
  'EasyPaisa',
  'Cash Drawer / Physical Vault'
];

export default function BankAccountModal({ isOpen, onClose, shopId, onSuccess }) {
  const [accountName, setAccountName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!accountName.trim()) {
      setError('Please provide an account name or nickname.');
      return;
    }
    if (!bankName.trim()) {
      setError('Please select or specify a bank or financial institution.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const balanceNum = parseFloat(openingBalance) || 0;
      const newAccount = await createBankAccount({
        shop_id: shopId,
        account_name: accountName.trim(),
        bank_name: bankName.trim(),
        account_number: accountNumber.trim(),
        opening_balance: balanceNum,
        is_default: isDefault
      });

      if (newAccount) {
        if (onSuccess) onSuccess(newAccount);
        onClose();
      } else {
        setError('Failed to create account. Please try again.');
      }
    } catch (err) {
      console.error('Error creating bank account:', err);
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div 
        className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Add Bank Account</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Manage business balances and purchase settlement accounts</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 text-sm text-red-700 bg-red-50 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-900/50 rounded-xl">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Account Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Account Display Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="e.g. Meezan Main Business, HBL Daily Cash"
              className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900 dark:text-white placeholder-slate-400"
            />
          </div>

          {/* Bank / Institution */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Bank / Institution <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2">
              <select
                value={POPULAR_BANKS.includes(bankName) ? bankName : (bankName ? 'custom' : '')}
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    setBankName('');
                  } else {
                    setBankName(e.target.value);
                  }
                }}
                className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900 dark:text-white"
              >
                <option value="">-- Select Bank or Payment Service --</option>
                {POPULAR_BANKS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
                <option value="custom">Other / Custom Bank...</option>
              </select>

              {(!POPULAR_BANKS.includes(bankName) || bankName === '') && (
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="Type Bank / Institution name..."
                  className="w-full px-3.5 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900 dark:text-white placeholder-slate-400"
                />
              )}
            </div>
          </div>

          {/* Account Number / IBAN */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Account / IBAN / Wallet Number (Optional)
            </label>
            <input
              type="text"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="e.g. PK00MEZN0001020304050607"
              className="w-full px-3.5 py-2.5 text-sm font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900 dark:text-white placeholder-slate-400"
            />
          </div>

          {/* Opening / Current Balance */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Current Available Balance (Rs.)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">Rs.</span>
              <input
                type="number"
                min="0"
                step="any"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                placeholder="0.00"
                className="w-full pl-12 pr-4 py-2.5 text-sm font-semibold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900 dark:text-white placeholder-slate-400"
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              This amount will be tracked. Purchases paid from this account will automatically deduct from this balance.
            </p>
          </div>

          {/* Default Account Checkbox */}
          <div className="pt-2">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded border-slate-300 dark:border-slate-700 focus:ring-blue-500"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300 font-medium">
                Set as Default Payment Account
              </span>
            </label>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 rounded-xl shadow-sm transition"
            >
              {loading ? (
                <span>Saving...</span>
              ) : (
                <>
                  <PlusCircle className="w-4 h-4" />
                  <span>Create Account</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
