// Sale lines for the Sales page: names, IMEIs, specs, and cost and profit from the shared
// profit rule (src/utils/profit.js), so the Sales page and Reports always agree.
import {
  parseSnapshot, cleanItemName, phoneCostInfo, lineCostParts, billLineProfits, soldQty, costIssue
} from '../../utils/profit.js'
import { isCountedSale } from '../../utils/moneyMath.js'

// A phones row (not a snapshot of one)
const isPhoneRow = (p) => p && p.id != null && p.status != null

export function normalizeSaleItem(it, phonesPool = [], productsPool = [], saleDate = null) {
  const snap = parseSnapshot(it.imei_snapshot)
  const itPhoneId = it.phone_id ? String(it.phone_id) : null
  const itSaleId = it.sale_id ? String(it.sale_id) : null

  // The line's own phone record, for its cost; for display a phone linked to the sale or
  // the snapshot will do
  const phoneRow = (isPhoneRow(it.phones) ? it.phones : null) ||
    (itPhoneId ? (phonesPool || []).find(p => String(p.id) === itPhoneId) : null) || null
  const ph = phoneRow || it.phones ||
    (phonesPool || []).find(p => itSaleId && String(p.sale_id) === itSaleId) || snap
  const prod = it.products?.cost_price != null ? it.products
    : ((productsPool || []).find(p => it.product_id && String(p.id) === String(it.product_id)) || it.products)

  let name = cleanItemName(it.product_name) || cleanItemName(prod?.name)
  if (!name && ph) name = `${ph.brand && ph.brand !== 'Unknown' ? `${ph.brand} ` : ''}${ph.model || 'Smartphone'}`.trim()
  if (!name) name = 'Item'

  const specs = ph ? [ph.storage, ph.color, ph.pta_status, ph.condition].filter(Boolean).join(' · ') : null
  const imei = ph?.imei_1 || ph?.imei || snap?.imei_1 ||
    (typeof it.imei_snapshot === 'string' && !it.imei_snapshot.startsWith('{') ? it.imei_snapshot : null)
  const imei2 = ph?.imei_2 || snap?.imei_2 || null
  const price = Number(it.unit_price ?? (it.price ?? (it.subtotal || 0)))
  const qty = Number(it.quantity || 1)
  const c = lineCostParts(it, snap, phoneCostInfo(phoneRow), Number(prod?.cost_price || 0), saleDate)

  return {
    ...it,
    phones: ph,
    display_name: name,
    specs,
    imei,
    imei2,
    status: ph?.status || null,
    unit_price: price,
    quantity: qty,
    base_cost: c.base,
    direct_cost: c.extras,
    total_cost: c.base + c.extras,
    cost_source: c.source
  }
}

// Lines for a sale saved without any, rebuilt from the phones linked to it
export function recoverSaleItems(s, explicitItems, phonesPool) {
  if (explicitItems && explicitItems.length > 0) return explicitItems
  const linked = (phonesPool || []).filter(p => String(p.sale_id) === String(s.id))
  return linked.map((ph, idx) => {
    const price = Number(ph.sale_price || ph.selling_price || (Number(s.total_amount || 0) / linked.length))
    return {
      id: `rec_${s.id}_${ph.id}_${idx}`,
      sale_id: s.id,
      phone_id: ph.id,
      product_name: `${ph.brand || ''} ${ph.model || 'Smartphone'}`.trim(),
      quantity: 1,
      price,
      unit_price: price,
      cost_price: Number(ph.cost_price || 0),
      additional_costs: Number(ph.additional_costs || 0),
      phones: ph,
      imei_snapshot: {
        imei_1: ph.imei_1, imei_2: ph.imei_2, brand: ph.brand, model: ph.model, color: ph.color,
        storage: ph.storage, condition: ph.condition, pta_status: ph.pta_status
      }
    }
  })
}

// Each line's revenue (after its share of the bill discount), cost and profit
export function lineProfits(sale, items) {
  const rows = billLineProfits(
    (items || []).map(it => ({ line: it, parts: { base: Number(it.base_cost) || 0, extras: Number(it.direct_cost) || 0, source: it.cost_source } })),
    Number(sale?.discount || 0)
  )
  return (items || []).map((it, i) => ({ ...rows[i], item: it, issue: rows[i].qty > 0 ? costIssue({ source: it.cost_source, profit: rows[i].profit, revenue: rows[i].revenue, cost: rows[i].cost }) : null }))
}

export const saleNet = (s) => Math.max(0, Number(s.net_amount ?? (Number(s.total_amount || 0) - Number(s.discount || 0))))

// Totals for one sale: net, paid, due, and profit when its lines are known
export function saleFigures(sale) {
  const net = saleNet(sale)
  const paid = sale.paid_amount != null ? Math.min(Number(sale.paid_amount) || 0, net)
    : sale.amount_paid != null ? Math.min(Number(sale.amount_paid) || 0, net) : net
  const items = sale.sale_items || []
  const lines = items.length ? lineProfits(sale, items) : []
  const kept = lines.filter(l => l.qty > 0)
  return {
    net,
    paid,
    due: Math.max(0, net - paid),
    hasLines: items.length > 0,
    units: items.reduce((s, it) => s + Math.max(0, soldQty(it)), 0),
    revenue: kept.reduce((s, l) => s + l.revenue, 0),
    cost: kept.reduce((s, l) => s + l.cost, 0),
    profit: kept.reduce((s, l) => s + l.profit, 0),
    issues: kept.filter(l => l.issue).length
  }
}

export const isQuotation = (s) => s.sale_type === 'quotation'
export { isCountedSale }

export function invoiceLabel(s) {
  if (isQuotation(s)) return `QT-${String(s.id).slice(-8)}`
  return s.invoice_number || (s.invoice_token ? `INV-${s.invoice_token}` : `#${String(s.id).slice(-8)}`)
}

export function paymentLabel(s) {
  const pt = String(s.payment_type || s.payment_method || 'cash').toLowerCase()
  if (pt === 'split' && Array.isArray(s.payment_details) && s.payment_details.length) {
    return `Split: ${s.payment_details.map(p => p.provider || p.method || 'cash').join(' + ')}`
  }
  if (pt === 'online' && s.online_provider) return `Online · ${s.online_provider}`
  return pt.charAt(0).toUpperCase() + pt.slice(1)
}

export const customerName = (s) => s.customers?.name || s.customer_name || 'Walk-in customer'
