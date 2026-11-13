// Checks for the shared money rules (src/utils/moneyMath.js). Run: npm test
import assert from 'node:assert/strict'
import {
  roundMoney, isCountedSale, saleBalanceEffect, computeReturn, customerLedgerEffect,
  supplierLedgerEffect, cashPortion, buildSaleTenders, applyTenders,
  isCashExpenseInShift, isPurchaseBillPayment, isCashPartyPayment
} from '../src/utils/moneyMath.js'

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`ok - ${name}`) }

test('roundMoney rounds to paisa without float drift', () => {
  assert.equal(roundMoney(1.005), 1.01)
  assert.equal(roundMoney(0.1 + 0.2), 0.3)
  assert.equal(roundMoney(-2.675), -2.68)
  assert.equal(roundMoney('abc'), 0)
})

test('quotations and voided sales do not count', () => {
  assert.equal(isCountedSale({ sale_type: 'sale' }), true)
  assert.equal(isCountedSale({}), true)
  assert.equal(isCountedSale({ sale_type: 'quotation' }), false)
  assert.equal(isCountedSale({ sale_type: 'sale', status: 'voided' }), false)
  assert.equal(saleBalanceEffect({ sale_type: 'quotation', total_amount: 900, paid_amount: 0 }), 0)
})

test('a sale adds bill minus paid to the customer balance', () => {
  assert.equal(saleBalanceEffect({ total_amount: 1000, discount: 100, paid_amount: 400 }), 500)
  assert.equal(saleBalanceEffect({ net_amount: 500, paid_amount: 1000 }), -500)
})

test('return: cash refund is capped at what was paid, the rest comes off the balance', () => {
  const r = computeReturn({ record: { total_amount: 1000, discount: 0, paid_amount: 400 }, grossReturn: 500 })
  assert.equal(r.cashRefund, 400)
  assert.equal(r.balanceRefund, 100)
  assert.deepEqual(r.update, { total_amount: 500, discount: 0, net_amount: 500, paid_amount: 0, amount_paid: 0 })
  // customer owed 600 before; owes 500 after: 600 - balanceRefund(100) = 500 = new bill - new paid
  assert.equal(600 - r.balanceRefund, r.update.net_amount - r.update.paid_amount)
})

test('return: discount is given back in proportion', () => {
  const r = computeReturn({ record: { total_amount: 1000, discount: 100, paid_amount: 900 }, grossReturn: 250 })
  assert.equal(r.discountReturned, 25)
  assert.equal(r.netReturn, 225)
  assert.equal(r.cashRefund, 225)
  assert.deepEqual(r.update, { total_amount: 750, discount: 75, net_amount: 675, paid_amount: 675, amount_paid: 675 })
})

test('return to balance moves no cash', () => {
  const r = computeReturn({ record: { total_amount: 1000, discount: 0, paid_amount: 1000 }, grossReturn: 500, toBalance: true })
  assert.equal(r.cashRefund, 0)
  assert.equal(r.balanceRefund, 500)
  assert.equal(r.update.paid_amount, 1000)
})

test('full return clears the bill and never goes negative', () => {
  const r = computeReturn({ record: { total_amount: 300, discount: 30, paid_amount: 270 }, grossReturn: 999 })
  assert.deepEqual(r.update, { total_amount: 0, discount: 0, net_amount: 0, paid_amount: 0, amount_paid: 0 })
  assert.equal(r.cashRefund, 270)
})

test('customer ledger: rows add up to the stored balance after a return', () => {
  // sale 1000, paid 400 -> owes 600; later a 500 return: 400 cash back, 100 off the balance
  const sale = { total_amount: 1000, discount: 0, paid_amount: 400 }
  const r = computeReturn({ record: sale, grossReturn: 500 })
  const storedBalance = 600 - r.balanceRefund
  const rows = [
    { type: 'sale', amount: r.update.net_amount, paid_amount: r.update.paid_amount },
    { type: 'return', payment_type: 'return', amount: -r.balanceRefund },
    { type: 'payment', payment_type: 'refund', amount: -r.cashRefund }
  ]
  assert.equal(rows.reduce((s, x) => s + customerLedgerEffect(x), 0), storedBalance)
})

test('customer ledger: payment subtracts, manual sale adds, quotation is ignored', () => {
  assert.equal(customerLedgerEffect({ type: 'payment', payment_type: 'payment', amount: 300 }), -300)
  assert.equal(customerLedgerEffect({ type: 'debit', payment_type: 'debit', amount: 300 }), 300)
  assert.equal(customerLedgerEffect({ type: 'sale', sale_type: 'quotation', amount: 900, paid_amount: 0 }), 0)
  assert.equal(customerLedgerEffect({ payment_type: 'return', amount: -50 }), 0)
})

test('supplier ledger: rows add up to the stored balance after a part-paid return', () => {
  // purchase 1000 paid 400 (payment row 400) -> shop owes 600; 500 returned: 400 cash back, 100 off the balance
  const r = computeReturn({ record: { total_amount: 1000, discount: 0, paid_amount: 400 }, grossReturn: 500 })
  const storedBalance = 600 - r.balanceRefund
  const rows = [
    { type: 'purchase', amount: r.update.net_amount },
    { type: 'payment', payment_type: 'payment', amount: 400 },
    { type: 'return', payment_type: 'return', amount: -r.balanceRefund },
    { type: 'payment', payment_type: 'refund', amount: -r.cashRefund }
  ]
  assert.equal(rows.reduce((s, x) => s + supplierLedgerEffect(x), 0), storedBalance)
})

