// Checks for the shared profit rule (src/utils/profit.js). Run: npm test
import assert from 'node:assert/strict'
import {
  lineCostParts, billLineProfits, soldLineRevenue, phoneCostInfo, cleanItemName, parseSnapshot, costIssue
} from '../src/utils/profit.js'

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`ok - ${name}`) }

const saleDate = '2026-11-16T10:00:00.000Z'
const soldPhone = (extra = {}) => phoneCostInfo({ status: 'sold', cost_price: 64000, additional_costs: 2000, purchase_date: '2026-11-01', sold_at: saleDate, ...extra })

test('a sold phone uses its own record: purchase + extra cost, counted once', () => {
  // the database function saved purchase + extra together on the line
  const c = lineCostParts({ cost_price: 66000 }, null, soldPhone(), 0, saleDate)
  assert.deepEqual(c, { base: 64000, extras: 2000, source: 'phone' })
})

test('a corrected phone cost is used for its sale', () => {
  const c = lineCostParts({ cost_price: 66000 }, null, soldPhone({ cost_price: 60000 }), 0, saleDate)
  assert.equal(c.base + c.extras, 62000)
})

test('a phone bought back after the sale keeps the cost saved with the sale', () => {
  const back = soldPhone({ status: 'in_stock', cost_price: 50000, additional_costs: 0 })
  const c = lineCostParts({ cost_price: 66000 }, null, back, 0, saleDate)
  assert.deepEqual(c, { base: 66000, extras: 0, source: 'saved' })
  const resold = soldPhone({ cost_price: 50000, additional_costs: 0, purchase_date: '2026-11-20', sold_at: '2026-11-25T10:00:00Z' })
  assert.equal(lineCostParts({ cost_price: 66000 }, null, resold, 0, saleDate).base, 66000)
})

test('POS line: purchase cost on the line, extra cost in the snapshot', () => {
  const c = lineCostParts({ cost_price: 64000 }, { additional_costs: 2000 }, null, 0, saleDate)
  assert.deepEqual(c, { base: 64000, extras: 2000, source: 'saved' })
})

test('old phone-sale function saved only the purchase cost: the phone extras are added', () => {
  const back = soldPhone({ status: 'in_stock' }) // record does not fit the sale, but its extras still apply
  const c = lineCostParts({ cost_price: 64000 }, null, back, 0, saleDate)
  assert.deepEqual(c, { base: 64000, extras: 2000, source: 'saved+extras' })
})

test('nothing saved: product current cost, or flagged as no cost', () => {
  assert.deepEqual(lineCostParts({ cost_price: 0 }, null, null, 1250, saleDate), { base: 1250, extras: 0, source: 'product' })
  assert.deepEqual(lineCostParts({}, null, null, 0, saleDate), { base: 0, extras: 0, source: 'none' })
})

test('a partly returned line counts only the units kept', () => {
  assert.equal(soldLineRevenue({ quantity: 3, line_total: 3000 }, 2), 2000)
  const [r] = billLineProfits([{ line: { quantity: 3, returned_qty: 1, line_total: 3000, cost_price: 600 } }])
  assert.equal(r.qty, 2); assert.equal(r.revenue, 2000); assert.equal(r.cost, 1200); assert.equal(r.profit, 800)
})

test('the bill discount is spread over the lines by value', () => {
  const rows = billLineProfits([
    { line: { quantity: 1, line_total: 6000, cost_price: 3500 } },
    { line: { quantity: 2, line_total: 2000, cost_price: 600 } }
  ], 500)
  assert.equal(rows[0].discount, 375); assert.equal(rows[1].discount, 125)
  assert.equal(rows[0].profit, 2125); assert.equal(rows[1].profit, 675)
  assert.equal(rows.reduce((s, r) => s + r.revenue, 0), 7500)
})

test('a fully returned line has no revenue, cost or profit', () => {
  const [r] = billLineProfits([{ line: { quantity: 1, returned_qty: 1, line_total: 177000, cost_price: 165000 } }])
  assert.equal(r.revenue, 0); assert.equal(r.cost, 0); assert.equal(r.profit, 0)
})

test('names and snapshots', () => {
  assert.equal(cleanItemName('Apple iPhone 13 Sierra Blue [IMEI: 356789012345678]'), 'Apple iPhone 13 Sierra Blue')
  assert.deepEqual(parseSnapshot('{"imei_1":"35"}'), { imei_1: '35' })
  assert.equal(parseSnapshot('not json'), null)
})

test('the cost check flags missing costs, losses and guessed costs', () => {
  assert.equal(costIssue({ source: 'none', profit: 1000, revenue: 1000, cost: 0 }).level, 'problem')
  assert.equal(costIssue({ source: 'saved', profit: -250, revenue: 1000, cost: 1250 }).text, 'Sold below cost')
  assert.equal(costIssue({ source: 'product', profit: 300, revenue: 1000, cost: 700 }).level, 'check')
  assert.equal(costIssue({ source: 'phone', profit: 12000, revenue: 177000, cost: 165000 }), null)
})

console.log(`\n${passed} profit checks passed`)
