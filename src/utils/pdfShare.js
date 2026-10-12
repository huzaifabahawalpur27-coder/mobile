// pdfShare.js — Generate PDFs and share via WhatsApp
// Uses action-time dynamic imports so PDF libraries do not bloat route chunks.

async function loadJsPDF() {
  const [jspdfMod, autotableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable')
  ])
  const jsPDF = jspdfMod.jsPDF || jspdfMod.default?.jsPDF || jspdfMod.default
  const autoTable = autotableMod.default || autotableMod.autoTable || autotableMod
  return { jsPDF, autoTable }
}

async function loadHtml2Canvas() {
  const mod = await import('html2canvas')
  return mod.default || mod
}

function sanitizeBillHTML(htmlString) {
  const template = document.createElement('template')
  template.innerHTML = htmlString
  template.content.querySelectorAll('script').forEach(node => node.remove())
  template.content.querySelectorAll('*').forEach(node => {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim().toLowerCase()
      if (name.startsWith('on') || value.startsWith('javascript:')) {
        node.removeAttribute(attr.name)
      }
    }
  })
  return template.innerHTML
}

// ─── Bill / Quotation PDF (renders existing bill HTML) ────────────────────────

/**
 * Pure vector receipt PDF generator using jsPDF + autoTable.
 * Runs instantly without DOM rendering or canvas security restrictions.
 */
export async function generateReceiptVectorPDF(receiptData) {
  const { jsPDF, autoTable } = await loadJsPDF()
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const sid = receiptData?.shop_id || receiptData?.sale?.shop_id
  let savedSettings = {}
  try {
    savedSettings = JSON.parse((sid ? localStorage.getItem(`shop_settings_${sid}`) : null) || localStorage.getItem('shop_settings') || '{}')
  } catch (_) {
    // Ignore invalid JSON in settings
  }

  const shopName = (sid ? localStorage.getItem(`shop_name_${sid}`) : null) || savedSettings.name || 'EdgeX Digital POS'
  const shopPhone = savedSettings.phone || ''
  const shopAddress = savedSettings.address || ''

  const isQuotation = Boolean(receiptData?.isQuotation)
  const docTitle = isQuotation ? 'QUOTATION' : 'SALES INVOICE'
  const saleId = receiptData?.sale?.id ? String(receiptData.sale.id).slice(-8) : Date.now().toString().slice(-8)
  const dateStr = receiptData?.sale?.created_at ? new Date(receiptData.sale.created_at).toLocaleString('en-PK') : new Date().toLocaleString('en-PK')
  const custName = receiptData?.customer?.name || receiptData?.walkInName || 'Walk-in Customer'
  const custPhone = receiptData?.customer?.phone || ''

  // 1. Header
  pdf.setFontSize(16)
  pdf.setFont('helvetica', 'bold')
  pdf.text(shopName, 105, 18, { align: 'center' })

  let currentY = 25
  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'normal')
  if (shopPhone || shopAddress) {
    const contactLine = [shopPhone, shopAddress].filter(Boolean).join('  |  ')
    pdf.text(contactLine, 105, currentY, { align: 'center' })
    currentY += 6
  }

  pdf.setFontSize(11)
  pdf.setFont('helvetica', 'bold')
  pdf.text(docTitle, 105, currentY, { align: 'center' })
  currentY += 8

  // 2. Info Box
  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'normal')
  pdf.text(`Invoice #: ${saleId}`, 14, currentY)
  pdf.text(`Date: ${dateStr}`, 196, currentY, { align: 'right' })
  currentY += 5
  pdf.text(`Customer: ${custName}${custPhone ? ' (' + custPhone + ')' : ''}`, 14, currentY)
  pdf.text(`Payment: ${String(receiptData?.paymentType || 'CASH').toUpperCase()}`, 196, currentY, { align: 'right' })
  currentY += 7

  // 3. Items Table
  const items = receiptData?.items || []
  const tableRows = items.map(item => {
    const name = item.name || item.product_name || (item.brand && item.model ? `${item.brand} ${item.model}` : 'Item')
    const qty = Number(item.qty || item.quantity || 1)
    const price = Number(item.custom_price ?? item.unit_price ?? item.price ?? 0)
    const total = qty * price
    return [name, String(qty), `Rs. ${price.toLocaleString()}`, `Rs. ${total.toLocaleString()}`]
  })

  autoTable(pdf, {
    startY: currentY,
    head: [['Item Description', 'Qty', 'Unit Price', 'Total']],
    body: tableRows,
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 95 },
      1: { cellWidth: 20, halign: 'center' },
      2: { cellWidth: 35, halign: 'right' },
      3: { cellWidth: 35, halign: 'right' }
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 }
  })

  currentY = pdf.lastAutoTable.finalY + 6

  // 4. Totals Block
  const subtotal = Number(receiptData?.subtotal || receiptData?.total || 0)
  const discount = Number(receiptData?.totalDiscount || 0)
  const grandTotal = Number(receiptData?.total || 0)
  const received = Number(receiptData?.receivedAmount || grandTotal)
  const change = Number(receiptData?.changeDue || 0)

  pdf.setFontSize(9)
  pdf.text(`Subtotal:`, 145, currentY)
  pdf.text(`Rs. ${subtotal.toLocaleString()}`, 196, currentY, { align: 'right' })
  currentY += 5

  if (discount > 0) {
    pdf.text(`Discount:`, 145, currentY)
    pdf.text(`-Rs. ${discount.toLocaleString()}`, 196, currentY, { align: 'right' })
    currentY += 5
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.text(`Grand Total:`, 145, currentY)
  pdf.text(`Rs. ${grandTotal.toLocaleString()}`, 196, currentY, { align: 'right' })
  currentY += 6

  if (received > 0 && !isQuotation) {
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    pdf.text(`Amount Paid:`, 145, currentY)
    pdf.text(`Rs. ${received.toLocaleString()}`, 196, currentY, { align: 'right' })
    currentY += 5
    if (change > 0) {
      pdf.text(`Change Due:`, 145, currentY)
      pdf.text(`Rs. ${change.toLocaleString()}`, 196, currentY, { align: 'right' })
      currentY += 5
    }
  }

  // 5. Footer
  currentY += 10
  pdf.setFontSize(8)
  pdf.setFont('helvetica', 'italic')
  pdf.text(savedSettings.invoice_footer || 'Thank you for your business!', 105, currentY, { align: 'center' })
  pdf.text('Generated by EdgeX Digital POS', 105, currentY + 4, { align: 'center' })

  return pdf.output('blob')
}

