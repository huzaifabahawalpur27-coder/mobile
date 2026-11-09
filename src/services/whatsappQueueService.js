import { supabase } from './supabase.js'
import { db } from './db.js'

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
    const { data, error } = await supabase.from(table).select('invoice_token').eq('id', id).maybeSingle()
    if (error) {
      console.warn(`fetchServerInvoiceToken(${table}, ${id}):`, error.message || error)
      return null
    }
    return normalizeInvoiceToken(data?.invoice_token)
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
 * Constructs the canonical public digital invoice link for WhatsApp messages.
 */
export function buildPublicInvoiceUrl(referenceId) {
  if (!referenceId) return ''
  const origin = typeof window !== 'undefined' && window.location && window.location.origin
    ? window.location.origin
    : 'https://pos.edgexsuite.com'
  const clean = String(referenceId).trim()
  return `${origin}/invoice/${encodeURIComponent(clean)}`
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

export const DEFAULT_PROFESSIONAL_INVOICE_TEMPLATE = `السلام علیکم [Name]! 🤝
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

⚠️ *وارنٹی شرائط (Warranty Terms):*
۱۔ LCD، فیس لاک اور کیمرے کی کوئی وارنٹی نہیں ہوگی۔
۲۔ موبائل ڈیڈ ہونے کی صورت میں کوئی وارنٹی یا واپسی قبول نہیں کی جائے گی۔
۳۔ سیکنڈ ہینڈ موبائل کی کوئی وارنٹی نہیں ہوگی۔

آپ کے اعتماد اور تعاون کا شکریہ! 🤝
🏪 *[Shop Name]*
📞 رابطہ: [Phone]`.trim()

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
 * Renders a custom WhatsApp template with sale data substitutions.
 * Permanently guards against legacy English stubs and guarantees warranty inclusion.
 */
export function renderCustomWhatsAppTemplate(template, { sale, customer, items = [], shopInfo = {} }) {
  if (!template) return ''
  const shopId = shopInfo.id || shopInfo.shop_id || sale?.shop_id
  const effectiveWarranty = shopInfo.warranty_terms || (shopId ? getShopWarrantyTerms(shopId) : DEFAULT_WARRANTY_TERMS_URDU)

  // Discard legacy English template and use professional Urdu invoice template
  let targetTemplate = template
  if (isLegacyEnglishInvoiceTemplate(template)) {
    targetTemplate = DEFAULT_PROFESSIONAL_INVOICE_TEMPLATE
  }

  const customerName = customer?.name || sale?.walkInName || 'Valued Customer'
  const shopName = shopInfo.name || (shopId ? localStorage.getItem(`shop_name_${shopId}`) : null) || 'EdgeX Mobile Store'
  const shopPhone = shopInfo.phone || shopInfo.mobile || ''
  const invoiceToken = normalizeInvoiceToken(sale?.invoice_token) || normalizeInvoiceToken(sale?.invoice_number)
  const invoiceDisplayId = invoiceToken || (sale?.id ? String(sale.id) : '')
  const publicInvoiceNo = invoiceDisplayId ? `INV-${invoiceDisplayId}` : ''
  const dateStr = sale?.created_at
    ? new Date(sale.created_at).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
    : new Date().toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })

  const subtotalNum = Number(sale?.subtotal || items.reduce((s, i) => s + (Number(i.custom_price || i.sale_price || i.price || 0) * (Number(i.qty) || 1)), 0))
  const discountNum = Number(sale?.discount || sale?.totalDiscount || 0)
  const totalNum = Number(sale?.total || sale?.total_amount || (subtotalNum - discountNum))
  const paidNum = Number(sale?.receivedAmount ?? sale?.paid_amount ?? totalNum)
  const balanceNum = Number(customer?.outstanding_balance || 0)

  const itemsText = items.map((i, idx) => {
    const name = i.name || i.model || i.product_name || 'Item'
    const imei = i.imei_1 || i.imei || ''
    const imeiStr = imei ? ` (IMEI: ${imei})` : ''
    const qty = i.qty || i.quantity || 1
    const price = Number(i.custom_price || i.sale_price || i.price || i.unit_price || 0).toLocaleString('en-PK')
    const lineTotal = (qty * Number(i.custom_price || i.sale_price || i.price || i.unit_price || 0)).toLocaleString('en-PK')
    return `${idx + 1}. ${name}${imeiStr} × ${qty} @ Rs. ${price} = Rs. ${lineTotal}`
  }).join('\n')

  const modelText = items.map(i => `${i.name || i.model || ''}${i.imei_1 ? ` [${i.imei_1}]` : ''}`).filter(Boolean).join(', ') || 'Phone/Accessory'

  let rendered = targetTemplate
    .replace(/\[Name\]/g, customerName)
    .replace(/\[Customer Name\]/g, customerName)
    .replace(/\[Shop Name\]/g, shopName)
    .replace(/\[ID\]/g, invoiceDisplayId)
    .replace(/\[Invoice ID\]/g, publicInvoiceNo)
    .replace(/\[Date\]/g, dateStr)
    .replace(/\[Items\]/g, itemsText || '1x Device')
    .replace(/\[Model\]/g, modelText)
    .replace(/\[Amount\]/g, totalNum.toLocaleString('en-PK'))
    .replace(/\[Total\]/g, totalNum.toLocaleString('en-PK'))
    .replace(/\[Paid\]/g, paidNum.toLocaleString('en-PK'))
    .replace(/\[Balance\]/g, balanceNum > 0 ? balanceNum.toLocaleString('en-PK') : '0 (مکمل کلیئر ✅)')
    .replace(/\[Warranty Terms\]/g, effectiveWarranty)
    .replace(/\[Warranty\]/g, effectiveWarranty)
    .replace(/\[Phone\]/g, shopPhone)
    .replace(/\[Shop Phone\]/g, shopPhone)

  // Inject or substitute the online invoice & PDF link, only for a server-stored token
  if (invoiceToken) {
    const invoiceUrl = buildPublicInvoiceUrl(`INV-${invoiceToken}`)
    rendered = rendered
      .replace(/\[Invoice Link\]/g, invoiceUrl)
      .replace(/\[Invoice URL\]/g, invoiceUrl)
      .replace(/\[Link\]/g, invoiceUrl)
      .replace(/\[URL\]/g, invoiceUrl)

    if (!rendered.includes(invoiceUrl)) {
      rendered = replaceOrInjectInvoiceLinkInTemplate(rendered, invoiceUrl)
    }
  } else {
    rendered = stripInvoiceLinkBlock(rendered)
  }

  // Permanently enforce warranty terms in rendered result
  if (!hasWarrantyTerms(rendered)) {
    rendered = replaceOrInjectWarrantyInTemplate(rendered, effectiveWarranty)
  }

  return rendered
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
 * Builds invoice details and greetings with standard warranty terms.
 * Defaults permanently to Urdu professional format with shop warranty terms.
 */
