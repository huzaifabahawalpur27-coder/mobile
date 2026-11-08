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

⚠️ *وارنٹی شرائط (Warranty Terms):*
۱۔ LCD، فیس لاک اور کیمرے کی کوئی وارنٹی نہیں ہوگی۔
۲۔ موبائل ڈیڈ ہونے کی صورت میں کوئی وارنٹی یا واپسی قبول نہیں کی جائے گی۔
۳۔ سیکنڈ ہینڈ موبائل کی کوئی وارنٹی نہیں ہوگی۔

آپ کے اعتماد اور تعاون کا شکریہ! 🤝
🏪 *[Shop Name]*
📞 رابطہ: [Phone]`.trim()

/**
 * Renders a custom WhatsApp template with sale data substitutions.
 */
export function renderCustomWhatsAppTemplate(template, { sale, customer, items = [], shopInfo = {} }) {
  if (!template) return ''
  const customerName = customer?.name || sale?.walkInName || 'Valued Customer'
  const shopName = shopInfo.name || 'EdgeX Mobile Store'
  const shopPhone = shopInfo.phone || shopInfo.mobile || ''
  const invoiceId = String(sale?.id || Date.now()).slice(-8).toUpperCase()
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
    const price = Number(i.custom_price || i.sale_price || i.price || i.unit_price || 0).toLocaleString()
    const lineTotal = (qty * Number(i.custom_price || i.sale_price || i.price || i.unit_price || 0)).toLocaleString()
    return `${idx + 1}. ${name}${imeiStr} × ${qty} @ Rs. ${price} = Rs. ${lineTotal}`
  }).join('\n')

  const modelText = items.map(i => `${i.name || i.model || ''}${i.imei_1 ? ` [${i.imei_1}]` : ''}`).filter(Boolean).join(', ') || 'Phone/Accessory'

  return template
    .replace(/\[Name\]/g, customerName)
    .replace(/\[Customer Name\]/g, customerName)
    .replace(/\[Shop Name\]/g, shopName)
    .replace(/\[ID\]/g, invoiceId)
    .replace(/\[Invoice ID\]/g, invoiceId)
    .replace(/\[Date\]/g, dateStr)
    .replace(/\[Items\]/g, itemsText || '1x Device')
    .replace(/\[Model\]/g, modelText)
    .replace(/\[Amount\]/g, totalNum.toLocaleString())
    .replace(/\[Total\]/g, totalNum.toLocaleString())
    .replace(/\[Paid\]/g, paidNum.toLocaleString())
    .replace(/\[Balance\]/g, balanceNum > 0 ? balanceNum.toLocaleString() : '0')
    .replace(/\[Phone\]/g, shopPhone)
    .replace(/\[Shop Phone\]/g, shopPhone)
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
  const urduWarrantyRegex = /⚠️\s*\*وارنٹی شرائط[\s\S]*?(?=\n\n(?:آپ کے اعتماد|🏪|📞|Thank you|$))/i
  const engWarrantyRegex = /⚠️\s*\*Warranty Terms[\s\S]*?(?=\n\n(?:Thank you|آپ کے اعتماد|🏪|📞|$))/i

  if (urduWarrantyRegex.test(template)) {
    return template.replace(urduWarrantyRegex, warranty).trim()
  }
  if (engWarrantyRegex.test(template)) {
    return template.replace(engWarrantyRegex, warranty).trim()
  }

  // If already has LCD / فیس لاک / سیکنڈ ہینڈ bullet points without header
  const rawTermsRegex = /(?:۱۔|1\.)\s*LCD[\s\S]*?(?=\n\n(?:آپ کے اعتماد|🏪|📞|Thank you|$))/i
  if (rawTermsRegex.test(template)) {
    return template.replace(rawTermsRegex, warranty).trim()
  }

  // If there's a footer greeting, inject before it
  if (template.includes('آپ کے اعتماد')) {
    const parts = template.split('آپ کے اعتماد')
    return `${parts[0].trim()}\n\n${warranty}\n\nآپ کے اعتماد${parts[1]}`.trim()
  }
  if (template.includes('Thank you for your business')) {
    const parts = template.split('Thank you for your business')
    return `${parts[0].trim()}\n\n${warranty}\n\nThank you for your business${parts[1]}`.trim()
  }

  return `${template.trim()}\n\n${warranty}`.trim()
}

/**
 * Builds invoice details and greetings with standard warranty terms.
 */
export function buildPhoneSaleReceiptText({ sale, customer, items = [], shopInfo = {}, language = 'english' }) {
  // If shop has custom template configured, render it
  if (shopInfo.wa_bill_template && shopInfo.wa_bill_template.trim().length > 20) {
    return renderCustomWhatsAppTemplate(shopInfo.wa_bill_template, { sale, customer, items, shopInfo })
  }

  const customerName = customer?.name || sale?.walkInName || 'Valued Customer'
  const shopName = shopInfo.name || 'EdgeX Mobile Store'
  const shopPhone = shopInfo.phone || ''
  const invoiceId = String(sale?.id || Date.now()).slice(-8).toUpperCase()
  const dateStr = sale?.created_at
    ? new Date(sale.created_at).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
    : new Date().toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })

  const subtotal = Number(sale?.subtotal || items.reduce((s, i) => s + (Number(i.custom_price || i.sale_price || i.price || 0) * (Number(i.qty) || 1)), 0)).toFixed(0)
  const discount = Number(sale?.discount || sale?.totalDiscount || 0)
  const total = Number(sale?.total || sale?.total_amount || subtotal - discount).toFixed(0)
  const paid = Number(sale?.receivedAmount ?? sale?.paid_amount ?? total).toFixed(0)
  const change = Number(sale?.changeDue || 0)
  const balance = Number(customer?.outstanding_balance || 0)
  const effectiveWarranty = shopInfo.warranty_terms || (shopInfo.shop_id ? getShopWarrantyTerms(shopInfo.shop_id) : DEFAULT_WARRANTY_TERMS_URDU)

  if (language === 'urdu') {
    const itemsText = items.map((i, idx) => {
      const name = i.name || i.model || 'Item'
      const imei = i.imei_1 || i.imei || ''
      const imeiStr = imei ? ` (IMEI: ${imei})` : ''
      const qty = i.qty || 1
      const price = Number(i.custom_price || i.sale_price || i.price || 0).toFixed(0)
      const lineTotal = (qty * price).toFixed(0)
      return `${idx + 1}. ${name}${imeiStr}\n   تعداد: ${qty} | فی قیمت: Rs. ${price} | کل: Rs. ${lineTotal}`
    }).join('\n')

    let paymentInfoUrdu = `• کل رقم: Rs. ${total}\n• وصول رقم: Rs. ${paid}`
    if (change > 0) {
      paymentInfoUrdu += `\n• واپس شدہ بقایا: Rs. ${change.toFixed(0)}`
    }
    if (sale?.paymentType === 'credit' || balance > 0) {
      paymentInfoUrdu += `\n• کھاتہ بقایا جات: Rs. ${balance.toFixed(0)}`
    }

    return `السلام علیکم ${customerName}! 🤝
