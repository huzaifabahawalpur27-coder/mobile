/**
 * WhatsApp Helper Utilities & Templates for Superadmin
 */

export function cleanPhoneNumber(phone) {
  if (!phone) return ''
  let cleaned = phone.replace(/[^0-9]/g, '')
  if (cleaned.startsWith('03')) {
    cleaned = '92' + cleaned.substring(1)
  } else if (cleaned.length === 10 && !cleaned.startsWith('92')) {
    cleaned = '92' + cleaned
  }
  return cleaned
}

export function buildWhatsAppUrl(phone, message) {
  const cleaned = cleanPhoneNumber(phone)
  const encoded = encodeURIComponent(message)
  return cleaned ? `https://wa.me/${cleaned}?text=${encoded}` : `https://wa.me/?text=${encoded}`
}

export function formatOnboardingMessage({ shopName, username, password, planName, loginUrl = window.location.origin }) {
  return `🎉 *Welcome to EdgeX POS!*

Assalam-o-Alaikum,
Aapka POS store *${shopName}* kamyabi se active kar diya gaya hai!

🌐 *Login Portal:* ${loginUrl}
👤 *Username:* ${username}
🔑 *Password:* ${password}
📦 *Plan:* ${planName || 'Standard Plan'}

📌 *Hidayat:*
• Apne computer ya mobile browser mein Login Portal open karein.
• Uper diye gaye Username aur Password se login karein.
• First time products aur categories add karke sale shuru karein!

Kisi bhi sawal ya madad ke liye EdgeX Support se rabta karein.
Shukriya! 🚀`
}

export function formatUserCredentialsMessage({ shopName, username, password, role = 'Cashier', loginUrl = window.location.origin }) {
  return `🔑 *EdgeX POS - Staff Credentials*

Store: *${shopName}*
Aapka staff account create/update kar diya gaya hai:

🌐 *Login Portal:* ${loginUrl}
👤 *Username:* ${username}
🔑 *Password:* ${password}
💼 *Role:* ${role.toUpperCase()}

Kisi bhi madad ke liye apne store admin se rabta karein.`
}

export function formatPasswordResetMessage({ shopName, username, email, newPassword, loginUrl = (typeof window !== 'undefined' ? window.location.origin : 'https://pos.edgexsuite.com') }) {
  return `🔐 *EdgeX POS - Password Reset Notification*

Assalam-o-Alaikum,
Aapke store *${shopName}* ke primary account ka password reset kar diya gaya hai.

🌐 *Login Portal:* ${loginUrl}
👤 *Username:* ${username || email}
🔑 *New Password:* ${newPassword}

📌 *Hidayat:*
• Browser mein portal open karein aur naye password se login karein.
• Security ke liye login karne ke baad Settings se password tabdeel kar sakte hain.

Kisi bhi maslay ki surat mein EdgeX Superadmin se rabta karein.
Shukriya! 🛡️`
}

export function formatRenewalMessage({ shopName, planName, expiryDate, amount, bankDetails, isOverdue = false }) {
  const formattedDate = expiryDate ? new Date(expiryDate).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Soon'
  
  if (isOverdue) {
    return `⚠️ *URGENT: POS Subscription Overdue - ${shopName}*

Dear Customer,
Aapke store *${shopName}* ka EdgeX POS subscription (*${planName || 'Plan'}*) expire ho chuka hai.

📅 *Expiry Date:* ${formattedDate}
💰 *Payable Amount:* Rs. ${Number(amount || 0).toLocaleString()}

Bila-taatool service jari rakhne ke liye baraye meherbani foran payment clear karein taakay aapka store suspend na ho.

🏦 *Payment Account Details:*
${bankDetails || 'Bank: Meezan Bank / HBL\nJazzCash / EasyPaisa: 0300-XXXXXXX\nAccount Title: EdgeX POS'}

Payment ke baad screenshot isi WhatsApp par share karein.
Shukriya!
*EdgeX POS Administration*`
  }

  return `🔔 *Subscription Renewal Reminder - ${shopName}*

Assalam-o-Alaikum,
Aapke store *${shopName}* ka EdgeX POS subscription (*${planName || 'Plan'}*) jald expire hone wala hai.

📅 *Due Date:* ${formattedDate}
💰 *Subscription Fee:* Rs. ${Number(amount || 0).toLocaleString()}

Aapki billing aur POS services uninterrupted chalne ke liye baraye meherbani waqt par renewal ada farmayein.

🏦 *Payment Details:*
${bankDetails || 'Bank: Meezan Bank / HBL\nJazzCash / EasyPaisa: 0300-XXXXXXX\nAccount Title: EdgeX POS'}

Payment ke baad slip isi WhatsApp par share karein.
Shukriya!
*EdgeX POS Support Team*`
}

