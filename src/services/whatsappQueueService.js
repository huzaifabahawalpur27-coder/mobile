import { supabase } from './supabase.js'
import { db } from './db.js'
import { normalizeDevice, conditionLabel, ptaLabel, paymentMethodLabel, formatRs } from '../utils/deviceLabels.js'

export function cleanPakistanPhone(rawPhone) {
  if (!rawPhone) return ''
  const cleaned = String(rawPhone).replace(/[^0-9]/g, '')
  if (cleaned.startsWith('03') && cleaned.length === 11) {
    return '92' + cleaned.substring(1)
  }
  if (cleaned.length === 10 && cleaned.startsWith('3')) {
    return '92' + cleaned
  }
  if (cleaned.startsWith('923') && cleaned.length === 12) {
    return cleaned
  }
  return cleaned
}

export const DEFAULT_WARRANTY_TERMS_URDU = `⚠️ *وارنٹی شرائط (Warranty Terms):*
۱۔ LCD، فیس لاک اور کیمرے کی کوئی وارنٹی نہیں ہوگی۔
۲۔ موبائل ڈیڈ ہونے کی صورت میں کوئی وارنٹی یا واپسی قبول نہیں کی جائے گی۔
۳۔ سیکنڈ ہینڈ موبائل کی کوئی وارنٹی نہیں ہوگی۔`.trim()

export const DEFAULT_WARRANTY_TERMS_ENGLISH = `⚠️ *Warranty Terms:*
1. No warranty for LCD, Face Lock, and Cameras.
2. No warranty or return accepted if the phone becomes dead.
3. No warranty on second-hand mobile devices.`.trim()

/**
 * Generates an unguessable 8-character uppercase alphanumeric random token
 * for invoices to prevent enumeration/IDOR attacks on incremental IDs.
 */
export function generateRandomInvoiceToken() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  let token = ''
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    for (let i = 0; i < 8; i++) {
      token += chars[bytes[i] % chars.length]
    }
  } else {
    for (let i = 0; i < 8; i++) {
      token += chars[Math.floor(Math.random() * chars.length)]
    }
  }
  return token
}

/**
 * Normalizes a stored invoice token ("INV-8K3P9X2M", "exc-3a9f0c1b", "8K3P9X2M")
 * to its bare uppercase form. Returns null for anything that is not a real
 * unguessable token (empty, purely numeric/sequential like "156" or "EXC-00012").
 *
 * Links must only ever be built from a token the server has stored; a token
 * invented on the client resolves to "Invoice not found" for the customer.
 */