${shopName} سے خریداری کرنے کا بہت بہت شکریہ!

🧾 *بل کی تفصیلات (Invoice Details)*
انوائس نمبر: INV-${invoiceId}
تاریخ: ${dateStr}

📱 *خریدی گئی اشیاء:*
${itemsText}

💰 *ادائیگی کا خلاصہ:*
${paymentInfoUrdu}

${effectiveWarranty}

آپ کے اعتماد اور تعاون کا شکریہ! 🤝${shopPhone ? `\n📞 رابطہ: ${shopPhone}` : ''}`
  }

  // English (default)
  const itemsText = items.map((i, idx) => {
    const name = i.name || i.model || 'Item'
    const imei = i.imei_1 || i.imei || ''
    const imeiStr = imei ? ` [IMEI: ${imei}]` : ''
    const qty = i.qty || 1
    const price = Number(i.custom_price || i.sale_price || i.price || 0).toFixed(0)
    const lineTotal = (qty * price).toFixed(0)
    return `${idx + 1}. ${name}${imeiStr} × ${qty} @ Rs. ${price} = Rs. ${lineTotal}`
  }).join('\n')

  let paymentSummary = `• Subtotal: Rs. ${subtotal}`
  if (discount > 0) {
    paymentSummary += `\n• Discount: Rs. ${discount.toFixed(0)}`
  }
  paymentSummary += `\n• Net Total: Rs. ${total}\n• Received: Rs. ${paid}`
  if (change > 0) {
    paymentSummary += `\n• Change Returned: Rs. ${change.toFixed(0)}`
  }
  if (sale?.paymentType === 'credit' || balance > 0) {
    paymentSummary += `\n• Current Account Balance: Rs. ${balance.toFixed(0)}`
  }

  return `Assalam-o-Alaikum ${customerName}! 🤝