/**
 * Quick Invoice & Thank You WhatsApp Message Generator (English & Urdu)
 * Follows exact requirements:
 * - Starts with: Asslam o Alaikum [Customer Name],
 * - Itemized invoice breakdown & thank you note
 * - Ends with: [Shop Name] & [Shop Mobile]
 */
export function formatInvoiceWhatsAppMessage({ receipt, shopInfo, language = 'english' }) {
  const customerName = receipt?.customer?.name || 'Valued Customer'
  const shopName = shopInfo?.name || 'EdgeX POS Store'
  const shopPhone = shopInfo?.phone || shopInfo?.mobile || ''
  
  const invoiceId = receipt?.sale?.id ? String(receipt.sale.id).slice(-8) : String(Date.now()).slice(-8)
  const saleDate = receipt?.sale?.created_at
    ? new Date(receipt.sale.created_at).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })
    : new Date().toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })

  const items = receipt?.items || []
  const total = Number(receipt?.total ?? 0)
  const paid = receipt?.receivedAmount !== undefined 
    ? Math.min(total, Number(receipt.receivedAmount || 0))
    : (receipt?.sale?.payment_type === 'credit' ? 0 : total)
  const remainingBalance = Math.max(0, total - paid)
  const prevCustomerBalance = Number(receipt?.customer?.outstanding_balance || 0)
  const totalCustomerDue = remainingBalance > 0 ? (prevCustomerBalance + remainingBalance) : 0

  if (language === 'urdu') {
    const itemsList = items.map((i, idx) => {
      const q = Number(i.quantity || 1)
      const p = Number(i.unit_price || i.sale_price || i.price || 0)
      const lineTotal = Number(i.total_price || i.subtotal || (q * p))
      const extra = i.imei ? ` (IMEI: ${i.imei})` : ''
      return `${idx + 1}. *${i.name || i.product_name}* x ${q}${extra} — Rs. ${lineTotal.toLocaleString()}`
    }).join('\n')

    return `Asslam o Alaikum ${customerName},

*${shopName}* se khareedari karne ka buhat shukriya! Aapke bill ki tafseelat darj zail hain:

📄 *Bill / Invoice #:* INV-${invoiceId}
📅 *Tareekh:* ${saleDate}
${itemsList ? `\n📦 *Khareedari Items:*\n${itemsList}\n` : ''}
💰 *Kul Bill (Total):* Rs. ${total.toLocaleString()}
💵 *Ada Shuda (Paid):* Rs. ${paid.toLocaleString()}
${remainingBalance > 0 ? `⚠️ *Baqaya Is Bill Ka:* Rs. ${remainingBalance.toLocaleString()}\n` : ''}${totalCustomerDue > 0 ? `📒 *Kul Baqaya Balance:* Rs. ${totalCustomerDue.toLocaleString()}\n` : ''}
Aapke aitmaad aur taawun ka dil se shukriya. Dobara tashreef laane ka intezar rahega! 🤝

🏪 *${shopName}*${shopPhone ? `\n📞 *Rabta Number:* ${shopPhone}` : ''}`
  }

  // English Format
  const itemsList = items.map((i, idx) => {
    const q = Number(i.quantity || 1)
    const p = Number(i.unit_price || i.sale_price || i.price || 0)
    const lineTotal = Number(i.total_price || i.subtotal || (q * p))
    const extra = i.imei ? ` (IMEI: ${i.imei})` : ''
    return `${idx + 1}. *${i.name || i.product_name}* x ${q}${extra} — Rs. ${lineTotal.toLocaleString()}`
  }).join('\n')

  return `Asslam o Alaikum ${customerName},

Thank you for shopping at *${shopName}*! Here are your invoice details:

📄 *Invoice #:* INV-${invoiceId}
📅 *Date:* ${saleDate}
${itemsList ? `\n📦 *Items Purchased:*\n${itemsList}\n` : ''}
💰 *Total Bill:* Rs. ${total.toLocaleString()}
💵 *Amount Paid:* Rs. ${paid.toLocaleString()}
${remainingBalance > 0 ? `⚠️ *This Bill Balance:* Rs. ${remainingBalance.toLocaleString()}\n` : ''}${totalCustomerDue > 0 ? `📒 *Total Outstanding Balance:* Rs. ${totalCustomerDue.toLocaleString()}\n` : ''}
Thank you for your business and trust! We look forward to serving you again. 🤝

🏪 *${shopName}*${shopPhone ? `\n📞 *Contact:* ${shopPhone}` : ''}`
}

