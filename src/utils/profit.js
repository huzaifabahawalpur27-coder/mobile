// One profit rule for every screen (Reports, Sales, Excel). Pure: no React, no database.
//
// Profit of a sold item = its sale price, less its share of the bill discount, less what it
// cost: purchase cost + extra costs (repair, PTA, courier ...). Returned units count for
// neither revenue nor cost.
//
// Where the cost comes from, in this order:
//  1. A sold phone: the phone's own record (cost_price + additional_costs), so a corrected
//     cost is used. The record describes THIS sale only while the phone is still sold and
//     was not bought back and sold again since; otherwise step 2.
//  2. The cost saved with the sale. POS saves the purchase cost on the line and the extra
//     costs in imei_snapshot; the phone-sale and exchange database functions save purchase
//     + extra costs together on the line (their snapshot has no additional_costs), so the
//     extras are never added twice. One old version saved only the purchase cost and kept
//     the extras nowhere; then the phone's extras are added.
//  3. Nothing saved: the phone's record, or the product's current cost.

export const COST_SOURCE = {
  phone: 'Phone record',
  saved: 'Saved with the sale',
  'saved+extras': 'Saved with the sale + phone extra costs',
  'phone-fallback': 'Phone record (none saved with the sale)',
  product: "Product's current cost (none saved with the sale)",
  none: 'No cost recorded'
}

export const localDay = (d) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

export function parseSnapshot(snap) {
  if (!snap) return null
  if (typeof snap === 'object') return snap
  try {
    const parsed = JSON.parse(snap)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

// POS names phones "... [IMEI: 35...]"; show the name without it
export const cleanItemName = (name) => String(name || '').replace(/\s*[([]?\s*IMEI[:\s]+[0-9/,\s]+[)\]]?/gi, '').trim()

// The parts of a phones row the rule needs
export function phoneCostInfo(p) {
  if (!p) return null
  return {
    baseCost: Number(p.cost_price || 0),
    directCost: Number(p.additional_costs || 0),
    status: p.status,
    purchaseDate: p.purchase_date || null,
    soldAt: p.sold_at || null
  }
}

export function phoneRecordFitsSale(phone, saleDate) {
  if (!phone || !saleDate || phone.status !== 'sold') return false
  if (phone.purchaseDate && String(phone.purchaseDate).slice(0, 10) > localDay(saleDate)) return false
  if (phone.soldAt && new Date(phone.soldAt) - new Date(saleDate) > 30 * 60 * 1000) return false
  return true
}

// Unit cost of a sold line: { base, extras, source }. `phone` is phoneCostInfo(...) of the
// line's phone (or null), `productCost` the product's current cost.
export function lineCostParts(line, snap, phone = null, productCost = 0, saleDate = null) {
  if (phoneRecordFitsSale(phone, saleDate)) {
    return { base: Number(phone.baseCost) || 0, extras: Number(phone.directCost) || 0, source: 'phone' }
  }
  const lineCost = Number(line?.cost_price) > 0 ? Number(line.cost_price) : null
  const snapCost = snap && Number(snap.cost_price) > 0 ? Number(snap.cost_price) : null
  if (lineCost !== null || snapCost !== null) {
    const lineExtras = Number(line?.additional_costs) > 0 ? Number(line.additional_costs) : null
    const snapExtras = snap && snap.additional_costs != null ? (Number(snap.additional_costs) || 0) : 0
    if (lineExtras === null && !(snap && snap.additional_costs != null) && lineCost !== null &&
        phone && Number(phone.directCost) > 0 && Math.abs(lineCost - Number(phone.baseCost)) < 0.5) {
      return { base: lineCost, extras: Number(phone.directCost), source: 'saved+extras' }
    }
    return { base: lineCost ?? snapCost, extras: lineExtras ?? snapExtras, source: 'saved' }
  }
  if (phone) return { base: Number(phone.baseCost) || 0, extras: Number(phone.directCost) || 0, source: 'phone-fallback' }
  const pc = Number(productCost) || 0
  return { base: pc, extras: 0, source: pc > 0 ? 'product' : 'none' }
}

export const lineUnitCost = (...args) => { const c = lineCostParts(...args); return c.base + c.extras }

// Units still sold on a line (returned units removed)
export const soldQty = (line) => Number(line.quantity || line.qty || 1) - Number(line.returned_qty || 0)

// Revenue of the part of a sale line still sold: the saved line total covers the whole
// quantity, so a partly returned line counts only its remaining share.
export function soldLineRevenue(line, qty, fallbackUnit = 0) {
  const fullQty = Number(line.quantity || line.qty || 1) || 1
  const unit = Number(line.unit_price) > 0 ? Number(line.unit_price)
    : Number(line.price) > 0 ? Number(line.price) : (Number(fallbackUnit) || 0)
  const full = Number(line.line_total) > 0 ? Number(line.line_total)
    : Number(line.subtotal) > 0 ? Number(line.subtotal) : fullQty * unit
  return full * (qty / fullQty)
}

// Profit of every line of ONE bill, with the bill discount spread over the lines by value.
// lines: [{ line, snap?, phone?, productCost?, fallbackUnit?, parts? }]; returns, per line,
// { qty, gross, discount, revenue, base, extras, cost, profit, source }.
export function billLineProfits(lines, billDiscount = 0, saleDate = null) {
  const rows = lines.map(({ line, snap, phone, productCost, fallbackUnit, parts }) => {
    const qty = Math.max(0, soldQty(line))
    const gross = qty > 0 ? soldLineRevenue(line, qty, fallbackUnit) : 0
    // parts: a unit cost already worked out with lineCostParts
    const c = parts || lineCostParts(line, snap ?? parseSnapshot(line.imei_snapshot), phone, productCost, saleDate)
    return { qty, gross, base: c.base, extras: c.extras, source: c.source }
  })
  const subtotal = rows.reduce((s, r) => s + r.gross, 0)
  const discount = Number(billDiscount) || 0
  return rows.map(r => {
    const share = discount > 0 && subtotal > 0 ? (r.gross / subtotal) * discount : 0
    const revenue = Math.max(0, r.gross - share)
    const cost = r.qty * (r.base + r.extras)
    return { ...r, discount: share, revenue, cost, profit: revenue - cost }
  })
}

// Why an item's profit may be wrong, for the cost check: { level, text } or null.
// level 'problem' = the figure is very likely wrong; 'check' = worth a look.
export function costIssue({ source, profit, revenue, cost }) {
  if (source === 'none' || !(cost > 0)) return { level: 'problem', text: 'No purchase cost recorded, so the whole sale counts as profit' }
  if (profit < 0) return { level: 'problem', text: 'Sold below cost' }
  if (source === 'product') return { level: 'check', text: "Cost was not saved with the sale; today's product cost is used" }
  if (revenue > 0 && profit / revenue > 0.6) return { level: 'check', text: 'Profit is over 60% of the price; check the purchase cost' }
  return null
}
