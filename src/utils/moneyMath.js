/*
 * Money rules shared by POS, Sales, the ledgers and the cash session, kept in one
 * place so the online and offline paths (and every screen) agree.
 * Pure functions: no database or network access. Tested by scripts/test_money_math.mjs.
 */

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Rounds to paisa (2 decimals) without binary float drift (1.005 -> 1.01). */
export const roundMoney = (v) => {
  const n = num(v)
  const rounded = Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100
  return n < 0 ? -rounded : rounded
}

/** A sale that counts: not a quotation (or other non-sale type) and not voided. */
export const isCountedSale = (sale) =>
  (sale?.sale_type == null || sale.sale_type === '' || sale.sale_type === 'sale') && sale?.status !== 'voided'

/** Bill amount after discount. */
export const netAmount = (rec) =>
  roundMoney(rec?.net_amount ?? (num(rec?.total_amount) - num(rec?.discount)))

export const paidAmount = (rec) => roundMoney(rec?.paid_amount ?? rec?.amount_paid ?? 0)

/**
 * What a sale adds to the customer's balance: bill minus paid. Negative after a
 * "credit to balance" return on a bill that was already paid (the shop owes the customer).
 */
export const saleBalanceEffect = (sale) =>
  isCountedSale(sale) ? roundMoney(netAmount(sale) - paidAmount(sale)) : 0

/**
 * Return of goods on a sale or a purchase.
 *   grossReturn  returned quantity x unit price, before the bill discount
 *   toBalance    true: the whole amount goes to the party's balance (no cash moves)
 * The bill discount is given back in proportion; cash handed back never exceeds what
 * was actually paid on the bill, the rest comes off the party's balance.
 */
export function computeReturn({ record, grossReturn, toBalance = false }) {
  const gross = num(record?.total_amount)
  const discount = num(record?.discount)
  const paid = paidAmount(record)
  const returned = Math.min(Math.max(0, num(grossReturn)), gross)

  const discountReturned = gross > 0 ? roundMoney(discount * (returned / gross)) : 0
  const netReturn = Math.max(0, roundMoney(returned - discountReturned))

  const cashRefund = toBalance ? 0 : Math.min(netReturn, paid)
  const balanceRefund = roundMoney(netReturn - cashRefund)

  const newTotal = Math.max(0, roundMoney(gross - returned))
  const newDiscount = newTotal === 0 ? 0 : Math.max(0, roundMoney(discount - discountReturned))
  const newNet = Math.max(0, roundMoney(newTotal - newDiscount))
  const newPaid = Math.max(0, roundMoney(paid - cashRefund))

  return {
    netReturn,
    discountReturned,
    cashRefund: roundMoney(cashRefund),
    balanceRefund,
    update: {
      total_amount: newTotal,
      discount: newDiscount,
      net_amount: newNet,
      paid_amount: newPaid,
      amount_paid: newPaid
    }
  }
}

/**
 * Change in the customer's balance caused by one customer-ledger row.
 *   sale     bill minus paid
 *   debit    manual sale entry: adds
 *   payment  money received: subtracts
 *   return / refund  notes only: the invoice itself was already reduced by the return
 */
export function customerLedgerEffect(item) {
  if (item?.type === 'sale') {
    if (item.sale_type !== undefined || item.status !== undefined) {
      if (!isCountedSale(item)) return 0
    }
    return roundMoney(num(item.amount) - num(item.paid_amount))
  }
  if (item?.type === 'debit' || item?.payment_type === 'debit') return num(item.amount)
  if (item?.payment_type === 'refund' || item?.payment_type === 'return' || item?.type === 'return') return 0
  return -Math.abs(num(item?.amount))
}

/**
 * Change in what the shop owes a supplier caused by one supplier-ledger row.
 *   purchase  bill after discount: adds (its payment is a separate "payment" row)
 *   debit     manual purchase entry: adds
 *   payment   money paid: subtracts
 *   refund    supplier gave money back for returned goods; the bill was reduced and the
 *             earlier payment row still shows the full amount, so this adds it back
 *   return    credit note for a returned phone (positive amount): subtracts.
 *             A return settled in cash / bank, or one written with a negative amount
 *             (the bill itself was reduced), does not change the balance.
 */