/**
 * Generate a PDF from the bill HTML string with automatic vector jsPDF fallback.
 * Returns a Blob (PDF).
 */
export async function generateBillPDF(htmlString, receiptData = null) {
  try {
    const { jsPDF } = await loadJsPDF()
    const html2canvas = await loadHtml2Canvas()

    // Mount container safely (invisible, on-screen to avoid zero-size bugs)
    const container = document.createElement('div')
    const isA4 = htmlString.includes('size:A4') || htmlString.includes('page{size:A4')
    container.style.cssText = `position:fixed;top:0;left:0;width:${isA4 ? '794px' : '360px'};background:#ffffff;z-index:-9999;opacity:0.01;pointer-events:none;padding:12px;font-family:sans-serif;`
    container.innerHTML = sanitizeBillHTML(htmlString)

    // Handle remote images: remove cross-origin untrusted images to prevent canvas tainting
    const images = container.querySelectorAll('img')
    images.forEach(img => {
      if (img.src && !img.src.startsWith('data:') && !img.src.startsWith(window.location.origin)) {
        img.crossOrigin = 'anonymous'
        img.onerror = () => img.remove()
      }
    })

    document.body.appendChild(container)

    try {
      await new Promise(r => setTimeout(r, 200))

      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        allowTaint: false, // Must be false so toDataURL never throws SecurityError
        backgroundColor: '#ffffff',
        logging: false,
      })

      const imgData = canvas.toDataURL('image/jpeg', 0.92)
      const pxW = canvas.width
      const pxH = canvas.height

      const pdfW = 190
      const pdfH = (pxH / pxW) * pdfW
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      pdf.addImage(imgData, 'JPEG', 10, 10, pdfW, pdfH)

      return pdf.output('blob')
    } finally {
      if (container.parentNode) {
        container.parentNode.removeChild(container)
      }
    }
  } catch (canvasErr) {
    console.warn('html2canvas failed, falling back to direct vector jsPDF receipt:', canvasErr)
    if (receiptData) {
      return await generateReceiptVectorPDF(receiptData)
    }
    throw canvasErr
  }
}

// ─── Outstanding Balance PDF ──────────────────────────────────────────────────

/**
 * Generate an outstanding statement PDF.
 * @param {object} customer  — { name, phone, address, outstanding_balance }
 * @param {Array}  ledger    — [{ date, type, amount, paid_amount, note, balance }]
 * @param {string|object} shopInfo — shop name string OR { name, phone, address }
 * Returns a Blob (PDF).
 */