export function buildPhoneSaleReceiptText({ sale, customer, items = [], shopInfo = {}, language = 'urdu' }) {
  const shopId = shopInfo.id || shopInfo.shop_id || sale?.shop_id
  const effectiveWarranty = shopInfo.warranty_terms || (shopId ? getShopWarrantyTerms(shopId) : DEFAULT_WARRANTY_TERMS_URDU)

  // If shop has custom template configured (and not legacy English stub)
  if (shopInfo.wa_bill_template && shopInfo.wa_bill_template.trim().length > 20) {
    if (!isLegacyEnglishInvoiceTemplate(shopInfo.wa_bill_template)) {
      return renderCustomWhatsAppTemplate(shopInfo.wa_bill_template, { sale, customer, items, shopInfo: { ...shopInfo, warranty_terms: effectiveWarranty } })
    }
  }

  const customerName = customer?.name || sale?.walkInName || 'Valued Customer'
  const shopName = shopInfo.name || (shopId ? localStorage.getItem(`shop_name_${shopId}`) : null) || 'EdgeX Mobile Store'
  const shopPhone = shopInfo.phone || ''
  const invoiceToken = normalizeInvoiceToken(sale?.invoice_token) || normalizeInvoiceToken(sale?.invoice_number)
  const publicInvoiceNo = invoiceToken ? `INV-${invoiceToken}` : (sale?.id ? `INV-${sale.id}` : '-')
  const dateStr = sale?.created_at
    ? new Date(sale.created_at).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
    : new Date().toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })

  const subtotal = Number(sale?.subtotal || items.reduce((s, i) => s + (Number(i.custom_price || i.sale_price || i.price || 0) * (Number(i.qty) || 1)), 0)).toFixed(0)
  const discount = Number(sale?.discount || sale?.totalDiscount || 0)
  const total = Number(sale?.total || sale?.total_amount || subtotal - discount).toFixed(0)
  const paid = Number(sale?.receivedAmount ?? sale?.paid_amount ?? total).toFixed(0)
  const change = Number(sale?.changeDue || 0)
  const balance = Number(customer?.outstanding_balance || 0)

  const invoiceUrl = invoiceToken ? buildPublicInvoiceUrl(`INV-${invoiceToken}`) : ''
  const englishLinkBlock = invoiceUrl ? `\n🔗 *Online Invoice & Download PDF:*\n${invoiceUrl}\n` : ''
  const urduLinkBlock = invoiceUrl ? `\n🔗 *آن لائن بل و پی ڈی ایف رسید (View & Download PDF):*\n${invoiceUrl}\n` : ''

  if (language === 'english') {
    const itemsText = items.map((i, idx) => {
      const name = i.name || i.model || 'Item'
      const imei = i.imei_1 || i.imei || ''
      const imeiStr = imei ? ` [IMEI: ${imei}]` : ''
      const qty = i.qty || 1
      const price = Number(i.custom_price || i.sale_price || i.price || 0).toLocaleString('en-PK')
      const lineTotal = (qty * Number(i.custom_price || i.sale_price || i.price || 0)).toLocaleString('en-PK')
      return `${idx + 1}. ${name}${imeiStr} × ${qty} @ Rs. ${price} = Rs. ${lineTotal}`
    }).join('\n')

    let paymentSummary = `• Subtotal: Rs. ${Number(subtotal).toLocaleString('en-PK')}`
    if (discount > 0) {
      paymentSummary += `\n• Discount: Rs. ${Number(discount).toLocaleString('en-PK')}`
    }
    paymentSummary += `\n• Net Total: Rs. ${Number(total).toLocaleString('en-PK')}\n• Received: Rs. ${Number(paid).toLocaleString('en-PK')}`
    if (change > 0) {
      paymentSummary += `\n• Change Returned: Rs. ${Number(change).toLocaleString('en-PK')}`
    }
    if (sale?.paymentType === 'credit' || balance > 0) {
      paymentSummary += `\n• Current Account Balance: Rs. ${Number(balance).toLocaleString('en-PK')}`
    }

    return `Assalam-o-Alaikum ${customerName}! 🤝
Thank you for shopping with us at *${shopName}*!

🧾 *INVOICE DETAILS*
Invoice #: ${publicInvoiceNo}
Date: ${dateStr}

📱 *Items Purchased:*
${itemsText}

💰 *Payment Summary:*
${paymentSummary}
${englishLinkBlock}
${effectiveWarranty}

Thank you for your business and trust! 🤝${shopPhone ? `\n📞 Contact: ${shopPhone}` : ''}`
  }

  // Urdu (default)
  const itemsText = items.map((i, idx) => {
    const name = i.name || i.model || 'Item'
    const imei = i.imei_1 || i.imei || ''
    const imeiStr = imei ? ` (IMEI: ${imei})` : ''
    const qty = i.qty || 1
    const price = Number(i.custom_price || i.sale_price || i.price || 0).toLocaleString('en-PK')
    const lineTotal = (qty * Number(i.custom_price || i.sale_price || i.price || 0)).toLocaleString('en-PK')
    return `${idx + 1}. ${name}${imeiStr}\n   تعداد: ${qty} | فی قیمت: Rs. ${price} | کل: Rs. ${lineTotal}`
  }).join('\n')

  let paymentInfoUrdu = `• کل رقم: Rs. ${Number(total).toLocaleString('en-PK')}\n• وصول رقم: Rs. ${Number(paid).toLocaleString('en-PK')}`
  if (change > 0) {
    paymentInfoUrdu += `\n• واپس شدہ بقایا: Rs. ${Number(change).toLocaleString('en-PK')}`
  }
  if (sale?.paymentType === 'credit' || balance > 0) {
    paymentInfoUrdu += `\n• کھاتہ بقایا جات: Rs. ${Number(balance).toLocaleString('en-PK')}`
  }

  return `السلام علیکم ${customerName}! 🤝
*${shopName}* سے خریداری کرنے کا بہت بہت شکریہ!

🧾 *بل کی تفصیلات (Invoice Details)*
📄 انوائس نمبر: ${publicInvoiceNo}
📅 تاریخ: ${dateStr}

📱 *خریدی گئی اشیاء:*
${itemsText}

💰 *ادائیگی کا خلاصہ:*
${paymentInfoUrdu}
${urduLinkBlock}
${effectiveWarranty}

آپ کے اعتماد اور تعاون کا شکریہ! 🤝${shopPhone ? `\n📞 رابطہ: ${shopPhone}` : ''}`
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