export function supplierLedgerEffect(item) {
  if (item?.type === 'purchase' || item?.type === 'debit' || item?.payment_type === 'debit') return num(item.amount)
  if (item?.payment_type === 'refund') return Math.abs(num(item.amount))
  if (item?.payment_type === 'return' || item?.type === 'return') {
    const mode = String(item.payment_mode || '').toLowerCase()
    if (num(item.amount) <= 0 || mode === 'cash' || mode === 'bank') return 0
    return -num(item.amount)
  }
  return -Math.abs(num(item?.amount))
}

const isCashTender = (t) => {
  const method = String(t?.method || '').toLowerCase()
  const provider = String(t?.provider || '').toLowerCase()
  return method === 'cash' || (!method && provider === 'cash')
}

/**
 * Cash that went into (sale) or out of (purchase) the drawer for one bill.
 * Uses the bill's tender list when it has one, so the cash part of a split payment and
 * the cash received on a credit bill are counted; never more than was paid on the bill.
 */
export function cashPortion(rec) {
  const method = String(rec?.payment_method || rec?.payment_type || 'cash').toLowerCase()
  if (method === 'quotation') return 0
  const paid = Math.max(0, paidAmount(rec))
  const details = Array.isArray(rec?.payment_details) ? rec.payment_details : null
  if (details && details.length > 0 && details.some(t => t && (t.method || t.provider))) {
    const cash = details.filter(isCashTender).reduce((s, t) => s + Math.max(0, num(t.amount)), 0)
    return roundMoney(Math.min(cash, paid))
  }
  return method === 'cash' ? paid : 0
}

/**
 * Tenders for a POS sale. A credit (udhaar) sale takes no money unless an amount is
 * typed in; that amount is cash in the drawer, not "credit".
 */
export function buildSaleTenders({ paymentType, total, receivedAmount, splitPayments = [], singleMethod, provider = null, ref = null, accountId = null }) {
  if (Array.isArray(splitPayments) && splitPayments.length > 0) return splitPayments
  if (paymentType === 'credit') {
    const received = Math.max(0, num(receivedAmount))
    return received > 0
      ? [{ method: 'cash', provider: null, ref: null, amount: received, account_id: accountId }]
      : [{ method: 'credit', provider: null, ref: null, amount: 0, account_id: null }]
  }
  const blank = receivedAmount === '' || receivedAmount === null || receivedAmount === undefined
  return [{ method: singleMethod, provider, ref, amount: blank ? num(total) : num(receivedAmount), account_id: accountId }]
}

/** Applies tenders to a bill in order; nothing is applied beyond the bill total. */
export function applyTenders(tenders, total) {
  let left = Math.max(0, num(total))
  const applied = (tenders || []).map(t => {
    const amount = roundMoney(Math.min(left, Math.max(0, num(t.amount))))
    left = roundMoney(left - amount)
    return { ...t, amount }
  })
  const tendered = roundMoney((tenders || []).reduce((s, t) => s + Math.max(0, num(t.amount)), 0))
  return { applied, tendered, paid: roundMoney(Math.min(Math.max(0, num(total)), tendered)) }
}

/** An expense paid from the cash drawer after the shift opened. */
export function isCashExpenseInShift(expense, openedAt) {
  const method = String(expense?.payment_method || 'cash').toLowerCase()
  if (method !== 'cash') return false
  const opened = new Date(openedAt).getTime()
  const created = new Date(expense?.created_at).getTime()
  if (Number.isFinite(created) && Number.isFinite(opened)) return created >= opened
  return String(expense?.date || '').slice(0, 10) >= String(openedAt || '').slice(0, 10)
}

/**
 * A supplier-payment row written automatically when a purchase bill was saved. The
 * money is already counted with the purchase itself, so cash totals must skip it.
 */