export async function generateOutstandingPDF(customer, ledger, shopInfo) {
  const { jsPDF, autoTable } = await loadJsPDF()
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const today = new Date().toLocaleDateString('en-PK')

  // Support both legacy string and new shopInfo object
  const shopName    = (typeof shopInfo === 'string' ? shopInfo : shopInfo?.name)   || 'Shop'
  const shopPhone   = typeof shopInfo === 'object' ? (shopInfo?.phone   || '') : ''
  const shopAddress = typeof shopInfo === 'object' ? (shopInfo?.address || '') : ''

  // Header
  pdf.setFontSize(16)
  pdf.setFont('helvetica', 'bold')
  pdf.text(shopName, 105, 18, { align: 'center' })

  let headerY = 26
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  if (shopPhone || shopAddress) {
    const contactLine = [shopPhone, shopAddress].filter(Boolean).join('  |  ')
    pdf.text(contactLine, 105, headerY, { align: 'center' })
    headerY += 7
  }

  pdf.setFontSize(11)
  pdf.setFont('helvetica', 'normal')
  pdf.text('Customer Outstanding Statement', 105, headerY, { align: 'center' })

  pdf.setFontSize(9)
  pdf.text(`Date: ${today}`, 195, 18, { align: 'right' })

  const customerInfoY = headerY + 10
  // Customer info
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Customer:', 14, customerInfoY)
  pdf.setFont('helvetica', 'normal')
  pdf.text(`${customer.name}  |  ${customer.phone || ''}  |  ${customer.address || ''}`, 38, customerInfoY)

  // Outstanding box
  const bal = customer.outstanding_balance || 0
  pdf.setFillColor(bal > 0 ? 255 : 230, bal > 0 ? 230 : 255, 230)
  pdf.roundedRect(14, customerInfoY + 4, 182, 10, 2, 2, 'F')
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(bal > 0 ? 180 : 0, 0, bal > 0 ? 0 : 0)
  pdf.text(`Total Outstanding: Rs. ${(bal || 0).toLocaleString()}`, 105, customerInfoY + 11, { align: 'center' })
  pdf.setTextColor(0, 0, 0)

  // Ledger table
  const rows = ledger.map(item => {
    const date = item.date ? new Date(item.date).toLocaleDateString('en-PK') : ''
    const desc = item.type === 'payment'
      ? `Payment${item.note ? ' — ' + item.note : ''}`
      : item.type === 'return'
        ? `Return${item.note ? ' — ' + item.note : ''}`
        : `Sale${item.note ? ' — ' + item.note : ''}`
    const debit  = item.type === 'sale'    ? `Rs. ${(item.amount || 0).toLocaleString()}` : ''
    const credit = item.type === 'payment' ? `Rs. ${(item.paid_amount || item.amount || 0).toLocaleString()}` : ''
    const ret    = item.type === 'return'  ? `Rs. ${(item.amount || 0).toLocaleString()}` : ''
    const runBal = item.balance !== undefined ? `Rs. ${(item.balance || 0).toLocaleString()}` : ''
    return [date, desc, debit, credit || ret, runBal]
  })

  autoTable(pdf, {
    startY: customerInfoY + 18,
    head: [['Date', 'Description', 'Debit (Sale)', 'Credit (Payment)', 'Balance']],
    body: rows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 70 },
      2: { cellWidth: 28, halign: 'right' },
      3: { cellWidth: 32, halign: 'right' },
      4: { cellWidth: 28, halign: 'right' },
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  })

  // Footer
  const finalY = pdf.lastAutoTable.finalY + 6
  pdf.setFontSize(8)
  pdf.setFont('helvetica', 'italic')
  pdf.text('Generated by EdgeX POS', 105, finalY, { align: 'center' })

  return pdf.output('blob')
}

// ─── Purchase Order PDF ───────────────────────────────────────────────────────

/**
 * Generate a purchase order PDF.
 * @param {object} bySupplier — { supplierName: { phone, items: [product...] } }
 * @param {string|object} shopInfo — shop name string OR { name, phone, address }
 * Returns a Blob (PDF).
 */
