import {
  normalizeDevice,
  conditionLabel,
  conditionTone,
  ptaLabel,
  ptaTone,
  formatImeiGrouped,
  paymentMethodLabel,
  formatRs
} from './deviceLabels'
import { computeExchangeSettlement } from '../services/whatsappQueueService'

/**
 * One description of a customer bill (sale or phone exchange), shared by the online bill
 * (InvoiceDocument) and the PDF export (invoicePdf), so both always show the same numbers.
 */

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 923012345678 / 03012345678 -> 0301-2345678; anything else unchanged. */
export function formatPkMobile(raw) {
  const s = String(raw || '').replace(/[^0-9]/g, '')
  if (/^92\d{10}$/.test(s)) return `0${s.slice(2, 5)}-${s.slice(5)}`
  if (/^0\d{10}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4)}`
  return String(raw || '').trim()
}

function initials(name) {
  const words = String(name || '').replace(/[^A-Za-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean)
  const letters = words.slice(0, 2).map(w => w[0]).join('').toUpperCase()
  return letters || 'EX'
}

function deviceCard(rawItem, { amountLabel, amount, qty = 1, unit = 0 }) {
  const d = normalizeDevice(rawItem)
  const chips = [d.storage, d.color].filter(Boolean).map(text => ({ text, tone: 'plain' }))
  if (qty > 1) chips.push({ text: `Qty ${qty} × ${formatRs(unit)}`, tone: 'plain' })
  const condition = conditionLabel(d.condition, 'en')
  if (condition) chips.push({ text: condition, tone: conditionTone(d.condition) === 'new' ? 'new' : 'used' })
  const pta = ptaLabel(d.pta)
  if (pta) chips.push({ text: pta, tone: ptaTone(d.pta) === 'not' ? 'nonpta' : 'pta' })
  if (d.battery) chips.push({ text: `Battery ${d.battery}%`, tone: 'plain' })
  const imeis = []
  if (d.imei1) imeis.push({ label: 'IMEI 1', value: formatImeiGrouped(d.imei1) })
  if (d.imei2) imeis.push({ label: 'IMEI 2', value: formatImeiGrouped(d.imei2) })
  return { name: d.name, amountLabel, amount, amountText: formatRs(amount), chips, imeis }
}

export function buildInvoiceView(invoice = {}, { billNo, verifyUrl, warrantyText = '' } = {}) {
  const isExchange = invoice.type === 'exchange'
  const shopRaw = invoice.shop || {}
  const shop = {
    name: shopRaw.name || 'EdgeX Mobile Store',
    address: shopRaw.address || '',
    phone: shopRaw.phone || '',
    logo: shopRaw.logo_url || '',
    initials: initials(shopRaw.name || 'EdgeX')
  }
  const date = invoice.created_at
    ? new Date(invoice.created_at).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
    : ''
  const customer = {
    name: invoice.customer_name || 'Valued Customer',
    phone: invoice.customer_phone ? formatPkMobile(invoice.customer_phone) : 'Walk-in'
  }
  const warrantyLines = String(warrantyText || '').split('\n').map(l => l.trim()).filter(Boolean)
  const base = { isExchange, shop, date, billNo, verifyUrl, customer, warrantyLines }

  if (!isExchange) {
    const rawItems = invoice.items || []
    const devices = rawItems.map(item => {
      const qty = Math.max(1, num(item.quantity || item.qty) || 1)
      const unit = num(item.unit_price || item.price || item.sale_price)
      const total = num(item.total ?? item.total_price ?? item.line_total ?? item.subtotal) || unit * qty
      return deviceCard(item, { amountLabel: 'Price', amount: total, qty, unit })
    })
    const itemsSum = devices.reduce((s, d) => s + d.amount, 0)
    const discount = num(invoice.discount)
    const gross = num(invoice.total_amount || invoice.subtotal) || itemsSum || num(invoice.net_amount || invoice.total)
    const candidateNet = num(invoice.net_amount || invoice.total)
    const net = candidateNet > 0 ? candidateNet : Math.max(0, gross - discount)
    const paidRaw = invoice.paid_amount ?? invoice.amount_paid
    const paid = paidRaw === null || paidRaw === undefined || paidRaw === '' ? net : num(paidRaw)
    const balance = Math.max(0, net - paid)
    const change = Math.max(0, paid - net)
    const method = paymentMethodLabel(invoice.payment_type || invoice.payment_method, 'en')
    const account = num(invoice.customer_balance)

    const totals = []
    if (discount > 0 || gross !== net) {
      totals.push({ label: 'Bill total', value: formatRs(gross), kind: 'muted' })
      if (discount > 0) totals.push({ label: 'Discount', value: `- ${formatRs(discount)}`, kind: 'muted' })
    }
    totals.push({ label: 'Payable', value: formatRs(net), kind: 'net' })
    if (paid > 0) totals.push({ label: `Received (${method.toLowerCase()})`, value: formatRs(paid), kind: 'plain' })
    if (change > 0) totals.push({ label: 'Change returned', value: formatRs(change), kind: 'muted' })
    if (balance > 0) totals.push({ label: 'Balance on this bill', value: formatRs(balance), kind: 'bal' })

    const status = balance > 0
      ? { tone: 'due', title: `Balance due: ${formatRs(balance)}`, detail: account > balance ? `Account total ${formatRs(account)}` : `${formatRs(paid)} of ${formatRs(net)} paid` }
      : { tone: 'ok', title: 'Paid in full', detail: `${formatRs(Math.min(paid, net) || net)} received by ${method.toLowerCase()}` }

    return {
      ...base,
      docLabel: 'Sale invoice',
      status,
      parties: [
        { label: 'Customer', value: customer.name },
        { label: 'Mobile', value: customer.phone },
        { label: 'Payment', value: method },
        { label: 'Items', value: `${devices.length} ${devices.length === 1 ? 'item' : 'items'}` }
      ],
      devicesLabel: (() => {
        const allPhones = devices.length > 0 && devices.every(d => d.imeis.length)
        const kind = allPhones ? (devices.length === 1 ? 'Phone sold' : 'Phones sold') : 'Items sold'
        return `${kind} · ${devices.length} ${devices.length === 1 ? 'item' : 'items'}`
      })(),
      devices,
      totals,
      warrantyScope: devices.length > 1 ? 'Applies to the phones above' : 'Applies to the phone above',
      filenameNo: billNo
    }
  }

  // Phone exchange
  const s = computeExchangeSettlement(invoice)
  const method = paymentMethodLabel(s.method, 'en')
  const given = (invoice.outgoing_items || []).map(item => {
    const qty = Math.max(1, num(item.quantity || item.qty) || 1)
    const amount = num(item.subtotal || item.line_total) || num(item.price || item.sale_price || item.assessed_value) * qty
    return deviceCard(item, { amountLabel: 'Price', amount, qty, unit: amount / qty })
  })
  const received = (invoice.incoming_items || []).map(item =>
    deviceCard(item, { amountLabel: 'Credit', amount: num(item.assessed_value || item.trade_in_value || item.subtotal) })
  )

  let who
  let result
  let whoTone = 'ok'
  if (s.dir === 'customer') {
    who = `Customer paid ${formatRs(s.paid)} by ${method.toLowerCase()}`
    if (s.due > 0) { who += `, ${formatRs(s.due)} still to pay`; whoTone = 'due' }
    result = formatRs(s.amount)
  } else if (s.dir === 'shop') {
    who = `Shop paid the customer ${formatRs(s.paid)} by ${method.toLowerCase()}`
    result = `- ${formatRs(s.amount)}`
  } else {
    who = 'Even swap, no money changed hands'
    result = 'Rs. 0'
  }

  return {
    ...base,
    docLabel: 'Phone exchange',
    status: s.due > 0
      ? { tone: 'due', title: `Still to pay: ${formatRs(s.due)}`, detail: `${formatRs(s.paid)} of ${formatRs(s.amount)} paid` }
      : { tone: 'ok', title: 'Exchange completed', detail: s.dir === 'even' ? 'Even swap' : 'Settled in full' },
    parties: [
      { label: 'Customer', value: customer.name },
      { label: 'Mobile', value: customer.phone },
      { label: 'Settlement', value: s.dir === 'even' ? 'None' : method },
      { label: 'Phones', value: `${given.length} given · ${received.length} received` }
    ],
    given,
    received,
    settlement: { sale: formatRs(s.saleAmt), trade: formatRs(s.tradeAmt), result, who, whoTone },
    warrantyScope: 'Applies to the phone given to the customer',
    declaration: 'Trade-in declaration: the customer confirms the traded phone is their legal property, free of iCloud, Google or MDM locks, and is accepted as used goods with no warranty.',
    filenameNo: billNo
  }
}