export function isPurchaseBillPayment(row) {
  if (row?.payment_mode) return false
  const text = `${row?.note || ''} ${row?.description || ''}`
  return Boolean(row?.payment_method) || /\[Paid via|\[Credit Purchase|Payment for Phone Purchase/i.test(text)
}

/** Cash paid to a supplier (or received from a customer) outside a bill. */
export function isCashPartyPayment(row) {
  const type = String(row?.payment_type || 'payment').toLowerCase()
  const mode = String(row?.payment_mode || 'cash').toLowerCase()
  return type === 'payment' && mode === 'cash' && num(row?.amount) > 0
}

/**
 * A likely typing slip: the amount is at least ten times the usual (median) amount of
 * earlier entries of the same kind. Needs five earlier entries before it judges.
 * Returns the usual amount when it looks wrong, otherwise null.
 */
export function unusualAmount(amount, history = []) {
  const value = Math.abs(num(amount))
  const past = history.map(v => Math.abs(num(v))).filter(v => v > 0).sort((a, b) => a - b)
  if (value <= 0 || past.length < 5) return null
  const mid = Math.floor(past.length / 2)
  const median = past.length % 2 ? past[mid] : (past[mid - 1] + past[mid]) / 2
  return value >= median * 10 && value > Math.max(...past) ? roundMoney(median) : null
}


/**
 * Day book: per account, what it opened with, money in and out (grouped by the kind of
 * entry) and what it closed with, from statement rows (oldest first) of one period.
 * Accounts with no entries in the period are listed with their current balance.
 */
export function buildDayBook(rows = [], accounts = []) {
  const byAccount = new Map()
  for (const tx of rows) {
    const key = String(tx.account_id)
    const isIn = tx.transaction_type === 'CREDIT' || ['deposit', 'credit'].includes(String(tx.transaction_type).toLowerCase())
    const amount = Math.abs(num(tx.amount))
    if (!byAccount.has(key)) {
      byAccount.set(key, { account_id: tx.account_id, opening: num(tx.balance_before), closing: num(tx.balance_after), moneyIn: 0, moneyOut: 0, kinds: {}, entries: 0 })
    }
    const acc = byAccount.get(key)
    acc.closing = num(tx.balance_after)
    acc.entries += 1
    if (isIn) acc.moneyIn = roundMoney(acc.moneyIn + amount)
    else acc.moneyOut = roundMoney(acc.moneyOut + amount)
    const kind = String(tx.reference_type || 'manual').toLowerCase()
    const k = acc.kinds[kind] || (acc.kinds[kind] = { in: 0, out: 0 })
    if (isIn) k.in = roundMoney(k.in + amount)
    else k.out = roundMoney(k.out + amount)
  }
  const out = []
  for (const a of accounts) {
    const hit = byAccount.get(String(a.id))
    if (hit) {
      // The statement's own before/after can drift on old data; in/out are exact
      out.push({ ...hit, name: a.account_name, bank: a.bank_name, expectedClosing: roundMoney(hit.opening + hit.moneyIn - hit.moneyOut) })
      byAccount.delete(String(a.id))
    } else {
      const bal = num(a.current_balance)
      out.push({ account_id: a.id, name: a.account_name, bank: a.bank_name, opening: bal, closing: bal, expectedClosing: bal, moneyIn: 0, moneyOut: 0, kinds: {}, entries: 0, idle: true })
    }
  }
  for (const hit of byAccount.values()) {
    out.push({ ...hit, name: `Account #${hit.account_id}`, bank: '', expectedClosing: roundMoney(hit.opening + hit.moneyIn - hit.moneyOut) })
  }
  return out
}

/**
 * True when an account / bank name means physical cash ("Cash", "Cash in Hand",
 * "Shop Cash"). A plain search for "cash" also matched "JazzCash", which made a
 * JazzCash wallet count as the cash drawer and hid it from the bank lists.
 */
export const isCashName = (name) => /(^|[^a-z])cash/i.test(String(name || ''))

/** A cash drawer / cash-in-hand account (not a bank or wallet). */
export const isCashAccount = (acc) =>
  acc?.account_number === 'CASH' || isCashName(acc?.bank_name) || isCashName(acc?.account_name)