export const DEFAULT_EXCHANGE_WHATSAPP_TEMPLATE = `السلام علیکم [Name]! 🤝
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

/**
 * Renders a custom WhatsApp template for phone exchanges with data substitutions.
 */
export function renderCustomExchangeTemplate(template, { exchange, customer = null, shopInfo = {} }) {
  if (!template) return ''
  const customerName = exchange.customer_name || exchange.customer?.name || exchange.customers?.name || customer?.name || 'Valued Customer'
  const shopName = shopInfo.name || 'EdgeX Mobile Store'
  const shopPhone = shopInfo.phone || shopInfo.mobile || ''
  const exchangeToken = normalizeInvoiceToken(exchange.invoice_token)
  const exchangeNo = exchangeToken ? `EXC-${exchangeToken}` : (exchange.exchange_number || '-')
  const dateStr = exchange.created_at
    ? new Date(exchange.created_at).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
    : new Date().toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })

  // Extract Traded-in Phones (Incoming)
  const incoming = (
    exchange.exchange_items?.filter(i => i.item_direction === 'incoming_trade_in') ||
    exchange.incoming_items ||
    exchange.incomingPhones ||
    exchange.incoming ||
    []
  )

  // Extract Purchased Items (Outgoing)
  const outgoing = (
    exchange.exchange_items?.filter(i => i.item_direction === 'outgoing_sale') ||
    exchange.outgoing_items ||
    exchange.outgoingItems ||
    exchange.outgoing ||
    []
  )

  const incomingText = incoming.map((p, idx) => {
    const brandModel = `${p.brand || ''} ${p.model || p.product_name || 'Phone'}`.trim()
    const specs = [p.storage, p.color].filter(Boolean).join(', ')
    const specStr = specs ? ` (${specs})` : ''
    const imei1 = p.imei_1 ? `\n   • IMEI 1: ${p.imei_1}` : ''
    const imei2 = p.imei_2 ? `\n   • IMEI 2: ${p.imei_2}` : ''
    const condParts = []
    if (p.condition) condParts.push(p.condition)
    if (p.pta_status) condParts.push(p.pta_status)
    const condStr = condParts.length > 0 ? `\n   • حالت و پی ٹی اے: ${condParts.join(' | ')}` : ''
    const battery = p.inspection_details?.battery_health || p.battery_health
    const batteryStr = battery ? `\n   • بیٹری ہیلتھ: ${battery}%` : ''
    const val = Number(p.assessed_value || p.trade_in_value || p.subtotal || 0).toLocaleString('en-PK')
    return `${idx + 1}. *${brandModel}*${specStr}${imei1}${imei2}${condStr}${batteryStr}\n   • ٹریڈ ان ویلیو (Trade-in Credit): Rs. ${val}`
  }).join('\n\n') || 'کوئی پرانا فون نہیں (None)'

  const outgoingText = outgoing.map((i, idx) => {
    const desc = i.product_name || `${i.brand || ''} ${i.model || 'Phone'}`.trim()
    const specs = [i.storage, i.color].filter(Boolean).join(', ')
    const specStr = specs && !desc.includes(specs) ? ` (${specs})` : ''
    const imei1 = i.imei_1 ? `\n   • IMEI 1: ${i.imei_1}` : ''
    const imei2 = i.imei_2 ? `\n   • IMEI 2: ${i.imei_2}` : ''
    const qty = Number(i.quantity || i.qty || 1)
    const qtyStr = qty > 1 ? ` × ${qty}` : ''
    const lineTotal = Number(i.subtotal || i.line_total || ((Number(i.price || i.sale_price || i.assessed_value || 0)) * qty)).toLocaleString('en-PK')
    return `${idx + 1}. *${desc}*${specStr}${imei1}${imei2}\n   • قیمت خرید (Price): Rs. ${lineTotal}${qtyStr}`
  }).join('\n\n') || 'کوئی خریدا گیا فون نہیں (None)'

  const saleAmt = Number(exchange.sale_amount || 0)
  const tradeAmt = Number(exchange.trade_in_credit || 0)
  const settleAmt = Number(exchange.settlement_amount || 0)
  const direction = exchange.settlement_direction || 'even'
  const payMethod = (exchange.settlement_payment_method || 'Cash').toUpperCase()
  const netDiff = Math.abs(saleAmt - tradeAmt)

  let settlementText = ''
  if (direction === 'customer_paid') {
    settlementText = `• کسٹمر نے ادا کیا (Customer Paid via ${payMethod}): Rs. ${settleAmt.toLocaleString('en-PK')}`
  } else if (direction === 'shop_payout') {
    settlementText = `• دکان نے کسٹمر کو ادا کیا (Store Payout via ${payMethod}): Rs. ${settleAmt.toLocaleString('en-PK')}`
  } else {
    settlementText = `• برابری کا تبادلہ (Even Exchange): کوئی نقد لین دین نہیں (Rs. 0 ✅)`
  }

  const custBalance = Number(customer?.outstanding_balance ?? customer?.balance ?? exchange.customer_balance ?? 0)
  const shopId = shopInfo.id || shopInfo.shop_id || exchange.shop_id
  const effectiveWarranty = shopInfo.warranty_terms || (shopId ? getShopWarrantyTerms(shopId) : DEFAULT_WARRANTY_TERMS_URDU)

  let result = template
    .replace(/\[Name\]/g, customerName)
    .replace(/\[Customer Name\]/g, customerName)
    .replace(/\[Shop Name\]/g, shopName)
    .replace(/\[Exchange ID\]/g, exchangeNo)
    .replace(/\[ID\]/g, exchangeNo)
    .replace(/\[Invoice ID\]/g, exchangeNo)
    .replace(/\[Date\]/g, dateStr)
    .replace(/\[Outgoing Items\]/g, outgoingText)
    .replace(/\[Purchased Items\]/g, outgoingText)
    .replace(/\[Incoming Phones\]/g, incomingText)
    .replace(/\[Exchanged Phones\]/g, incomingText)
    .replace(/\[Trade-in Items\]/g, incomingText)
    .replace(/\[Sale Total\]/g, saleAmt.toLocaleString('en-PK'))
    .replace(/\[Trade-in Total\]/g, tradeAmt.toLocaleString('en-PK'))
    .replace(/\[Net Difference\]/g, netDiff.toLocaleString('en-PK'))
    .replace(/\[Settlement Details\]/g, settlementText)
    .replace(/\[Settlement\]/g, settlementText)
    .replace(/\[Paid\]/g, `${settleAmt.toLocaleString('en-PK')} (${payMethod})`)
    .replace(/\[Balance\]/g, custBalance > 0 ? custBalance.toLocaleString('en-PK') : '0 (مکمل کلیئر ✅)')
    .replace(/\[Remaining Due\]/g, '0 (مکمل کلیئر ✅)')
    .replace(/\[Customer Balance\]/g, custBalance.toLocaleString('en-PK'))
    .replace(/\[Warranty Terms\]/g, effectiveWarranty)
    .replace(/\[Warranty\]/g, effectiveWarranty)
    .replace(/\[Shop Phone\]/g, shopPhone)
    .replace(/\[Phone\]/g, shopPhone)

  // Inject or substitute the online invoice & PDF link, only for a server-stored token
  if (exchangeToken) {
    const exchangeUrl = buildPublicInvoiceUrl(`EXC-${exchangeToken}`)
    result = result
      .replace(/\[Invoice Link\]/g, exchangeUrl)
      .replace(/\[Invoice URL\]/g, exchangeUrl)
      .replace(/\[Link\]/g, exchangeUrl)
      .replace(/\[URL\]/g, exchangeUrl)

    if (!result.includes(exchangeUrl)) {
      result = replaceOrInjectInvoiceLinkInTemplate(result, exchangeUrl)
    }
  } else {
    result = stripInvoiceLinkBlock(result)
  }

  if (!template.includes('[Warranty Terms]') && !template.includes('[Warranty]') && !result.includes(effectiveWarranty)) {
    result = replaceOrInjectWarrantyInTemplate(result, effectiveWarranty)
  }

  return result
}

/**
 * Builds exchange confirmation memo for WhatsApp with traded-in phones,
 * purchased replacement devices, financial balance adjustment, and shop warranty terms.
 */
export function buildExchangeWhatsAppText({ exchange, customer = null, shopInfo = {} }) {
  // If custom exchange template is configured, render it
  if (shopInfo.wa_exchange_template && shopInfo.wa_exchange_template.trim().length > 20) {
    return renderCustomExchangeTemplate(shopInfo.wa_exchange_template, { exchange, customer, shopInfo })
  }

  const customerName = exchange.customer_name || exchange.customer?.name || exchange.customers?.name || customer?.name || 'Valued Customer'
  const shopName = shopInfo.name || 'EdgeX Mobile Store'
  const shopPhone = shopInfo.phone || shopInfo.mobile || ''
  const exchangeToken = normalizeInvoiceToken(exchange.invoice_token)
  const exchangeNo = exchangeToken ? `EXC-${exchangeToken}` : (exchange.exchange_number || '-')
  const dateStr = exchange.created_at
    ? new Date(exchange.created_at).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
    : new Date().toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })

  // Extract Traded-in Phones (Incoming)
  const incoming = (
    exchange.exchange_items?.filter(i => i.item_direction === 'incoming_trade_in') ||
    exchange.incoming_items ||
    exchange.incomingPhones ||
    exchange.incoming ||
    []
  )

  // Extract Purchased Replacement Items (Outgoing)
  const outgoing = (
    exchange.exchange_items?.filter(i => i.item_direction === 'outgoing_sale') ||
    exchange.outgoing_items ||
    exchange.outgoingItems ||
    exchange.outgoing ||
    []
  )

  const incomingText = incoming.map((p, idx) => {
    const brandModel = `${p.brand || ''} ${p.model || p.product_name || 'Phone'}`.trim()
    const specs = [p.storage, p.color].filter(Boolean).join(', ')
    const specStr = specs ? ` (${specs})` : ''
    const imei1 = p.imei_1 ? `\n   • IMEI 1: ${p.imei_1}` : ''
    const imei2 = p.imei_2 ? `\n   • IMEI 2: ${p.imei_2}` : ''
    const condParts = []
    if (p.condition) condParts.push(p.condition)
    if (p.pta_status) condParts.push(p.pta_status)
    const condStr = condParts.length > 0 ? `\n   • حالت و پی ٹی اے: ${condParts.join(' | ')}` : ''
    const battery = p.inspection_details?.battery_health || p.battery_health
    const batteryStr = battery ? `\n   • بیٹری ہیلتھ: ${battery}%` : ''
    const val = Number(p.assessed_value || p.trade_in_value || p.subtotal || 0).toLocaleString('en-PK')
    return `${idx + 1}. *${brandModel}*${specStr}${imei1}${imei2}${condStr}${batteryStr}\n   • ٹریڈ ان ویلیو (Trade-in Credit): Rs. ${val}`
  }).join('\n\n') || 'کوئی پرانا فون نہیں (None)'

  const outgoingText = outgoing.map((i, idx) => {
    const desc = i.product_name || `${i.brand || ''} ${i.model || 'Phone'}`.trim()
    const specs = [i.storage, i.color].filter(Boolean).join(', ')
    const specStr = specs && !desc.includes(specs) ? ` (${specs})` : ''
    const imei1 = i.imei_1 ? `\n   • IMEI 1: ${i.imei_1}` : ''
    const imei2 = i.imei_2 ? `\n   • IMEI 2: ${i.imei_2}` : ''
    const qty = Number(i.quantity || i.qty || 1)
    const qtyStr = qty > 1 ? ` × ${qty}` : ''
    const lineTotal = Number(i.subtotal || i.line_total || ((Number(i.price || i.sale_price || i.assessed_value || 0)) * qty)).toLocaleString('en-PK')
    return `${idx + 1}. *${desc}*${specStr}${imei1}${imei2}\n   • قیمت خرید (Price): Rs. ${lineTotal}${qtyStr}`
  }).join('\n\n') || 'کوئی خریدا گیا فون نہیں (None)'

  const saleAmt = Number(exchange.sale_amount || 0)
  const tradeAmt = Number(exchange.trade_in_credit || 0)
  const settleAmt = Number(exchange.settlement_amount || 0)
  const direction = exchange.settlement_direction || 'even'
  const payMethod = (exchange.settlement_payment_method || 'Cash').toUpperCase()

  const balanceLines = []
  balanceLines.push(`• خریدا گیا فون کل (Purchased Items Total): Rs. ${saleAmt.toLocaleString('en-PK')}`)
  balanceLines.push(`• پرانے فون کا کریڈٹ (Less Trade-in Credit): - Rs. ${tradeAmt.toLocaleString('en-PK')}`)
  balanceLines.push(`• خالص تبادلہ فرق (Net Exchange Difference): Rs. ${Math.abs(saleAmt - tradeAmt).toLocaleString('en-PK')}`)

  if (direction === 'customer_paid') {
    balanceLines.push(`• کسٹمر نے ادا کیا (Customer Paid via ${payMethod}): Rs. ${settleAmt.toLocaleString('en-PK')}`)
    balanceLines.push(`• بقایا واجب الادا (Remaining Balance Due): Rs. 0 (مکمل کلیئر ✅)`)
  } else if (direction === 'shop_payout') {
    balanceLines.push(`• دکان نے کسٹمر کو ادا کیا (Store Payout via ${payMethod}): Rs. ${settleAmt.toLocaleString('en-PK')}`)
    balanceLines.push(`• بقایا حساب (Balance Settled): Rs. 0 (مکمل ادا شدہ ✅)`)
  } else {
    balanceLines.push(`• برابری کا تبادلہ (Even Exchange): کوئی نقد لین دین نہیں (Rs. 0 ✅)`)
  }

  // Account Ledger / Prior Balance if any
  const custBalance = Number(customer?.outstanding_balance ?? customer?.balance ?? exchange.customer_balance ?? 0)
  if (custBalance > 0) {
    balanceLines.push(`• کسٹمر کھاتہ سابقہ بقایا جات (Prior Account Ledger): Rs. ${custBalance.toLocaleString('en-PK')}`)
  }

  // Fetch shop warranty details from settings/localStorage
  const shopId = shopInfo.id || shopInfo.shop_id || exchange.shop_id
  const effectiveWarranty = shopInfo.warranty_terms || (shopId ? getShopWarrantyTerms(shopId) : DEFAULT_WARRANTY_TERMS_URDU)
  const exchangeUrl = exchangeToken ? buildPublicInvoiceUrl(`EXC-${exchangeToken}`) : ''
  const exchangeLinkBlock = exchangeUrl
    ? `\n🔗 *آن لائن بل و پی ڈی ایف رسید (View & Download PDF):*\n${exchangeUrl}\n`
    : ''

  return `السلام علیکم ${customerName}! 🤝