export async function generatePurchaseOrderPDF(bySupplier, shopInfo) {
  const { jsPDF, autoTable } = await loadJsPDF()
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const today = new Date().toLocaleDateString('en-PK')
  const supplierNames = Object.keys(bySupplier)

  // Support both legacy string and new shopInfo object
  const shopName    = (typeof shopInfo === 'string' ? shopInfo : shopInfo?.name)   || 'Purchase Order'
  const shopPhone   = typeof shopInfo === 'object' ? (shopInfo?.phone   || '') : ''
  const shopAddress = typeof shopInfo === 'object' ? (shopInfo?.address || '') : ''

  // Header
  pdf.setFontSize(16)
  pdf.setFont('helvetica', 'bold')
  pdf.text(shopName, 105, 18, { align: 'center' })

  let headerY = 26
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  if (shopPhone || shopAddress) {
    const contactLine = [shopPhone, shopAddress].filter(Boolean).join('  |  ')
    pdf.text(contactLine, 105, headerY, { align: 'center' })
    headerY += 7
  }

  pdf.setFontSize(11)
  pdf.setFont('helvetica', 'normal')
  pdf.text('Reorder / Purchase Order', 105, headerY, { align: 'center' })

  pdf.setFontSize(9)
  pdf.text(`Date: ${today}`, 195, 18, { align: 'right' })

  let currentY = headerY + 8

  supplierNames.forEach((supName, idx) => {
    const sup = bySupplier[supName]

    // Supplier section header
    pdf.setFontSize(10)
    pdf.setFont('helvetica', 'bold')
    pdf.setFillColor(229, 231, 235)
    pdf.rect(14, currentY, 182, 7, 'F')
    pdf.text(`Supplier: ${supName}${sup.phone ? '  |  ' + sup.phone : ''}`, 16, currentY + 5)
    currentY += 9

    const rows = sup.items.map(p => {
      const need = Math.max(0, (p.low_stock_threshold || 10) * 2 - p.stock_quantity)
      return [
        p.name || '',
        p.categories?.name || '',
        String(p.stock_quantity ?? 0),
        String(p.low_stock_threshold || 10),
        String(need),
        p.cost_price ? `Rs. ${p.cost_price}` : '',
      ]
    })

    autoTable(pdf, {
      startY: currentY,
      head: [['Product', 'Category', 'In Stock', 'Min Stock', 'Order Qty', 'Cost Price']],
      body: rows,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 55 },
        1: { cellWidth: 30 },
        2: { cellWidth: 18, halign: 'center' },
        3: { cellWidth: 18, halign: 'center' },
        4: { cellWidth: 22, halign: 'center' },
        5: { cellWidth: 25, halign: 'right' },
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14 },
    })

    currentY = pdf.lastAutoTable.finalY + 8

    // Add new page if running out of space
    if (idx < supplierNames.length - 1 && currentY > 250) {
      pdf.addPage()
      currentY = 14
    }
  })

  // Footer
  pdf.setFontSize(8)
  pdf.setFont('helvetica', 'italic')
  pdf.text('Generated by EdgeX POS', 105, currentY + 4, { align: 'center' })

  return pdf.output('blob')
}

// ─── Share / Download Helper ──────────────────────────────────────────────────

/**
 * Download the PDF and open WhatsApp Web in a new tab.
 * On Android Chrome, also tries native share sheet (file attach).
 * On desktop (Windows/Mac), skips share dialog — just downloads + opens WA.
 *
 * @param {Blob}   pdfBlob
 * @param {string} filename    e.g. 'bill-12345.pdf'
 * @param {string} phone       formatted phone (e.g. '923001234567') — optional
 * @param {string} message     text message for WA
 */
export async function shareOrDownloadPDF(pdfBlob, filename, phone, message) {
  // On Android Chrome, Web Share with files opens the OS share sheet (includes WhatsApp app)
  // On Windows/Mac, navigator.canShare returns true but opens Windows share dialog (no WhatsApp)
  // So only use Web Share on touch/mobile devices
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  const file = new File([pdfBlob], filename, { type: 'application/pdf' })

  if (isMobile && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename, text: message || '' })
      return
    } catch (err) {
      if (err.name === 'AbortError') return // user cancelled
      // fall through to download + WA link
    }
  }

  // Desktop / fallback: auto-download the PDF, then open WhatsApp Web tab
  const url = URL.createObjectURL(pdfBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)

  // Open WhatsApp with message — user can attach the downloaded PDF manually
  if (phone || message) {
    const waUrl = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(message || '')}`
      : `https://wa.me/?text=${encodeURIComponent(message || '')}`
    setTimeout(() => window.open(waUrl, '_blank'), 600)
  }
}