Thank you for shopping with us at ${shopName}!

🧾 *INVOICE DETAILS*
Invoice #: INV-${invoiceId}
Date: ${dateStr}

📱 *Items Purchased:*
${itemsText}

💰 *Payment Summary:*
${paymentSummary}

${shopInfo.warranty_terms || DEFAULT_WARRANTY_TERMS_ENGLISH}

Thank you for your business and trust! 🤝${shopPhone ? `\n📞 Contact: ${shopPhone}` : ''}`
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
  const exchangeNo = exchange.exchange_number || (exchange.id ? `EXC-${String(exchange.id).slice(-6).toUpperCase()}` : `EXC-${String(Date.now()).slice(-6)}`)
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
  const exchangeNo = exchange.exchange_number || (exchange.id ? `EXC-${String(exchange.id).slice(-6).toUpperCase()}` : `EXC-${String(Date.now()).slice(-6)}`)
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

  const queueItem = {
    id: crypto.randomUUID(),
    shop_id: shop_id ? (isNaN(Number(shop_id)) ? shop_id : Number(shop_id)) : null,
    recipient_name: recipient_name || 'Customer',
    recipient_phone: cleanedPhone,
    message_type,
    reference_id: reference_id ? String(reference_id) : null,
    reference_data: reference_data ? JSON.parse(JSON.stringify(reference_data)) : null,
    message_text: message_text || '',
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

  return Array.from(mergedMap.values())
    .filter(isSoldPhoneQueueItem)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
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
 * Bulk updates already saved pending WhatsApp messages in the outbox to include warranty terms.
 */
export async function updateExistingQueueMessagesWithWarranty(shopId, customWarranty = null) {
  const warrantyText = (customWarranty || getShopWarrantyTerms(shopId) || DEFAULT_WARRANTY_TERMS_URDU).trim()
  let updatedCount = 0

  try {
    // 1. Update in Dexie
    if (db.whatsapp_queue) {
      const all = await db.whatsapp_queue.toArray()
      const shopItems = all.filter(item => {
        if (shopId && String(item.shop_id) !== String(shopId)) return false
        return item.status === 'pending' || !item.status
      })

      for (const item of shopItems) {
        const text = item.message_text || ''
        // Check if message already has the exact current warranty terms
        if (!text.includes(warrantyText)) {
          const updatedText = replaceOrInjectWarrantyInTemplate(text, warrantyText)
          if (updatedText && updatedText !== text) {
            await db.whatsapp_queue.update(item.id, { message_text: updatedText })
            updatedCount++

            // Mirror into Supabase
            if (navigator.onLine && !isSupabaseTableMissing) {
              try {
                await supabase
                  .from('whatsapp_queue')
                  .update({ message_text: updatedText })
                  .eq('id', item.id)
              } catch (_) {}
            }
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
        const text = item.message_text || ''
        if (!text.includes(warrantyText)) {
          const updatedText = replaceOrInjectWarrantyInTemplate(text, warrantyText)
          if (updatedText && updatedText !== text) {
            lsUpdated = true
            return { ...item, message_text: updatedText }
          }
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