*${shopName}* میں تشریف لانے اور فون ایکسچینج کرنے کا بہت بہت شکریہ!

🔄 *فون ایکسچینج بل و رسید (PHONE EXCHANGE INVOICE)*
📄 انوائس نمبر: ${exchangeNo}
📅 تاریخ: ${dateStr}

📤 *خریدا گیا فون / سامان (Purchased Items):*
${outgoingText}
• کل قیمت خرید: Rs. ${saleAmt.toLocaleString('en-PK')}

📥 *آپ کی طرف سے جمع کروایا گیا فون (Exchanged / Traded-in Phones):*
${incomingText}
• کل ٹریڈ ان کریڈٹ: Rs. ${tradeAmt.toLocaleString('en-PK')}

⚖️ *حتمی حساب و بقایا ایڈجسٹمنٹ (Balance Adjustment & Settlement):*
${balanceLines.join('\n')}
${exchangeLinkBlock}
${effectiveWarranty}

آپ کے اعتماد اور تعاون کا بے حد شکریہ! 🤝
🏪 *${shopName}*${shopPhone ? `\n📞 رابطہ: ${shopPhone}` : ''}`
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

    const newRef = { ...ref, invoice_token: token, ...(isExchange ? { exchange_number: publicNo } : { invoice_number: publicNo }) }
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
 * Bulk updates already saved pending WhatsApp messages in the outbox to include warranty terms.
 */
export async function updateExistingQueueMessagesWithWarranty(shopId, customWarranty = null) {
  const warrantyText = (customWarranty || getShopWarrantyTerms(shopId) || DEFAULT_WARRANTY_TERMS_URDU).trim()
  let updatedCount = 0

  try {
    // 0. Update directly in Supabase if online
    if (navigator.onLine && !isSupabaseTableMissing) {
      try {
        let q = supabase.from('whatsapp_queue').select('*').limit(100)
        if (shopId) {
          const numSid = !isNaN(Number(shopId)) ? Number(shopId) : shopId
          q = q.eq('shop_id', numSid)
        }
        const { data: supaRows } = await q
        if (Array.isArray(supaRows)) {
          for (const sItem of supaRows) {
            const text = sItem.message_text || ''
            if (!text.includes('/invoice/')) {
              const upgraded = upgradeLegacyWhatsAppMessage(text, sItem.shop_id || shopId, sItem.reference_data)
              if (upgraded && upgraded !== text) {
                await supabase.from('whatsapp_queue').update({ message_text: upgraded }).eq('id', sItem.id)
                if (db.whatsapp_queue) {
                  await db.whatsapp_queue.update(sItem.id, { message_text: upgraded }).catch(() => {})
                }
                updatedCount++
              }
            }
          }
        }
      } catch (_) {}
    }

    // 1. Update in Dexie
    if (db.whatsapp_queue) {
      const all = await db.whatsapp_queue.toArray()
      const shopItems = all.filter(item => {
        if (shopId && String(item.shop_id) !== String(shopId)) return false
        return item.status === 'pending' || !item.status
      })

      for (const item of shopItems) {
        const text = item.message_text || ''
        const upgraded = upgradeLegacyWhatsAppMessage(text, item.shop_id || shopId, item.reference_data)
        const finalText = hasWarrantyTerms(upgraded)
          ? upgraded
          : replaceOrInjectWarrantyInTemplate(upgraded, warrantyText)

        if (finalText && finalText !== text) {
          await db.whatsapp_queue.update(item.id, { message_text: finalText })
          updatedCount++

          // Mirror into Supabase
          if (navigator.onLine && !isSupabaseTableMissing) {
            try {
              await supabase
                .from('whatsapp_queue')
                .update({ message_text: finalText })
                .eq('id', item.id)
            } catch (_) {}
          }
        }
      }
    }

    // 2. Update in LocalStorage fallback queue
    try {
      const localQueue = getLocalStorageQueue()
      let lsUpdated = false
      const newLocalQueue = localQueue.map(item => {
        if (shopId && String(item.shop_id) !== String(shopId)) return item
        if (item.status && item.status !== 'pending') return item
        const text = item.message_text || ''
        const upgraded = upgradeLegacyWhatsAppMessage(text, item.shop_id || shopId, item.reference_data)
        const finalText = hasWarrantyTerms(upgraded)
          ? upgraded
          : replaceOrInjectWarrantyInTemplate(upgraded, warrantyText)

        if (finalText && finalText !== text) {
          lsUpdated = true
          return { ...item, message_text: finalText }
        }
        return item
      })
      if (lsUpdated) {
        saveLocalStorageQueue(newLocalQueue)
      }
    } catch (_) {}

  } catch (err) {
    console.warn('Error updating queue messages with warranty:', err)
  }

  return updatedCount
}