test('supplier ledger: phone credit note reduces the balance, cash / bank settled return does not', () => {
  assert.equal(supplierLedgerEffect({ type: 'return', payment_type: 'return', payment_mode: 'credit_note', amount: 50000 }), -50000)
  assert.equal(supplierLedgerEffect({ type: 'return', payment_type: 'return', payment_mode: 'cash', amount: 50000 }), 0)
  assert.equal(supplierLedgerEffect({ type: 'return', payment_type: 'return', payment_mode: 'bank', amount: 50000 }), 0)
  assert.equal(supplierLedgerEffect({ type: 'payment', payment_type: 'payment', amount: 700 }), -700)
  assert.equal(supplierLedgerEffect({ type: 'debit', payment_type: 'debit', amount: 700 }), 700)
})

test('credit sale: no money unless an amount is typed, and that amount is cash', () => {
  const none = applyTenders(buildSaleTenders({ paymentType: 'credit', total: 1000, receivedAmount: '', singleMethod: 'credit' }), 1000)
  assert.equal(none.paid, 0)
  const some = buildSaleTenders({ paymentType: 'credit', total: 1000, receivedAmount: '300', singleMethod: 'credit', accountId: 7 })
  assert.deepEqual(some, [{ method: 'cash', provider: null, ref: null, amount: 300, account_id: 7 }])
  assert.equal(applyTenders(some, 1000).paid, 300)
})

test('cash sale: blank received means paid in full; over-tender is not applied beyond the bill', () => {
  const full = applyTenders(buildSaleTenders({ paymentType: 'cash', total: 950, receivedAmount: '', singleMethod: 'cash' }), 950)
  assert.equal(full.paid, 950)
  const over = applyTenders(buildSaleTenders({ paymentType: 'cash', total: 950, receivedAmount: '1000', singleMethod: 'cash' }), 950)
  assert.equal(over.paid, 950)
  assert.equal(over.tendered, 1000)
  assert.equal(over.applied[0].amount, 950)
})

test('split tenders are applied in order up to the bill total', () => {
  const split = [{ method: 'cash', amount: 600 }, { method: 'jazzcash', amount: 600 }]
  const r = applyTenders(buildSaleTenders({ paymentType: 'cash', total: 1000, receivedAmount: '', splitPayments: split, singleMethod: 'cash' }), 1000)
  assert.deepEqual(r.applied.map(t => t.amount), [600, 400])
  assert.equal(r.paid, 1000)
})

test('cash drawer: cash part of each bill', () => {
  assert.equal(cashPortion({ payment_method: 'cash', paid_amount: 500 }), 500)
  assert.equal(cashPortion({ payment_method: 'jazzcash', paid_amount: 500 }), 0)
  assert.equal(cashPortion({ payment_method: 'split', paid_amount: 1000, payment_details: [{ method: 'cash', amount: 600 }, { method: 'jazzcash', amount: 400 }] }), 600)
  assert.equal(cashPortion({ payment_method: 'credit', paid_amount: 300, payment_details: [{ method: 'cash', amount: 300 }] }), 300)
  assert.equal(cashPortion({ payment_method: 'credit', paid_amount: 0, payment_details: [{ method: 'credit', amount: 0 }] }), 0)
  assert.equal(cashPortion({ payment_method: 'quotation', paid_amount: 0 }), 0)
  // cash refunded later lowers paid_amount; the tender list still shows the original
  assert.equal(cashPortion({ payment_method: 'cash', paid_amount: 200, payment_details: [{ method: 'cash', amount: 500 }] }), 200)
  // purchase paid from one bank account keeps an object, not a tender list
  assert.equal(cashPortion({ payment_method: 'bank', paid_amount: 900, payment_details: { bank_account_id: 3 } }), 0)
})

test('cash drawer: expenses and supplier payments', () => {
  const opened = '2026-11-13T09:00:00.000Z'
  assert.equal(isCashExpenseInShift({ payment_method: 'cash', created_at: '2026-11-13T10:00:00.000Z' }, opened), true)
  assert.equal(isCashExpenseInShift({ payment_method: 'cash', created_at: '2026-11-13T08:00:00.000Z' }, opened), false)
  assert.equal(isCashExpenseInShift({ payment_method: 'Meezan Bank', created_at: '2026-11-13T10:00:00.000Z' }, opened), false)
  assert.equal(isCashExpenseInShift({ date: '2026-11-13' }, opened), true)
  assert.equal(isPurchaseBillPayment({ payment_method: 'cash', note: '[Paid via Cash in Hand]' }), true)
  assert.equal(isPurchaseBillPayment({ description: 'Payment for Phone Purchase PR-12 (cash)' }), true)
  assert.equal(isPurchaseBillPayment({ payment_mode: 'cash', note: 'Cash Payment' }), false)
  assert.equal(isCashPartyPayment({ payment_type: 'payment', payment_mode: 'cash', amount: 100 }), true)
  assert.equal(isCashPartyPayment({ payment_type: 'payment', payment_mode: 'jazzcash', amount: 100 }), false)
  assert.equal(isCashPartyPayment({ payment_type: 'refund', amount: -100 }), false)
})

console.log(`\n${passed} checks passed`)