export function normalizeInvoiceToken(raw) {
  if (raw === null || raw === undefined) return null
  const bare = String(raw).trim().replace(/^#/, '').replace(/^(INV|EXC)-/i, '').toUpperCase()
  if (!/^[A-Z0-9]{8,64}$/.test(bare)) return null
  if (/^\d+$/.test(bare)) return null
  return bare
}

/**
 * Reads the invoice token the server actually stored for a sale or exchange.
 */
export async function fetchServerInvoiceToken(table, id) {
  if (!id || (table !== 'sales' && table !== 'exchanges')) return null
  try {
    // Older sales keep their public code only in invoice_number; the public RPC matches
    // both columns, so either is a working link.
    const withNumber = table === 'sales'
    let { data, error } = await supabase.from(table).select(withNumber ? 'invoice_token, invoice_number' : 'invoice_token').eq('id', id).maybeSingle()
    if (error && withNumber && /invoice_number/.test(error.message || '')) {
      ;({ data, error } = await supabase.from(table).select('invoice_token').eq('id', id).maybeSingle())
    }
    if (error) {
      console.warn(`fetchServerInvoiceToken(${table}, ${id}):`, error.message || error)
      return null
    }
    return normalizeInvoiceToken(data?.invoice_token) || normalizeInvoiceToken(data?.invoice_number)
  } catch (err) {
    console.warn(`fetchServerInvoiceToken(${table}, ${id}):`, err)
    return null
  }
}

/**
 * Ensures a sale created by a server RPC carries the given token (the RPC does not
 * accept one, so the row gets a database default). Returns the token that is really
 * stored on the server, or null when it cannot be confirmed.
 */
export async function persistSaleInvoiceToken(saleId, preferredToken) {
  if (!saleId) return null
  const token = normalizeInvoiceToken(preferredToken)
  if (token) {
    try {
      const { data, error } = await supabase
        .from('sales')
        .update({ invoice_token: token, invoice_number: `INV-${token}` })
        .eq('id', saleId)
        .select('invoice_token')
        .maybeSingle()
      if (!error && normalizeInvoiceToken(data?.invoice_token) === token) return token
      if (error) console.warn('persistSaleInvoiceToken update failed, reading server token:', error.message || error)
    } catch (err) {
      console.warn('persistSaleInvoiceToken update failed, reading server token:', err)
    }
  }
  return fetchServerInvoiceToken('sales', saleId)
}

const PLACEHOLDER_NAMES = ['walk-in customer', 'walk-in', 'valued customer', 'customer', '']

/** True for real customer names (not "Walk-in Customer", "Valued Customer", blank). */
export function isRealCustomerName(name) {
  return !PLACEHOLDER_NAMES.includes(String(name || '').trim().toLowerCase())
}

/**
 * Writes the customer's name and phone onto a sale row. Some process_phone_sale versions
 * (and POS's fallback call) never store them, so the customer's bill showed
 * "Valued Customer / Walk-in". Placeholder names are never written. Best-effort:
 * returns true when the row was updated.
 */
export async function persistSaleCustomerDetails(saleId, { name, phone } = {}) {
  if (!saleId || !/^\d+$/.test(String(saleId))) return false
  const patch = {}
  if (isRealCustomerName(name)) patch.customer_name = String(name).trim()
  const cleanPhone = String(phone || '').replace(/[^0-9+]/g, '')
  if (cleanPhone.length >= 10) patch.customer_phone = cleanPhone
  if (Object.keys(patch).length === 0) return false
  try {
    let { error } = await supabase.from('sales').update(patch).eq('id', saleId)
    if (error && patch.customer_phone && /customer_phone/.test(error.message || '')) {
      // Older schema without customer_phone: still save the name
      delete patch.customer_phone
      if (!patch.customer_name) return false
      ;({ error } = await supabase.from('sales').update(patch).eq('id', saleId))
    }
    if (error) {
      console.warn('persistSaleCustomerDetails:', error.message || error)
      return false
    }
    return true
  } catch (err) {
    console.warn('persistSaleCustomerDetails:', err)
    return false
  }
}

/**
 * Rewrites every public invoice URL and the invoice-number line in a message so they
 * point at the given (server-verified) token. Used to repair messages created with a
 * client-only or corrupted token.
 */
export function repairInvoiceLinkInText(text, token, kind = 'sale') {
  const clean = normalizeInvoiceToken(token)
  if (!text || !clean) return text || ''
  const prefix = kind === 'exchange' ? 'EXC' : 'INV'
  const publicNo = `${prefix}-${clean}`
  const url = buildPublicInvoiceUrl(publicNo)
  let updated = text.replace(/https?:\/\/[^\s]*\/(?:view-)?invoice\/[^\s]+/gi, url)
  updated = updated.replace(/(انوائس\s*نمبر\s*:\s*)(?:INV|EXC)-[A-Z0-9]+/gi, `$1${publicNo}`)
  updated = updated.replace(/(Invoice\s*#\s*:\s*)(?:INV|EXC)-[A-Z0-9]+/gi, `$1${publicNo}`)
  if (!updated.includes(url)) {
    updated = replaceOrInjectInvoiceLinkInTemplate(updated, url)
  }
  return updated
}

/**
 * Removes the online-invoice link block (header line + placeholder/URL) when no
 * verified token exists yet, so customers never receive a dead link.
 */
function stripInvoiceLinkBlock(text) {
  if (!text) return ''
  return text
    .replace(/\n*🔗[^\n]*\n\s*\[(?:Invoice Link|Invoice URL|Link|URL)\][^\n]*/g, '')
    .replace(/\[(?:Invoice Link|Invoice URL|Link|URL)\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
}

/**
 * Public address customers open their bill on. Fixed (not the cashier's current address)
 * so links sent from localhost, a preview deploy or another domain still work for the
 * customer. Override per deployment with VITE_PUBLIC_INVOICE_ORIGIN.
 */
export const PUBLIC_INVOICE_ORIGIN = (() => {
  let configured = ''
  try {
    configured = (import.meta && import.meta.env && import.meta.env.VITE_PUBLIC_INVOICE_ORIGIN) || ''
  } catch (_) { /* non-Vite runtime */ }
  return String(configured || 'https://mobile.edgexsuite.com').trim().replace(/\/+$/, '')
})()

/**
 * Constructs the canonical public digital invoice link for WhatsApp messages.
 */
export function buildPublicInvoiceUrl(referenceId) {
  if (!referenceId) return ''
  const clean = String(referenceId).trim()
  return `${PUBLIC_INVOICE_ORIGIN}/invoice/${encodeURIComponent(clean)}`
}

/**
 * Injects or replaces the online digital invoice link in any WhatsApp message template.
 * Uses high-res regex to anchor right above the warranty section in any language/spacing.
 */
export function replaceOrInjectInvoiceLinkInTemplate(template, invoiceUrl) {
  if (!template || !invoiceUrl) return template || ''
  if (template.includes(invoiceUrl)) return template

  const linkBlock = `🔗 *آن لائن بل و پی ڈی ایف رسید (View & Download PDF):*\n${invoiceUrl}`

  if (template.includes('[Invoice Link]') || template.includes('[Link]') || template.includes('[URL]')) {
    return template
      .replace(/\[Invoice Link\]/g, invoiceUrl)
      .replace(/\[Link\]/g, invoiceUrl)
      .replace(/\[URL\]/g, invoiceUrl)
  }

  // Regex to find warranty header (handles any spacing, asterisks, emoji)
  const warrantyRegex = /(\n\s*(?:⚠️\s*)?\*?وارنٹی\s*شرائط[\s\S]*)/i
  const warrantyEngRegex = /(\n\s*(?:⚠️\s*)?\*?Warranty\s*Terms[\s\S]*)/i
  const warrantyTagRegex = /(\n\s*\[Warranty\s*(?:Terms)?\][\s\S]*)/i

  if (warrantyRegex.test(template)) {
    return template.replace(warrantyRegex, `\n\n${linkBlock}\n$1`).trim()
  }
  if (warrantyEngRegex.test(template)) {
    return template.replace(warrantyEngRegex, `\n\n${linkBlock}\n$1`).trim()
  }
  if (warrantyTagRegex.test(template)) {
    return template.replace(warrantyTagRegex, `\n\n${linkBlock}\n$1`).trim()
  }

  // Fallback: before footer greetings
  const footerRegex = /(\n\s*(?:آپ\s*کے\s*اعتماد|Thank\s*you|Shukriya|شکریہ|🏪|📞)[\s\S]*)/i
  if (footerRegex.test(template)) {
    return template.replace(footerRegex, `\n\n${linkBlock}\n$1`).trim()
  }

  return `${template.trim()}\n\n${linkBlock}`.trim()
}

/** Built-in sale template before Nov 2026 (kept to upgrade unedited copies). */
const LEGACY_DEFAULT_INVOICE_TEMPLATE_V1 = `السلام علیکم [Name]! 🤝
*[Shop Name]* سے خریداری کرنے کا بہت بہت شکریہ!

🧾 *بل کی تفصیلات (Invoice Details)*
📄 انوائس نمبر: INV-[ID]
📅 تاریخ: [Date]

📱 *خریدی گئی اشیاء:*
[Items]

💰 *ادائیگی کا خلاصہ:*
• کل رقم (Total): Rs. [Total]
• وصول رقم (Paid): Rs. [Paid]
• بقایا کھاتہ (Balance): Rs. [Balance]

🔗 *آن لائن بل و پی ڈی ایف رسید (View & Download PDF):*
[Invoice Link]

[Warranty Terms]

آپ کے اعتماد اور تعاون کا شکریہ! 🤝
🏪 *[Shop Name]*
📞 رابطہ: [Phone]`.trim()

/**
 * Default WhatsApp sale receipt (Urdu). Bill number, phone, money and the bill link come
 * first; the balance lines appear only when something is owed ([Payment Summary]).
 */
export const DEFAULT_PROFESSIONAL_INVOICE_TEMPLATE = `السلام علیکم [Name]! 🤝
*[Shop Name]* سے خریداری کا شکریہ۔

🧾 *بل نمبر:* [Invoice ID]
📅 *تاریخ:* [Date]

📱 *آپ کا فون*
[Items]

💰 *ادائیگی*
[Payment Summary]

🔗 *اپنا بل اور PDF رسید یہاں دیکھیں:*
[Invoice Link]

[Warranty Terms]

شکریہ! دوبارہ تشریف لائیں۔
📍 [Shop Address]
📞 [Phone]`.trim()

/** Default WhatsApp sale receipt (English). */
export const DEFAULT_PROFESSIONAL_INVOICE_TEMPLATE_EN = `Assalam-o-Alaikum [Name]! 🤝
Thank you for shopping at *[Shop Name]*.

🧾 *Bill No:* [Invoice ID]
📅 *Date:* [Date]

📱 *Your phone*
[Items]

💰 *Payment*
[Payment Summary]

🔗 *View your bill & PDF receipt:*
[Invoice Link]

[Warranty Terms]

Thank you, see you again!
📍 [Shop Address]
📞 [Phone]`.trim()

const LEGACY_SALE_DEFAULTS = [LEGACY_DEFAULT_INVOICE_TEMPLATE_V1]

const URDU_RE = /[؀-ۿ]/
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 'ur' when the template's own wording (placeholders aside) is Urdu. */
function templateLanguage(template) {
  return URDU_RE.test(String(template || '').replace(/\[[^\]]*\]/g, '')) ? 'ur' : 'en'
}

function normalizeTemplateText(t) {
  return String(withWarrantyPlaceholder(t) || '').replace(/\r\n/g, '\n').trim()
}

/** True when a saved template is one of our earlier built-in defaults, unedited. */
export function isOldDefaultSaleTemplate(template) {
  if (!template) return false
  const t = normalizeTemplateText(template)
  return LEGACY_SALE_DEFAULTS.some(d => normalizeTemplateText(d) === t)
}

/**
 * Settings helper: replaces an unedited earlier built-in default with the current one,
 * so shops that never customised their template get the new format automatically.
 */
export function upgradeDefaultTemplate(template, kind = 'sale') {
  if (!template) return template
  if (kind === 'exchange') return isOldDefaultExchangeTemplate(template) ? DEFAULT_EXCHANGE_WHATSAPP_TEMPLATE : template
  if (isLegacyEnglishInvoiceTemplate(template) || isOldDefaultSaleTemplate(template)) return DEFAULT_PROFESSIONAL_INVOICE_TEMPLATE
  return template
}

/** Lines for one phone or item: name · storage · colour, IMEIs, condition/PTA, amount. */
function deviceBlockLines(rawItem, { lang, amountLabel, amount, qty = 1 }) {
  const d = normalizeDevice(rawItem)
  const lines = [[`*${d.name}*`, d.storage, d.color].filter(Boolean).join(' · ')]
  if (d.imei1) lines.push(`IMEI 1: \`\`\`${d.imei1}\`\`\``)
  if (d.imei2) lines.push(`IMEI 2: \`\`\`${d.imei2}\`\`\``)
  const state = [
    conditionLabel(d.condition, lang),
    ptaLabel(d.pta),
    d.battery ? (lang === 'ur' ? `بیٹری ${d.battery}%` : `Battery ${d.battery}%`) : ''
  ].filter(Boolean).join(' · ')
  if (state) lines.push(`${lang === 'ur' ? 'حالت' : 'Condition'}: ${state}`)
  const q = Math.max(1, num(qty) || 1)
  lines.push(`${amountLabel}: ${q > 1 ? `${q} × ${formatRs(amount / q)} = ${formatRs(amount)}` : formatRs(amount)}`)
  return lines
}

function saleItemAmount(i) {
  const qty = Math.max(1, num(i.qty || i.quantity) || 1)
  const unit = num(i.custom_price || i.sale_price || i.unit_price || i.price)
  const line = num(i.total || i.line_total || i.subtotal || i.total_price)
  return { qty, amount: line > 0 ? line : unit * qty }
}

function saleItemsText(items, lang) {
  if (!items || items.length === 0) return lang === 'ur' ? 'موبائل / سامان' : 'Phone / accessory'
  return items.map(i => {
    const { qty, amount } = saleItemAmount(i)
    return deviceBlockLines(i, { lang, amountLabel: lang === 'ur' ? 'قیمت' : 'Price', amount, qty }).join('\n')
  }).join('\n\n')
}

/**
 * Money for a sale. `customer.outstanding_balance` is the account balance before this bill
 * (as POS passes it), so the account total adds this bill's remaining amount.
 */
function computeSalePayment({ sale = {}, customer = null, items = [] }) {
  const itemsSum = items.reduce((s, i) => s + saleItemAmount(i).amount, 0)
  const subtotal = num(sale.total_amount ?? sale.subtotal) || itemsSum
  const discount = num(sale.discount ?? sale.totalDiscount)
  const payable = num(sale.net_amount ?? sale.total) || Math.max(0, subtotal - discount)
  const receivedRaw = sale.receivedAmount ?? sale.paid_amount ?? sale.amount_paid
  const received = receivedRaw === null || receivedRaw === undefined || receivedRaw === '' ? payable : num(receivedRaw)
  const change = num(sale.changeDue) > 0 ? num(sale.changeDue) : Math.max(0, received - payable)
  const billBalance = Math.max(0, payable - received)
  const prior = Math.max(0, num(customer?.outstanding_balance ?? customer?.balance))
  return {
    subtotal, discount, payable, received, change, billBalance, prior,
    accountTotal: prior + billBalance,
    method: sale.payment_method || sale.payment_type || sale.paymentType || 'cash'
  }
}

function salePaymentLines(p, lang) {
  const method = paymentMethodLabel(p.method, lang)
  const L = []
  if (lang === 'ur') {
    if (p.discount > 0) L.push(`کل بل: ${formatRs(p.subtotal)}`, `رعایت: − ${formatRs(p.discount)}`)
    L.push(`*قابلِ ادا: ${formatRs(p.payable)}*`)
    if (p.received > 0) L.push(`وصول (${method}): ${formatRs(p.received)}`)
    if (p.change > 0) L.push(`واپس کیے: ${formatRs(p.change)}`)
    L.push(p.billBalance > 0 ? `⏳ *اس بل کی باقی رقم: ${formatRs(p.billBalance)}*` : '✅ *مکمل ادائیگی ہو گئی*')
    if (p.prior > 0) L.push(`📒 کھاتے میں کل بقایا: ${formatRs(p.accountTotal)}`)
  } else {
    if (p.discount > 0) L.push(`Bill total: ${formatRs(p.subtotal)}`, `Discount: − ${formatRs(p.discount)}`)
    L.push(`*Payable: ${formatRs(p.payable)}*`)
    if (p.received > 0) L.push(`Received (${method}): ${formatRs(p.received)}`)
    if (p.change > 0) L.push(`Change returned: ${formatRs(p.change)}`)
    L.push(p.billBalance > 0 ? `⏳ *Balance on this bill: ${formatRs(p.billBalance)}*` : '✅ *Paid in full*')
    if (p.prior > 0) L.push(`📒 Total account balance: ${formatRs(p.accountTotal)}`)
  }
  return L
}

/** Drops contact lines whose value turned out empty (e.g. no shop address saved). */
function tidyRenderedMessage(text) {
  return String(text || '')
    .replace(/^[ \t]*(?:📍|📞)[ \t]*(?:رابطہ:|Contact:)?[ \t]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function formatMessageDate(value) {
  const d = value ? new Date(value) : new Date()
  return (Number.isNaN(d.getTime()) ? new Date() : d).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Shop bill number (INV-156) shown everywhere; the link keeps the private token. */
function saleBillNumber(sale, token) {
  if (sale?.id !== undefined && sale?.id !== null && /^\d+$/.test(String(sale.id))) return `INV-${sale.id}`
  return token ? `INV-${token}` : ''
}

/**
 * Puts the shop's saved warranty terms into a rendered message:
 * - a standard warranty section ("⚠️ *وارنٹی شرائط…" / "⚠️ *Warranty Terms…", e.g. the
 *   3-point copy baked into old templates) is REPLACED with the saved terms;
 * - a message with no warranty text gets the saved terms added before the footer;
 * - a template's own differently-worded terms are left as the shop wrote them.
 * (A plain "already contains the terms" check is wrong here: the 2-point text is a
 * prefix of the 3-point text, so it would wrongly report the new terms as present.)
 */
function applyShopWarranty(text, terms) {
  if (!text || !terms) return text
  const hasStandardSection = /⚠️\s*\*(?:وارنٹی شرائط|Warranty Terms)/i.test(text)
  if (hasStandardSection || !hasWarrantyTerms(text)) return replaceOrInjectWarrantyInTemplate(text, terms)
  return text
}

/**
 * Templates saved before the [Warranty Terms] placeholder existed carry a hard-coded copy
 * of the built-in 3-point warranty. Swap exactly that block for the placeholder so the
 * template follows the terms saved in Settings. Custom wording is left untouched.
 */
export function withWarrantyPlaceholder(template) {
  if (!template) return template
  const normalized = String(template).replace(/\r\n/g, '\n')
  return normalized.includes(DEFAULT_WARRANTY_TERMS_URDU)
    ? normalized.split(DEFAULT_WARRANTY_TERMS_URDU).join('[Warranty Terms]')
    : template
}

/**
 * Checks whether a message text already contains warranty terms.
 */
export function hasWarrantyTerms(text) {
  if (!text) return false
  const lower = String(text).toLowerCase()
  return (
    lower.includes('وارنٹی') ||
    lower.includes('warranty') ||
    lower.includes('lcd') ||
    lower.includes('فیس لاک') ||
    lower.includes('ڈیڈ ہونے کی صورت')
  )
}

/**
 * Detects legacy English templates or rendered messages that were missing warranty terms.
 */
export function isLegacyEnglishInvoiceTemplate(text) {
  if (!text) return false
  const lower = String(text).toLowerCase()
  return (
    (lower.includes('hello [name]') && lower.includes('thank you for shopping')) ||
    (lower.includes('your bill summary for invoice') && lower.includes('thank you for your business')) ||
    (lower.includes('thank you for shopping at') && lower.includes('bill summary for invoice')) ||
    (lower.includes('hello ') && lower.includes('thank you for shopping at') && lower.includes('bill summary for invoice'))
  )
}

/**
 * Upgrades a legacy English WhatsApp message or missing warranty terms into the professional Urdu format.
 */
export function upgradeLegacyWhatsAppMessage(text, shopId, referenceData = null) {
  if (!text) return text
  const warranty = getShopWarrantyTerms(shopId)

  // Only a token the server stored may be used for the link; never invent one.
  const isExchange = Boolean(referenceData?.is_exchange)
  const token = normalizeInvoiceToken(referenceData?.invoice_token) ||
    normalizeInvoiceToken(referenceData?.invoice_number) ||
    normalizeInvoiceToken(referenceData?.reference_id)
  const publicInvoiceNo = token
    ? `${isExchange ? 'EXC' : 'INV'}-${token}`
    : (referenceData?.sale_id ? `INV-${referenceData.sale_id}` : '')

  // If text is the legacy English stub, rebuild it into the Urdu professional receipt
  if (isLegacyEnglishInvoiceTemplate(text)) {
    const custMatch = text.match(/Hello\s+([^,!\n]+)/i)
    const customerName = custMatch ? custMatch[1].trim() : (referenceData?.recipient_name || 'Valued Customer')

    const shopMatch = text.match(/thank you for shopping at\s+([^!\n]+)/i)
    const shopName = shopMatch ? shopMatch[1].trim() : (shopId ? localStorage.getItem(`shop_name_${shopId}`) : null) || 'EdgeX Mobile Store'

    const amtMatch = text.match(/Rs\.\s*([\d,]+)/i)
    const amountStr = amtMatch ? amtMatch[1] : (referenceData?.total ? Number(referenceData.total).toLocaleString('en-PK') : '0')

    const modelMatch = text.match(/📱\s*Model:\s*([^\n]+)/i)
    const modelStr = modelMatch ? modelMatch[1].trim() : 'Phone / Device'

    const dateMatch = text.match(/📅\s*Date:\s*([^\n]+)/i)
    const dateStr = dateMatch ? dateMatch[1].trim() : new Date().toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })

    const paidStr = referenceData?.paid ? Number(referenceData.paid).toLocaleString('en-PK') : amountStr
    const invoiceUrl = token ? buildPublicInvoiceUrl(publicInvoiceNo) : ''
    const linkBlock = invoiceUrl
      ? `\n🔗 *آن لائن بل و پی ڈی ایف رسید (View & Download PDF):*\n${invoiceUrl}\n`
      : ''
    const invoiceLine = publicInvoiceNo ? `\n📄 انوائس نمبر: ${publicInvoiceNo}` : ''

    return `السلام علیکم ${customerName}! 🤝
*${shopName}* سے خریداری کرنے کا بہت بہت شکریہ!

🧾 *بل کی تفصیلات (Invoice Details)*${invoiceLine}
📅 تاریخ: ${dateStr}

📱 *خریدی گئی اشیاء:*
1. ${modelStr} = Rs. ${amountStr}

💰 *ادائیگی کا خلاصہ:*
• کل رقم (Total): Rs. ${amountStr}
• وصول رقم (Paid): Rs. ${paidStr}
• بقایا کھاتہ (Balance): Rs. 0 (مکمل کلیئر ✅)
${linkBlock}
${warranty}

آپ کے اعتماد اور تعاون کا شکریہ! 🤝
🏪 *${shopName}*`
  }

  let result = text

  // 1. Ensure the online invoice link is present, but only for a server-stored token
  if (token && !result.includes('/invoice/')) {
    result = replaceOrInjectInvoiceLinkInTemplate(result, buildPublicInvoiceUrl(publicInvoiceNo))
  }

  // 3. Ensure shop warranty terms are present
  if (!hasWarrantyTerms(result)) {
    result = replaceOrInjectWarrantyInTemplate(result, warranty)
  }

  return result
}

/**
 * Renders a WhatsApp sale template (the shop's own from Settings, or a built-in default).
 * Unedited earlier defaults are upgraded to the current default first.
 */
export function renderCustomWhatsAppTemplate(template, { sale, customer, items = [], shopInfo = {} }) {
  if (!template) return ''
  const shopId = shopInfo.id || shopInfo.shop_id || sale?.shop_id
  const effectiveWarranty = shopInfo.warranty_terms || (shopId ? getShopWarrantyTerms(shopId) : DEFAULT_WARRANTY_TERMS_URDU)

  const targetTemplate = (isLegacyEnglishInvoiceTemplate(template) || isOldDefaultSaleTemplate(template))
    ? DEFAULT_PROFESSIONAL_INVOICE_TEMPLATE
    : template
  const lang = templateLanguage(targetTemplate)

  const customerName = customer?.name || sale?.customer_name || sale?.walkInName || 'Valued Customer'
  const shopName = shopInfo.name || (shopId ? localStorage.getItem(`shop_name_${shopId}`) : null) || 'EdgeX Mobile Store'
  const shopPhone = shopInfo.phone || shopInfo.mobile || ''
  const shopAddress = shopInfo.address || ''
  const invoiceToken = normalizeInvoiceToken(sale?.invoice_token) || normalizeInvoiceToken(sale?.invoice_number)
  const billNo = saleBillNumber(sale, invoiceToken)
  const pay = computeSalePayment({ sale: sale || {}, customer, items })
  const cleared = lang === 'ur' ? '0 (مکمل کلیئر ✅)' : '0 (cleared ✅)'
  const modelText = items.map(i => {
    const d = normalizeDevice(i)
    return `${d.name}${d.imei1 ? ` [${d.imei1}]` : ''}`
  }).filter(Boolean).join(', ') || 'Phone/Accessory'

  let rendered = targetTemplate
    .replace(/\[Name\]/g, customerName)
    .replace(/\[Customer Name\]/g, customerName)
    .replace(/\[Shop Name\]/g, shopName)
    .replace(/\[Shop Address\]/g, shopAddress)
    .replace(/\[ID\]/g, billNo.replace(/^INV-/, ''))
    .replace(/\[Invoice ID\]/g, billNo)
    .replace(/\[Date\]/g, formatMessageDate(sale?.created_at))
    .replace(/\[Items\]/g, saleItemsText(items, lang))
    .replace(/\[Model\]/g, modelText)
    .replace(/\[Amount\]/g, pay.payable.toLocaleString('en-PK'))
    .replace(/\[Total\]/g, pay.payable.toLocaleString('en-PK'))
    .replace(/\[Paid\]/g, pay.received.toLocaleString('en-PK'))
    .replace(/\[Balance\]/g, pay.accountTotal > 0 ? pay.accountTotal.toLocaleString('en-PK') : cleared)
    .replace(/\[Payment Summary\]/g, salePaymentLines(pay, lang).join('\n'))
    .replace(/\[Warranty Terms\]/g, effectiveWarranty)
    .replace(/\[Warranty\]/g, effectiveWarranty)
    .replace(/\[Shop Phone\]/g, shopPhone)
    .replace(/\[Phone\]/g, shopPhone)

  // Online invoice & PDF link, only for a server-stored token
  if (invoiceToken) {
    const invoiceUrl = buildPublicInvoiceUrl(`INV-${invoiceToken}`)
    rendered = rendered
      .replace(/\[Invoice Link\]/g, invoiceUrl)
      .replace(/\[Invoice URL\]/g, invoiceUrl)
      .replace(/\[Link\]/g, invoiceUrl)
      .replace(/\[URL\]/g, invoiceUrl)
    if (!rendered.includes(invoiceUrl)) rendered = replaceOrInjectInvoiceLinkInTemplate(rendered, invoiceUrl)
  } else {
    rendered = stripInvoiceLinkBlock(rendered)
  }

  // Templates without a warranty placeholder: put the shop's saved terms in
  if (!/\[Warranty(?: Terms)?\]/.test(targetTemplate)) {
    rendered = applyShopWarranty(rendered, effectiveWarranty)
  }

  return tidyRenderedMessage(rendered)
}

/**
 * Retrieves custom shop warranty terms or fallback default.
 */
export function getShopWarrantyTerms(shopId) {
  if (shopId) {
    try {
      const direct = localStorage.getItem(`shop_warranty_${shopId}`)
      if (direct && direct.trim()) return direct.trim()
      const settings = JSON.parse(localStorage.getItem(`shop_settings_${shopId}`) || '{}')
      if (settings.warranty_terms && settings.warranty_terms.trim()) {
        return settings.warranty_terms.trim()
      }
    } catch (_) {}
  }
  return DEFAULT_WARRANTY_TERMS_URDU
}

/**
 * Injects or replaces the warranty section in any template or receipt string.
 */
export function replaceOrInjectWarrantyInTemplate(template, newWarranty) {
  if (!template) return (newWarranty || DEFAULT_WARRANTY_TERMS_URDU).trim()
  const warranty = (newWarranty || DEFAULT_WARRANTY_TERMS_URDU).trim()

  // Match existing warranty section if already present
  // Patterns:
  // Starts with "⚠️ *وارنٹی شرائط" or "⚠️ *Warranty" or contains LCD / فیس لاک up to next double newline or greeting
  const urduWarrantyRegex = /⚠️\s*\*وارنٹی شرائط[\s\S]*?(?=\n\n(?:آپ کے اعتماد|Thank you|Shukriya|شکریہ|🏪|📞|$))/i
  const engWarrantyRegex = /⚠️\s*\*Warranty Terms[\s\S]*?(?=\n\n(?:Thank you|آپ کے اعتماد|Shukriya|شکریہ|🏪|📞|$))/i

  if (urduWarrantyRegex.test(template)) {
    return template.replace(urduWarrantyRegex, warranty).trim()
  }
  if (engWarrantyRegex.test(template)) {
    return template.replace(engWarrantyRegex, warranty).trim()
  }

  // If already has LCD / فیس لاک / سیکنڈ ہینڈ bullet points without header
  const rawTermsRegex = /(?:۱۔|1\.)\s*LCD[\s\S]*?(?=\n\n(?:آپ کے اعتماد|Thank you|Shukriya|شکریہ|🏪|📞|$))/i
  if (rawTermsRegex.test(template)) {
    return template.replace(rawTermsRegex, warranty).trim()
  }

  // If there's a footer greeting or anchor, inject right before it
  const footerAnchors = [
    'آپ کے اعتماد',
    'Thank you for your business',
    'Thank you for shopping',
    'Thank you!',
    'Shukriya',
    'شکریہ',
    '🏪',
    '📞'
  ]

  for (const anchor of footerAnchors) {
    if (template.includes(anchor)) {
      const parts = template.split(anchor)
      return `${parts[0].trim()}\n\n${warranty}\n\n${anchor}${parts.slice(1).join(anchor)}`.trim()
    }
  }

  return `${template.trim()}\n\n${warranty}`.trim()
}

/**
 * Builds the WhatsApp sale receipt: the shop's own template when it has customised one,
 * otherwise the built-in default in the requested language.
 */
export function buildPhoneSaleReceiptText({ sale, customer, items = [], shopInfo = {}, language = 'urdu' }) {
  const shopId = shopInfo.id || shopInfo.shop_id || sale?.shop_id
  const effectiveWarranty = shopInfo.warranty_terms || (shopId ? getShopWarrantyTerms(shopId) : DEFAULT_WARRANTY_TERMS_URDU)
  const custom = String(shopInfo.wa_bill_template || '').trim()
  const isCustomised = custom.length > 20 &&
    !isLegacyEnglishInvoiceTemplate(custom) &&
    !isOldDefaultSaleTemplate(custom) &&
    normalizeTemplateText(custom) !== normalizeTemplateText(DEFAULT_PROFESSIONAL_INVOICE_TEMPLATE)
  const template = isCustomised
    ? custom
    : (language === 'english' ? DEFAULT_PROFESSIONAL_INVOICE_TEMPLATE_EN : DEFAULT_PROFESSIONAL_INVOICE_TEMPLATE)
  return renderCustomWhatsAppTemplate(template, { sale, customer, items, shopInfo: { ...shopInfo, warranty_terms: effectiveWarranty } })
}

/**
 * Builds purchase confirmation memo for suppliers.
 */
export function buildPurchaseMemoText({ purchase, supplier, items = [], shopInfo = {} }) {
  const supplierName = supplier?.name || 'Valued Supplier'
  const shopName = shopInfo.name || 'EdgeX Mobile Store'
  const purchaseId = String(purchase?.id || Date.now()).slice(-6).toUpperCase()
  const dateStr = purchase?.created_at
    ? new Date(purchase.created_at).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
    : new Date().toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })

  const itemsList = items.map((i, idx) => {
    const name = `${i.brand || ''} ${i.model || i.name || 'Phone'}`.trim()
    const imei = i.imei_1 ? ` [IMEI: ${i.imei_1}]` : ''
    const cost = Number(i.cost_price || i.unit_price || 0).toFixed(0)
    return `${idx + 1}. ${name}${imei} - Rs. ${cost}`
  }).join('\n')

  const total = Number(purchase?.total_amount || 0).toFixed(0)
  const paid = Number(purchase?.paid_amount ?? purchase?.amount_paid ?? total).toFixed(0)
  const balance = (total - paid) > 0 ? (total - paid).toFixed(0) : '0'

  return `Assalam-o-Alaikum ${supplierName}! 🤝
Purchase voucher confirmation from ${shopName}:

📦 *PURCHASE MEMO*
Voucher #: PR-${purchaseId}
Date: ${dateStr}

📱 *Stock Items:*
${itemsList}

💰 *Summary:*
• Total Cost: Rs. ${total}
• Paid Amount: Rs. ${paid}
• Remaining Balance: Rs. ${balance}

Thank you for your partnership! 🤝`
}

/** Built-in exchange template before Nov 2026 (kept to upgrade unedited copies). */
const LEGACY_DEFAULT_EXCHANGE_TEMPLATE_V1 = `السلام علیکم [Name]! 🤝
*[Shop Name]* میں تشریف لانے اور فون ایکسچینج کرنے کا بہت بہت شکریہ!

🔄 *فون ایکسچینج بل و رسید (PHONE EXCHANGE INVOICE)*
📄 انوائس نمبر: [Exchange ID]
📅 تاریخ: [Date]

📤 *خریدا گیا فون / سامان (Purchased Items):*
[Outgoing Items]
• کل قیمت خرید: Rs. [Sale Total]

📥 *آپ کی طرف سے جمع کروایا گیا فون (Exchanged / Traded-in Phones):*
[Incoming Phones]
• کل ٹریڈ ان کریڈٹ: Rs. [Trade-in Total]

⚖️ *حتمی حساب و بقایا ایڈجسٹمنٹ (Balance Adjustment & Settlement):*
• خریدا گیا فون کل: Rs. [Sale Total]
• پرانے فون کا کریڈٹ: - Rs. [Trade-in Total]
• خالص تبادلہ فرق: Rs. [Net Difference]
• ادا شدہ رقم (Paid): Rs. [Paid]
• بقایا واجب الادا (Remaining Due): Rs. [Balance]

🔗 *آن لائن بل و پی ڈی ایف رسید (View & Download PDF):*
[Invoice Link]

[Warranty Terms]

آپ کے اعتماد اور تعاون کا بے حد شکریہ! 🤝
🏪 *[Shop Name]*
📞 رابطہ: [Shop Phone]`.trim()

/** Default WhatsApp phone-exchange receipt (Urdu). */
export const DEFAULT_EXCHANGE_WHATSAPP_TEMPLATE = `السلام علیکم [Name]! 🤝
*[Shop Name]* پر فون ایکسچینج کا شکریہ۔

🔄 *ایکسچینج بل:* [Exchange ID]
📅 *تاریخ:* [Date]

📤 *آپ کو دیا گیا فون*
[Outgoing Items]

📥 *آپ سے لیا گیا فون*
[Incoming Phones]

⚖️ *حساب*
[Settlement Details]

🔗 *اپنا بل اور PDF رسید یہاں دیکھیں:*
[Invoice Link]

[Warranty Terms]

شکریہ! دوبارہ تشریف لائیں۔
📍 [Shop Address]
📞 [Shop Phone]`.trim()

/** Default WhatsApp phone-exchange receipt (English). */
export const DEFAULT_EXCHANGE_WHATSAPP_TEMPLATE_EN = `Assalam-o-Alaikum [Name]! 🤝
Thank you for your phone exchange at *[Shop Name]*.

🔄 *Exchange Bill:* [Exchange ID]
📅 *Date:* [Date]

📤 *Phone you received*
[Outgoing Items]

📥 *Phone you traded in*
[Incoming Phones]

⚖️ *Settlement*
[Settlement Details]

🔗 *View your bill & PDF receipt:*
[Invoice Link]

[Warranty Terms]

Thank you, see you again!
📍 [Shop Address]
📞 [Shop Phone]`.trim()

const LEGACY_EXCHANGE_DEFAULTS = [LEGACY_DEFAULT_EXCHANGE_TEMPLATE_V1]

export function isOldDefaultExchangeTemplate(template) {
  if (!template) return false
  const t = normalizeTemplateText(template)
  return LEGACY_EXCHANGE_DEFAULTS.some(d => normalizeTemplateText(d) === t)
}

function exchangeLists(exchange) {
  const all = Array.isArray(exchange.exchange_items) ? exchange.exchange_items : null
  const incoming = (all ? all.filter(i => i.item_direction === 'incoming_trade_in') : null) ||
    exchange.incoming_items || exchange.incomingPhones || exchange.incoming || []
  const outgoing = (all ? all.filter(i => i.item_direction === 'outgoing_sale') : null) ||
    exchange.outgoing_items || exchange.outgoingItems || exchange.outgoing || []
  return { incoming, outgoing }
}

/**
 * Who paid whom in an exchange. settlement_paid_amount, when recorded, can be less than
 * the difference (a short payment); otherwise the settlement is treated as paid in full.
 */
export function computeExchangeSettlement(exchange = {}) {
  const saleAmt = num(exchange.sale_amount)
  const tradeAmt = num(exchange.trade_in_credit)
  const diff = saleAmt - tradeAmt
  const rawDir = String(exchange.settlement_direction || '').toLowerCase()
  const dir = rawDir.includes('customer') ? 'customer'
    : rawDir.includes('shop') ? 'shop'
      : rawDir.includes('even') ? 'even'
        : (diff > 0 ? 'customer' : diff < 0 ? 'shop' : 'even')
  const amount = exchange.settlement_amount !== undefined && exchange.settlement_amount !== null
    ? Math.abs(num(exchange.settlement_amount))
    : Math.abs(diff)
  const paidRecorded = num(exchange.settlement_paid_amount)
  const paid = dir === 'even' ? 0 : (paidRecorded > 0 ? Math.min(paidRecorded, amount) : amount)
  const due = dir === 'customer' ? Math.max(0, amount - paid) : 0
  return { saleAmt, tradeAmt, diff, dir, amount, paid, due, method: exchange.settlement_payment_method || exchange.payment_method || 'cash' }
}

function exchangeSettlementLines(s, lang) {
  const method = paymentMethodLabel(s.method, lang)
  if (lang === 'ur') {
    const L = [`نیا فون: ${formatRs(s.saleAmt)}`, `پرانے فون کا کریڈٹ: − ${formatRs(s.tradeAmt)}`]
    if (s.dir === 'customer') {
      L.push(`*فرق: ${formatRs(s.amount)}*`, `✅ آپ نے ادا کیے (${method}): ${formatRs(s.paid)}`)
      if (s.due > 0) L.push(`⏳ *باقی رقم: ${formatRs(s.due)}*`)
    } else if (s.dir === 'shop') {
      L.push(`*فرق: ${formatRs(s.amount)}*`, `💵 دکان نے آپ کو ادا کیے (${method}): ${formatRs(s.paid)}`)
    } else {
      L.push('*فرق: Rs. 0*', '🤝 برابر تبادلہ، کوئی رقم ادا نہیں ہوئی۔')
    }
    return L
  }
  const L = [`New phone: ${formatRs(s.saleAmt)}`, `Trade-in credit: − ${formatRs(s.tradeAmt)}`]
  if (s.dir === 'customer') {
    L.push(`*Difference: ${formatRs(s.amount)}*`, `✅ You paid (${method}): ${formatRs(s.paid)}`)
    if (s.due > 0) L.push(`⏳ *Still to pay: ${formatRs(s.due)}*`)
  } else if (s.dir === 'shop') {
    L.push(`*Difference: ${formatRs(s.amount)}*`, `💵 Shop paid you (${method}): ${formatRs(s.paid)}`)
  } else {
    L.push('*Difference: Rs. 0*', '🤝 Even swap, no money changed hands.')
  }
  return L
}

function exchangeItemsText(list, lang, kind) {
  if (!list || list.length === 0) return lang === 'ur' ? 'کوئی نہیں' : 'None'
  return list.map(i => {
    const qty = Math.max(1, num(i.quantity || i.qty) || 1)
    const amount = kind === 'incoming'
      ? num(i.assessed_value || i.trade_in_value || i.subtotal)
      : (num(i.subtotal || i.line_total) || num(i.price || i.sale_price || i.assessed_value) * qty)
    const amountLabel = kind === 'incoming' ? (lang === 'ur' ? 'کریڈٹ' : 'Credit') : (lang === 'ur' ? 'قیمت' : 'Price')
    return deviceBlockLines(i, { lang, amountLabel, amount, qty: kind === 'incoming' ? 1 : qty }).join('\n')
  }).join('\n\n')
}

function exchangeBillNumber(exchange, token) {
  const id = exchange.id ?? exchange.exchange_id
  if (id !== undefined && id !== null && /^\d+$/.test(String(id))) return `EXC-${id}`
  return exchange.exchange_number || (token ? `EXC-${token}` : '-')
}

/**
 * Renders a WhatsApp phone-exchange template (the shop's own, or a built-in default).
 */
export function renderCustomExchangeTemplate(template, { exchange, customer = null, shopInfo = {} }) {
  if (!template) return ''
  const targetTemplate = isOldDefaultExchangeTemplate(template) ? DEFAULT_EXCHANGE_WHATSAPP_TEMPLATE : template
  const lang = templateLanguage(targetTemplate)
  const customerName = exchange.customer_name || exchange.customer?.name || exchange.customers?.name || customer?.name || 'Valued Customer'
  const shopName = shopInfo.name || 'EdgeX Mobile Store'
  const shopPhone = shopInfo.phone || shopInfo.mobile || ''
  const shopAddress = shopInfo.address || ''
  const exchangeToken = normalizeInvoiceToken(exchange.invoice_token)
  const billNo = exchangeBillNumber(exchange, exchangeToken)
  const { incoming, outgoing } = exchangeLists(exchange)
  const s = computeExchangeSettlement(exchange)
  const cleared = lang === 'ur' ? '0 (مکمل کلیئر ✅)' : '0 (cleared ✅)'
  const custBalance = num(customer?.outstanding_balance ?? customer?.balance ?? exchange.customer_balance)
  const shopId = shopInfo.id || shopInfo.shop_id || exchange.shop_id
  const effectiveWarranty = shopInfo.warranty_terms || (shopId ? getShopWarrantyTerms(shopId) : DEFAULT_WARRANTY_TERMS_URDU)
  const settlementText = exchangeSettlementLines(s, lang).join('\n')
  const outgoingText = exchangeItemsText(outgoing, lang, 'outgoing')
  const incomingText = exchangeItemsText(incoming, lang, 'incoming')

  let result = targetTemplate
    .replace(/\[Name\]/g, customerName)
    .replace(/\[Customer Name\]/g, customerName)
    .replace(/\[Shop Name\]/g, shopName)
    .replace(/\[Shop Address\]/g, shopAddress)
    .replace(/\[Exchange ID\]/g, billNo)
    .replace(/\[ID\]/g, billNo)
    .replace(/\[Invoice ID\]/g, billNo)
    .replace(/\[Date\]/g, formatMessageDate(exchange.created_at))
    .replace(/\[Outgoing Items\]/g, outgoingText)
    .replace(/\[Purchased Items\]/g, outgoingText)
    .replace(/\[Incoming Phones\]/g, incomingText)
    .replace(/\[Exchanged Phones\]/g, incomingText)
    .replace(/\[Trade-in Items\]/g, incomingText)
    .replace(/\[Sale Total\]/g, s.saleAmt.toLocaleString('en-PK'))
    .replace(/\[Trade-in Total\]/g, s.tradeAmt.toLocaleString('en-PK'))
    .replace(/\[Net Difference\]/g, Math.abs(s.diff).toLocaleString('en-PK'))
    .replace(/\[Settlement Details\]/g, settlementText)
    .replace(/\[Settlement\]/g, settlementText)
    .replace(/\[Paid\]/g, `${s.paid.toLocaleString('en-PK')} (${paymentMethodLabel(s.method, lang)})`)
    .replace(/\[Balance\]/g, s.due > 0 ? s.due.toLocaleString('en-PK') : cleared)
    .replace(/\[Remaining Due\]/g, s.due > 0 ? s.due.toLocaleString('en-PK') : cleared)
    .replace(/\[Customer Balance\]/g, custBalance.toLocaleString('en-PK'))
    .replace(/\[Warranty Terms\]/g, effectiveWarranty)
    .replace(/\[Warranty\]/g, effectiveWarranty)
    .replace(/\[Shop Phone\]/g, shopPhone)
    .replace(/\[Phone\]/g, shopPhone)

  if (exchangeToken) {
    const exchangeUrl = buildPublicInvoiceUrl(`EXC-${exchangeToken}`)
    result = result
      .replace(/\[Invoice Link\]/g, exchangeUrl)
      .replace(/\[Invoice URL\]/g, exchangeUrl)
      .replace(/\[Link\]/g, exchangeUrl)
      .replace(/\[URL\]/g, exchangeUrl)
    if (!result.includes(exchangeUrl)) result = replaceOrInjectInvoiceLinkInTemplate(result, exchangeUrl)
  } else {
    result = stripInvoiceLinkBlock(result)
  }

  if (!/\[Warranty(?: Terms)?\]/.test(targetTemplate)) {
    result = applyShopWarranty(result, effectiveWarranty)
  }

  return tidyRenderedMessage(result)
}

/**
 * Builds the WhatsApp exchange receipt: the shop's own template when customised,
 * otherwise the built-in default in the requested language.
 */
export function buildExchangeWhatsAppText({ exchange, customer = null, shopInfo = {}, language = 'urdu' }) {
  const custom = String(shopInfo.wa_exchange_template || '').trim()
  const isCustomised = custom.length > 20 &&
    !isOldDefaultExchangeTemplate(custom) &&
    normalizeTemplateText(custom) !== normalizeTemplateText(DEFAULT_EXCHANGE_WHATSAPP_TEMPLATE)
  const template = isCustomised
    ? custom
    : (language === 'english' ? DEFAULT_EXCHANGE_WHATSAPP_TEMPLATE_EN : DEFAULT_EXCHANGE_WHATSAPP_TEMPLATE)
  return renderCustomExchangeTemplate(template, { exchange, customer, shopInfo })
}


let isSupabaseTableMissing = false
let lastTableCheckTime = 0
const LOCAL_QUEUE_KEY = 'edgex_whatsapp_queue'

function getLocalStorageQueue() {
  try {
    const raw = localStorage.getItem(LOCAL_QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch (_) {
    return []
  }
}

function saveLocalStorageQueue(items) {
  try {
    localStorage.setItem(LOCAL_QUEUE_KEY, JSON.stringify(items.slice(0, 200)))
  } catch (_) {}
}

/**
 * Returns true only if an outbox queue item represents a sold phone sale or an exchange phone receipt.
 * Strictly excludes standalone purchase memos and non-phone sales.
 */
export function isSoldPhoneQueueItem(item) {
  if (!item) return false
  const type = String(item.message_type || '').toLowerCase()
  if (type.includes('purchase') && !type.includes('exchange')) return false

  if (
    type === 'phone_sale_receipt' ||
    type === 'phone_exchange_receipt' ||
    type === 'exchange_receipt' ||
    type === 'exchange'
  ) {
    return true
  }

  if (item.reference_data?.has_phone || item.reference_data?.is_exchange) return true
  return false
}

/**
 * Enqueues a message into the WhatsApp Queue (Supabase + Dexie + LocalStorage fallback).
 * Restricted strictly to sold phones and exchange phones. Standalone purchases and non-phone sales are rejected.
 */
export async function enqueueWhatsAppMessage({
  shop_id,
  recipient_name,
  recipient_phone,
  message_type = 'phone_sale_receipt',
  reference_id = null,
  reference_data = null,
  message_text,
  created_by = null
}) {
  const type = String(message_type || '').toLowerCase()
  // Reject standalone purchases
  if (type.includes('purchase') && !type.includes('exchange')) {
    console.warn('enqueueWhatsAppMessage: Purchases are not permitted in WhatsApp Outbox')
    return { success: false, ignored: true, reason: 'Purchases excluded from WhatsApp outbox' }
  }

  // Reject non-phone sales and non-exchange items
  const isAllowed = (
    type === 'phone_sale_receipt' ||
    type === 'phone_exchange_receipt' ||
    type === 'exchange_receipt' ||
    type === 'exchange' ||
    Boolean(reference_data?.has_phone) ||
    Boolean(reference_data?.is_exchange)
  )

  if (!isAllowed) {
    console.warn('enqueueWhatsAppMessage: Only sold phone and exchange entries are permitted in WhatsApp Outbox')
    return { success: false, ignored: true, reason: 'Only sold phones and exchange allowed in WhatsApp outbox' }
  }

  const cleanedPhone = cleanPakistanPhone(recipient_phone)
  if (!cleanedPhone) {
    console.warn('enqueueWhatsAppMessage: Invalid or missing recipient phone number', recipient_phone)
    return { success: false, error: 'Invalid phone number' }
  }

  const cleanShopId = shop_id ? (isNaN(Number(shop_id)) ? shop_id : Number(shop_id)) : null
  const upgradedText = upgradeLegacyWhatsAppMessage(message_text || '', cleanShopId, reference_data)
  const finalText = hasWarrantyTerms(upgradedText)
    ? upgradedText
    : replaceOrInjectWarrantyInTemplate(upgradedText, getShopWarrantyTerms(cleanShopId))

  const queueItem = {
    id: crypto.randomUUID(),
    shop_id: cleanShopId,
    recipient_name: recipient_name || 'Customer',
    recipient_phone: cleanedPhone,
    message_type,
    reference_id: reference_id ? String(reference_id) : null,
    reference_data: reference_data ? JSON.parse(JSON.stringify(reference_data)) : null,
    message_text: finalText,
    status: 'pending',
    created_at: new Date().toISOString(),
    sent_at: null,
    created_by: created_by || null
  }

  // 1. Save to LocalStorage immediately so it is instantly available across tabs
  const localList = getLocalStorageQueue()
  localList.unshift(queueItem)
  saveLocalStorageQueue(localList)

  // 2. Mirror into Dexie
  try {
    if (db.whatsapp_queue) {
      await db.whatsapp_queue.put(queueItem)
    }
  } catch (dexieErr) {
    console.warn('Dexie whatsapp_queue put notice:', dexieErr)
  }

  // 3. Try Supabase insert only if table exists
  let supabaseSuccess = false
  const canQuerySupabase = !isSupabaseTableMissing || (Date.now() - lastTableCheckTime > 60000)

  if (canQuerySupabase) {
    try {
      const { data, error } = await supabase
        .from('whatsapp_queue')
        .insert([queueItem])
        .select()
        .maybeSingle()

      if (!error && data) {
        supabaseSuccess = true
        isSupabaseTableMissing = false
      } else if (error) {
        if (error.code === '42P01' || error.code === 'PGRST204' || String(error.status) === '404' || error.message?.includes('does not exist')) {
          isSupabaseTableMissing = true
          lastTableCheckTime = Date.now()
        } else {
          // e.g. 22P02 when whatsapp_queue.shop_id is UUID but shops use integer ids:
          // the message then exists only on this device and never reaches the phone.
          console.warn('enqueueWhatsAppMessage: server insert failed, message kept on this device only:', error.code, error.message)
        }
      }
    } catch (_err) {
      isSupabaseTableMissing = true
      lastTableCheckTime = Date.now()
    }
  }

  return { success: true, item: queueItem, online: supabaseSuccess }
}

/**
 * Fetches WhatsApp queue messages for a shop.
 */
export async function fetchWhatsAppQueue(shop_id, statusFilter = 'all') {
  let list = []
  const canQuerySupabase = !isSupabaseTableMissing || (Date.now() - lastTableCheckTime > 60000)

  // 1. Fetch from Supabase (if table exists)
  if (canQuerySupabase) {
    try {
      let query = supabase
        .from('whatsapp_queue')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)

      if (shop_id) {
        const numShopId = !isNaN(Number(shop_id)) ? Number(shop_id) : shop_id
        query = query.eq('shop_id', numShopId)
      }
      if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      const { data, error } = await query
      if (!error && Array.isArray(data)) {
        list = data
        isSupabaseTableMissing = false
        // Sync to local Dexie cache
        if (db.whatsapp_queue && data.length > 0) {
          await db.whatsapp_queue.bulkPut(data).catch(() => {})
        }
      } else if (error) {
        if (error.code === '42P01' || error.code === 'PGRST204' || String(error.status) === '404' || error.message?.includes('does not exist')) {
          isSupabaseTableMissing = true
          lastTableCheckTime = Date.now()
        }
      }
    } catch (_) {
      isSupabaseTableMissing = true
      lastTableCheckTime = Date.now()
    }
  }

  // 2. Merge with Dexie & LocalStorage
  const mergedMap = new Map()
  list.forEach(i => mergedMap.set(i.id, i))

  // Dexie items
  if (db.whatsapp_queue) {
    try {
      let localDexie = await db.whatsapp_queue.toArray()
      if (shop_id) {
        localDexie = localDexie.filter(i => !i.shop_id || String(i.shop_id) === String(shop_id))
      }
      if (statusFilter && statusFilter !== 'all') {
        localDexie = localDexie.filter(i => i.status === statusFilter)
      }
      localDexie.forEach(i => {
        if (!mergedMap.has(i.id)) mergedMap.set(i.id, i)
      })
    } catch (_) {}
  }

  // LocalStorage items
  const localStore = getLocalStorageQueue()
  localStore.forEach(i => {
    if (shop_id && i.shop_id && String(i.shop_id) !== String(shop_id)) return
    if (statusFilter && statusFilter !== 'all' && i.status !== statusFilter) return
    if (!mergedMap.has(i.id)) mergedMap.set(i.id, i)
  })

  const resultList = Array.from(mergedMap.values())
    .filter(isSoldPhoneQueueItem)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))

  // Permanently auto-heal pending outbox items that lack warranty terms or use legacy English stubs
  for (const item of resultList) {
    if (item.status === 'pending' || !item.status) {
      const origText = item.message_text || ''
      if (isLegacyEnglishInvoiceTemplate(origText) || !hasWarrantyTerms(origText)) {
        const itemShopId = item.shop_id || shop_id
        const healed = upgradeLegacyWhatsAppMessage(origText, itemShopId, item.reference_data)
        const finalHealed = hasWarrantyTerms(healed)
          ? healed
          : replaceOrInjectWarrantyInTemplate(healed, getShopWarrantyTerms(itemShopId))
        if (finalHealed && finalHealed !== origText) {
          item.message_text = finalHealed
          // Asynchronously persist repair so Dexie, LocalStorage, and Supabase are permanently fixed
          updateWhatsAppMessageText(item.id, finalHealed).catch(() => {})
        }
      }
    }
  }

  return resultList
}

/**
 * Marks a message as sent (updates timestamp and status).
 */
export async function markWhatsAppMessageSent(id) {
  const sent_at = new Date().toISOString()

  // 1. Update Supabase
  try {
    await supabase
      .from('whatsapp_queue')
      .update({ status: 'sent', sent_at })
      .eq('id', id)
  } catch (err) {
    console.warn('Failed to update status in Supabase:', err)
  }

  // 2. Update Dexie
  try {
    if (db.whatsapp_queue) {
      const item = await db.whatsapp_queue.get(id)
      if (item) {
        await db.whatsapp_queue.put({ ...item, status: 'sent', sent_at })
      }
    }
  } catch (dexieErr) {
    console.warn('Failed to update status in Dexie:', dexieErr)
  }

  // 3. Update LocalStorage
  const localItems = getLocalStorageQueue()
  const updated = localItems.map(i => i.id === id ? { ...i, status: 'sent', sent_at } : i)
  saveLocalStorageQueue(updated)

  return true
}

/**
 * Deletes or dismisses a message.
 */
export async function deleteWhatsAppMessage(id) {
  try {
    await supabase.from('whatsapp_queue').delete().eq('id', id)
  } catch (err) {
    console.warn('Supabase delete error:', err)
  }

  try {
    if (db.whatsapp_queue) {
      await db.whatsapp_queue.delete(id)
    }
  } catch (dexieErr) {
    console.warn('Dexie delete error:', dexieErr)
  }

  const localItems = getLocalStorageQueue()
  saveLocalStorageQueue(localItems.filter(i => i.id !== id))

  return true
}

/**
 * Gets count of pending messages for a shop (for notification badge).
 */
export async function getPendingWhatsAppQueueCount(shop_id) {
  try {
    const isPendingPhone = (i) => i.status === 'pending' && (!shop_id || String(i.shop_id) === String(shop_id)) && isSoldPhoneQueueItem(i)

    const localStore = getLocalStorageQueue()
    const pendingLocal = localStore.filter(isPendingPhone).length
    if (pendingLocal > 0) return pendingLocal

    if (db.whatsapp_queue) {
      const items = await db.whatsapp_queue.toArray()
      return items.filter(isPendingPhone).length
    }
  } catch (err) {
    console.debug('Pending queue count check notice:', err)
  }
  return 0
}

/**
 * Updates the message text of an individual queue message.
 */
export async function updateWhatsAppMessageText(id, newText) {
  if (!id || typeof newText !== 'string') return false
  try {
    if (db.whatsapp_queue) {
      await db.whatsapp_queue.update(id, { message_text: newText })
    }
  } catch (dexieErr) {
    console.warn('Failed to update Dexie whatsapp_queue:', dexieErr)
  }

  try {
    if (navigator.onLine && !isSupabaseTableMissing) {
      await supabase.from('whatsapp_queue').update({ message_text: newText }).eq('id', id)
    }
  } catch (err) {
    console.warn('Failed to update Supabase whatsapp_queue:', err)
  }

  try {
    const local = getLocalStorageQueue()
    const idx = local.findIndex(m => m.id === id)
    if (idx !== -1) {
      local[idx].message_text = newText
      saveLocalStorageQueue(local)
    }
  } catch (_) {}

  return true
}

/**
 * Undoes the corruption of the removed sanitizer, which turned INV-8K3P9X2M into
 * INV-8K3P9X2MK3P9X2M (growing on every re-run). Returns the original token or the input.
 */
export function recoverCorruptedToken(raw) {
  const body = normalizeInvoiceToken(raw)
  if (!body || body.length <= 8 || !/^[0-9]/.test(body)) return body
  const token = body.slice(0, 8)
  const unit = token.slice(1)
  const tail = body.slice(8)
  return tail.length % unit.length === 0 && tail === unit.repeat(tail.length / unit.length) ? token : body
}

/**
 * Every token a queue message has carried: its reference data, preserved legacy tokens,
 * and the token inside any invoice link in its text (with sanitizer corruption undone).
 */
function collectMessageTokens(item) {
  const ref = item?.reference_data || {}
  const found = [ref.invoice_token, ...(Array.isArray(ref.legacy_invoice_tokens) ? ref.legacy_invoice_tokens : [])]
  for (const m of String(item?.message_text || '').matchAll(/\/(?:view-)?invoice\/([^\s?#]+)/gi)) {
    try { found.push(decodeURIComponent(m[1])) } catch (_) { found.push(m[1]) }
  }
  return Array.from(new Set(found.map(recoverCorruptedToken).filter(Boolean)))
}

const registeredLegacyKeys = new Set()
let legacyColumnMissing = false

/**
 * Uploads invoice tokens that customers may already hold (from messages created before
 * links used the server token) into sales/exchanges.legacy_invoice_tokens, so those old
 * WhatsApp links resolve via get_public_invoice. Covers queue items that exist only on
 * this device (localStorage/Dexie). Needs sql/phase0b_legacy_invoice_tokens.sql; does
 * nothing if that column is not deployed yet. Returns the number of rows updated.
 */
export async function registerLegacyInvoiceTokens(items = []) {
  if (!navigator.onLine || legacyColumnMissing) return 0
  const wanted = { sales: new Map(), exchanges: new Map() }
  for (const item of items) {
    const ref = item?.reference_data
    if (!ref) continue
    const isExchange = Boolean(ref.is_exchange) || String(item.message_type || '').includes('exchange')
    const id = isExchange ? ref.exchange_id : ref.sale_id
    if (!id || !/^\d+$/.test(String(id))) continue
    const table = isExchange ? 'exchanges' : 'sales'
    for (const tok of collectMessageTokens(item)) {
      const key = `${table}:${id}:${tok}`
      if (registeredLegacyKeys.has(key)) continue
      if (!wanted[table].has(Number(id))) wanted[table].set(Number(id), new Set())
      wanted[table].get(Number(id)).add(tok)
    }
  }

  let updated = 0
  for (const table of ['sales', 'exchanges']) {
    const ids = Array.from(wanted[table].keys())
    if (ids.length === 0) continue
    const { data, error } = await supabase.from(table).select('id, invoice_token, legacy_invoice_tokens').in('id', ids)
    if (error) {
      if (error.code === '42703' || String(error.message || '').includes('legacy_invoice_tokens')) {
        legacyColumnMissing = true
        console.info('registerLegacyInvoiceTokens: legacy_invoice_tokens not deployed yet (run sql/phase0b_legacy_invoice_tokens.sql)')
        return updated
      }
      console.warn(`registerLegacyInvoiceTokens: could not read ${table}:`, error.message || error)
      continue
    }
    for (const row of data || []) {
      const current = normalizeInvoiceToken(row.invoice_token)
      const existing = Array.isArray(row.legacy_invoice_tokens) ? row.legacy_invoice_tokens : []
      const toAdd = Array.from(wanted[table].get(Number(row.id)) || []).filter(t => t !== current && !existing.includes(t))
      const markDone = () => (wanted[table].get(Number(row.id)) || []).forEach(t => registeredLegacyKeys.add(`${table}:${row.id}:${t}`))
      if (toAdd.length === 0) { markDone(); continue }
      const { error: upErr } = await supabase.from(table).update({ legacy_invoice_tokens: [...existing, ...toAdd].sort() }).eq('id', row.id)
      if (upErr) {
        console.warn(`registerLegacyInvoiceTokens: could not update ${table} ${row.id}:`, upErr.message || upErr)
        continue
      }
      markDone()
      updated++
    }
  }
  return updated
}

/**
 * Pushes bill codes that exist only in this device's saved sales up to the server.
 * Sales made before links used the server token (e.g. INV-JNXKG8DN) kept their code only
 * locally, so the customer's link and the QR showed "Invoice not found".
 *   - server sale has no token        -> store the local code as its token
 *   - server sale has another token   -> add the local code to legacy_invoice_tokens
 * Never replaces an existing server token or invoice_number. Returns a map
 * { [saleId]: tokenThatResolvesOnTheServer } for the sales it could check.
 */
export async function syncLocalSaleTokens(localSales = []) {
  const wanted = new Map()
  for (const s of localSales) {
    if (!s || !/^\d+$/.test(String(s.id ?? ''))) continue
    const tok = normalizeInvoiceToken(s.invoice_token) || normalizeInvoiceToken(s.invoice_number)
    if (tok) wanted.set(Number(s.id), tok)
  }
  const result = {}
  if (wanted.size === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false)) return result

  const ids = Array.from(wanted.keys())
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    let hasLegacy = true
    let { data, error } = await supabase.from('sales').select('id, invoice_token, invoice_number, legacy_invoice_tokens').in('id', chunk)
    if (error && /legacy_invoice_tokens/.test(error.message || '')) {
      hasLegacy = false
      ;({ data, error } = await supabase.from('sales').select('id, invoice_token, invoice_number').in('id', chunk))
    }
    if (error) {
      console.warn('syncLocalSaleTokens: could not read sales:', error.message || error)
      continue
    }
    for (const row of data || []) {
      const local = wanted.get(Number(row.id))
      const serverTok = normalizeInvoiceToken(row.invoice_token) || normalizeInvoiceToken(row.invoice_number)
      const legacy = Array.isArray(row.legacy_invoice_tokens) ? row.legacy_invoice_tokens : []
      if (!serverTok) {
        const patch = { invoice_token: local }
        if (!String(row.invoice_number || '').trim()) patch.invoice_number = `INV-${local}`
        const { error: upErr } = await supabase.from('sales').update(patch).eq('id', row.id)
        if (upErr) console.warn(`syncLocalSaleTokens: could not store token on sale ${row.id}:`, upErr.message || upErr)
        else result[row.id] = local
        continue
      }
      result[row.id] = serverTok
      if (serverTok !== local && hasLegacy && !legacy.includes(local)) {
        const { error: upErr } = await supabase.from('sales').update({ legacy_invoice_tokens: [...legacy, local].sort() }).eq('id', row.id)
        if (upErr) console.warn(`syncLocalSaleTokens: could not add old code to sale ${row.id}:`, upErr.message || upErr)
      }
    }
  }
  return result
}

const backfilledCustomerKeys = new Set()

/**
 * Fills in the customer's name/phone on bills that were saved without them, using the
 * WhatsApp outbox (which always has the recipient). Only empty or placeholder values
 * ("Walk-in Customer", "Valued Customer") are replaced. Covers outbox items that exist
 * only on this device. Returns the number of bills updated.
 */
export async function backfillBillCustomersFromQueue(items = []) {
  if (!navigator.onLine) return 0
  const wanted = { sales: new Map(), exchanges: new Map() }
  for (const item of items) {
    const ref = item?.reference_data
    if (!ref) continue
    const isExchange = Boolean(ref.is_exchange) || String(item.message_type || '').includes('exchange')
    const id = isExchange ? ref.exchange_id : ref.sale_id
    if (!id || !/^\d+$/.test(String(id))) continue
    const table = isExchange ? 'exchanges' : 'sales'
    const key = `${table}:${id}`
    if (backfilledCustomerKeys.has(key) || wanted[table].has(Number(id))) continue
    const name = isRealCustomerName(item.recipient_name) ? String(item.recipient_name).trim() : ''
    const phone = String(item.recipient_phone || '').replace(/[^0-9]/g, '')
    if (name || phone.length >= 10) wanted[table].set(Number(id), { name, phone: phone.length >= 10 ? phone : '' })
  }

  let updated = 0
  for (const table of ['sales', 'exchanges']) {
    const ids = Array.from(wanted[table].keys())
    if (ids.length === 0) continue
    let hasPhoneColumn = true
    let { data, error } = await supabase.from(table).select('id, customer_name, customer_phone').in('id', ids)
    if (error && /customer_phone/.test(error.message || '')) {
      hasPhoneColumn = false
      ;({ data, error } = await supabase.from(table).select('id, customer_name').in('id', ids))
    }
    if (error) {
      console.warn(`backfillBillCustomersFromQueue: could not read ${table}:`, error.message || error)
      continue
    }
    for (const row of data || []) {
      const want = wanted[table].get(Number(row.id))
      const patch = {}
      if (want.name && !isRealCustomerName(row.customer_name)) patch.customer_name = want.name
      if (hasPhoneColumn && want.phone && !String(row.customer_phone || '').trim()) patch.customer_phone = want.phone
      backfilledCustomerKeys.add(`${table}:${row.id}`)
      if (Object.keys(patch).length === 0) continue
      const { error: upErr } = await supabase.from(table).update(patch).eq('id', row.id)
      if (upErr) {
        console.warn(`backfillBillCustomersFromQueue: could not update ${table} ${row.id}:`, upErr.message || upErr)
        backfilledCustomerKeys.delete(`${table}:${row.id}`)
        continue
      }
      updated++
    }
  }
  return updated
}

/**
 * Repairs pending outbox messages whose invoice link does not match the token stored on
 * the server (client-only tokens from older builds, or links corrupted by the removed
 * INV-<digits> sanitizer). Only rows that reference a synced sale/exchange id are touched.
 * Returns the number of messages rewritten.
 */
export async function repairQueueInvoiceLinks(items = []) {
  if (!navigator.onLine) return 0
  const pending = items.filter(i => (i.status === 'pending' || !i.status) && i.reference_data)
  const saleIds = new Set()
  const exchangeIds = new Set()
  for (const item of pending) {
    const ref = item.reference_data
    const isExchange = Boolean(ref.is_exchange) || String(item.message_type || '').includes('exchange')
    const id = isExchange ? ref.exchange_id : ref.sale_id
    if (id && /^\d+$/.test(String(id))) (isExchange ? exchangeIds : saleIds).add(Number(id))
  }
  if (saleIds.size === 0 && exchangeIds.size === 0) return 0

  const tokenMap = { sales: new Map(), exchanges: new Map() }
  for (const [table, ids] of [['sales', saleIds], ['exchanges', exchangeIds]]) {
    if (ids.size === 0) continue
    try {
      const { data, error } = await supabase.from(table).select('id, invoice_token').in('id', Array.from(ids))
      if (error) {
        console.warn(`repairQueueInvoiceLinks: could not read ${table} tokens:`, error.message || error)
        continue
      }
      for (const row of data || []) {
        const t = normalizeInvoiceToken(row.invoice_token)
        if (t) tokenMap[table].set(Number(row.id), t)
      }
    } catch (err) {
      console.warn(`repairQueueInvoiceLinks: could not read ${table} tokens:`, err)
    }
  }

  let repaired = 0
  for (const item of pending) {
    const ref = item.reference_data
    const isExchange = Boolean(ref.is_exchange) || String(item.message_type || '').includes('exchange')
    const token = isExchange ? tokenMap.exchanges.get(Number(ref.exchange_id)) : tokenMap.sales.get(Number(ref.sale_id))
    if (!token) continue

    const publicNo = `${isExchange ? 'EXC' : 'INV'}-${token}`
    const text = item.message_text || ''
    const fixedText = repairInvoiceLinkInText(text, token, isExchange ? 'exchange' : 'sale')
    if (fixedText === text && normalizeInvoiceToken(ref.invoice_token) === token && item.reference_id === publicNo) continue

    // Keep the tokens this message carried before: a "pending" message may already have
    // reached the customer (e.g. POS opened WhatsApp directly), and those old links are
    // kept resolvable via sales/exchanges.legacy_invoice_tokens.
    const previousTokens = collectMessageTokens(item).filter(t => t !== token)
    const legacy = Array.from(new Set([...(Array.isArray(ref.legacy_invoice_tokens) ? ref.legacy_invoice_tokens : []), ...previousTokens]))
    const newRef = {
      ...ref,
      invoice_token: token,
      ...(legacy.length ? { legacy_invoice_tokens: legacy } : {}),
      ...(isExchange ? { exchange_number: publicNo } : { invoice_number: publicNo })
    }
    const patch = { message_text: fixedText, reference_id: publicNo, reference_data: newRef }
    Object.assign(item, patch)
    repaired++

    try {
      if (db.whatsapp_queue) await db.whatsapp_queue.update(item.id, patch)
    } catch (_) { /* local cache only */ }
    try {
      if (!isSupabaseTableMissing) await supabase.from('whatsapp_queue').update(patch).eq('id', item.id)
    } catch (err) {
      console.warn('repairQueueInvoiceLinks: server update failed:', err)
    }
    try {
      const local = getLocalStorageQueue()
      const idx = local.findIndex(m => m.id === item.id)
      if (idx !== -1) {
        local[idx] = { ...local[idx], ...patch }
        saveLocalStorageQueue(local)
      }
    } catch (_) { /* local cache only */ }
  }
  return repaired
}

/**
 * Bulk updates pending WhatsApp outbox messages with the shop's warranty terms.
 *
 * With customWarranty (the shop just edited its terms in Settings) the existing warranty
 * section of every pending message is REPLACED, so e.g. removing a point takes effect.
 * Without it (background healing) terms are only added where a message has none, so
 * per-message edits made in the outbox are never overwritten.
 */
export async function updateExistingQueueMessagesWithWarranty(shopId, customWarranty = null) {
  const replaceExisting = Boolean(customWarranty && String(customWarranty).trim())
  const warrantyText = (customWarranty || getShopWarrantyTerms(shopId) || DEFAULT_WARRANTY_TERMS_URDU).trim()
  const isPending = (item) => item.status === 'pending' || !item.status
  const applyWarranty = (item) => {
    const text = item.message_text || ''
    const upgraded = upgradeLegacyWhatsAppMessage(text, item.shop_id || shopId, item.reference_data)
    if (replaceExisting) return applyShopWarranty(upgraded, warrantyText)
    return hasWarrantyTerms(upgraded) ? upgraded : replaceOrInjectWarrantyInTemplate(upgraded, warrantyText)
  }
  const updatedIds = new Set()

  try {
    // 0. Pending rows on the server
    if (navigator.onLine && !isSupabaseTableMissing) {
      try {
        let q = supabase.from('whatsapp_queue').select('*').eq('status', 'pending').limit(200)
        if (shopId) {
          const numSid = !isNaN(Number(shopId)) ? Number(shopId) : shopId
          q = q.eq('shop_id', numSid)
        }
        const { data: supaRows, error } = await q
        if (error) console.warn('updateExistingQueueMessagesWithWarranty: could not read server outbox:', error.message || error)
        for (const sItem of supaRows || []) {
          const finalText = applyWarranty(sItem)
          if (finalText && finalText !== (sItem.message_text || '')) {
            const { error: upErr } = await supabase.from('whatsapp_queue').update({ message_text: finalText }).eq('id', sItem.id)
            if (upErr) {
              console.warn('updateExistingQueueMessagesWithWarranty: server update failed:', upErr.message || upErr)
              continue
            }
            if (db.whatsapp_queue) await db.whatsapp_queue.update(sItem.id, { message_text: finalText }).catch(() => {})
            updatedIds.add(sItem.id)
          }
        }
      } catch (err) {
        console.warn('updateExistingQueueMessagesWithWarranty: server pass failed:', err)
      }
    }

    // 1. Pending rows in Dexie (device copy)
    if (db.whatsapp_queue) {
      const all = await db.whatsapp_queue.toArray()
      for (const item of all) {
        if (shopId && String(item.shop_id) !== String(shopId)) continue
        if (!isPending(item)) continue
        const finalText = applyWarranty(item)
        if (finalText && finalText !== (item.message_text || '')) {
          await db.whatsapp_queue.update(item.id, { message_text: finalText })
          updatedIds.add(item.id)
          if (navigator.onLine && !isSupabaseTableMissing) {
            const { error: upErr } = await supabase.from('whatsapp_queue').update({ message_text: finalText }).eq('id', item.id)
            if (upErr) console.warn('updateExistingQueueMessagesWithWarranty: server mirror failed:', upErr.message || upErr)
          }
        }
      }
    }

    // 2. Pending rows in the localStorage fallback queue
    try {
      const localQueue = getLocalStorageQueue()
      let lsUpdated = false
      const newLocalQueue = localQueue.map(item => {
        if (shopId && item.shop_id && String(item.shop_id) !== String(shopId)) return item
        if (!isPending(item)) return item
        const finalText = applyWarranty(item)
        if (finalText && finalText !== (item.message_text || '')) {
          lsUpdated = true
          updatedIds.add(item.id)
          return { ...item, message_text: finalText }
        }
        return item
      })
      if (lsUpdated) saveLocalStorageQueue(newLocalQueue)
    } catch (_) { /* local fallback only */ }
  } catch (err) {
    console.warn('Error updating queue messages with warranty:', err)
  }

  return updatedIds.size
}
