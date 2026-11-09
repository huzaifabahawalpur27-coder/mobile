import { qrMatrix } from './qrMatrix'

/*
 * A4 PDF of the customer bill, drawn from the same view model as the online bill
 * (buildInvoiceView) so both always match. English parts are vector text; the Urdu
 * Nastaleeq warranty card is captured as an image (jsPDF's built-in fonts are Latin-1
 * only). Saves the file directly; never opens the print dialog.
 */

const C = {
  ink: [19, 27, 24], muted: [94, 108, 103], line: [225, 231, 228], tint: [244, 247, 246],
  accent: [13, 106, 90], ok: [15, 122, 79], okSoft: [228, 244, 235], due: [146, 85, 0], dueSoft: [253, 240, 216],
  chip: {
    plain: { fill: null, text: [94, 108, 103], border: [225, 231, 228] },
    new: { fill: [228, 244, 235], text: [15, 106, 69] },
    used: { fill: [237, 240, 245], text: [59, 72, 98] },
    pta: { fill: [226, 240, 236], text: [11, 92, 78] },
    nonpta: { fill: [251, 233, 231], text: [143, 45, 31] }
  }
}

const PAGE_W = 210
const PAGE_H = 297
const M = 14
const CW = PAGE_W - M * 2
const FOOTER_SPACE = 16

// jsPDF core fonts are WinAnsi/Latin-1: replace common symbols, drop the rest.
function latin(text) {
  return String(text ?? '')
    .replace(/[−–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
}
const needsImage = (text) => /[Ā-￿]/.test(String(text || ''))

/** Draws non-Latin text (e.g. an Urdu customer or shop name) as a small image. */
function drawTextImage(pdf, text, x, y, { size = 9, bold = false, color = C.ink, align = 'left', maxWidth = 80 } = {}) {
  try {
    const scale = 4
    const pxPerMm = 3.78 * scale
    const fontPx = size * 0.3528 * pxPerMm
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const font = `${bold ? '700' : '400'} ${fontPx}px 'Plus Jakarta Sans', 'Noto Nastaliq Urdu', 'Segoe UI', Tahoma, sans-serif`
    ctx.font = font
    const w = Math.min(ctx.measureText(text).width + 4, maxWidth * pxPerMm)
    const h = fontPx * 1.6
    canvas.width = Math.ceil(w)
    canvas.height = Math.ceil(h)
    ctx.font = font
    ctx.fillStyle = `rgb(${color.join(',')})`
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 2, h / 2, w - 4)
    const wMm = canvas.width / pxPerMm
    const hMm = canvas.height / pxPerMm
    const left = align === 'right' ? x - wMm : x
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', left, y - hMm * 0.68, wMm, hMm)
  } catch (_) {
    pdf.text(latin(text) || '-', x, y, { align })
  }
}

function text(pdf, value, x, y, { size = 9, bold = false, mono = false, color = C.ink, align = 'left', maxWidth } = {}) {
  if (needsImage(value) && !mono) return drawTextImage(pdf, String(value), x, y, { size, bold, color, align, maxWidth })
  pdf.setFont(mono ? 'courier' : 'helvetica', bold ? 'bold' : 'normal')
  pdf.setFontSize(size)
  pdf.setTextColor(...color)
  pdf.text(latin(value), x, y, maxWidth ? { align, maxWidth } : { align })
}

function wrap(pdf, value, width, size, bold = false) {
  pdf.setFont('helvetica', bold ? 'bold' : 'normal')
  pdf.setFontSize(size)
  return pdf.splitTextToSize(latin(value), width)
}

// ---------- measurements ----------
function chipRows(pdf, chips, width) {
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(7.5)
  const rows = [[]]
  let used = 0
  for (const chip of chips) {
    const w = pdf.getTextWidth(latin(chip.text)) + 4
    if (used + w > width && rows[rows.length - 1].length) { rows.push([]); used = 0 }
    rows[rows.length - 1].push({ ...chip, w })
    used += w + 1.5
  }
  return chips.length ? rows : []
}

function cardHeight(pdf, device, width) {
  const nameLines = wrap(pdf, device.name, width - 46, 10, true)
  const rows = chipRows(pdf, device.chips, width - 8)
  let h = 4 + nameLines.length * 4.6
  if (rows.length) h += 1.5 + rows.length * 5.2
  if (device.imeis.length) h += 2 + device.imeis.length * 4.4 + 3
  return { h: h + 3.5, nameLines, rows }
}

function drawCard(pdf, device, x, y, width) {
  const { h, nameLines, rows } = cardHeight(pdf, device, width)
  pdf.setDrawColor(...C.line)
  pdf.setLineWidth(0.3)
  pdf.roundedRect(x, y, width, h, 2, 2, 'S')
  let cy = y + 6
  nameLines.forEach((line, i) => text(pdf, line, x + 4, cy + i * 4.6, { size: 10, bold: true }))
  text(pdf, device.amountText, x + width - 4, cy, { size: 10, bold: true, mono: true, align: 'right' })
  pdf.setFont('courier', 'bold')
  pdf.setFontSize(10)
  const amountWidth = pdf.getTextWidth(latin(device.amountText))
  text(pdf, device.amountLabel, x + width - 4 - amountWidth - 1.5, cy, { size: 7, color: C.muted, align: 'right' })
  cy += (nameLines.length - 1) * 4.6 + 2.5
  if (rows.length) {
    cy += 1
    rows.forEach(row => {
      let cx = x + 4
      row.forEach(chip => {
        const style = C.chip[chip.tone] || C.chip.plain
        if (style.fill) {
          pdf.setFillColor(...style.fill)
          pdf.roundedRect(cx, cy, chip.w, 4.3, 1, 1, 'F')
        } else {
          pdf.setDrawColor(...style.border)
          pdf.setLineWidth(0.25)
          pdf.roundedRect(cx, cy, chip.w, 4.3, 1, 1, 'S')
        }
        text(pdf, chip.text, cx + 2, cy + 3.05, { size: 7.5, bold: Boolean(style.fill), color: style.text })
        cx += chip.w + 1.5
      })
      cy += 5.2
    })
  }
  if (device.imeis.length) {
    cy += 1
    const boxH = device.imeis.length * 4.4 + 3
    pdf.setFillColor(...C.tint)
    pdf.roundedRect(x + 4, cy, width - 8, boxH, 1.5, 1.5, 'F')
    device.imeis.forEach((row, i) => {
      const ry = cy + 4.4 + i * 4.4
      text(pdf, row.label, x + 7, ry, { size: 6.5, bold: true, color: C.muted })
      text(pdf, row.value, x + 22, ry, { size: 9, mono: true })
    })
  }
  return h
}

function drawQr(pdf, url, x, y, size) {
  const matrix = qrMatrix(url)
  if (!matrix) return false
  const cell = size / (matrix.size + 4)
  pdf.setFillColor(255, 255, 255)
  pdf.rect(x, y, size, size, 'F')
  pdf.setFillColor(...C.ink)
  for (let r = 0; r < matrix.size; r++) {
    let c = 0
    while (c < matrix.size) {
      if (!matrix.isDark(r, c)) { c++; continue }
      let run = 1
      while (c + run < matrix.size && matrix.isDark(r, c + run)) run++
      pdf.rect(x + (c + 2) * cell, y + (r + 2) * cell, run * cell + 0.01, cell + 0.01, 'F')
      c += run
    }
  }
  return true
}

async function captureWarranty(html2canvas, el) {
  if (!el || !html2canvas) return null
  try {
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, allowTaint: false, backgroundColor: '#fffaea', logging: false })
    if (canvas && canvas.width > 0 && canvas.height > 0) {
      return { data: canvas.toDataURL('image/png'), ratio: canvas.height / canvas.width }
    }
  } catch (err) {
    console.debug('Warranty capture via html2canvas failed, drawing it directly:', err)
  }
  return null
}

function drawWarrantyCanvas(view) {
  try {
    const width = 1100
    const lines = view.warrantyLines
    const lineH = 46
    const height = 70 + lines.length * lineH + 24
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fffaea'
    ctx.fillRect(0, 0, width, height)
    ctx.strokeStyle = '#e8cf86'
    ctx.lineWidth = 3
    ctx.strokeRect(2, 2, width - 4, height - 4)
    ctx.fillStyle = '#463710'
    ctx.font = '700 22px "Plus Jakarta Sans", "Segoe UI", sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('WARRANTY TERMS', 28, 44)
    ctx.font = '400 18px "Plus Jakarta Sans", "Segoe UI", sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(view.warrantyScope || '', width - 28, 44)
    ctx.fillStyle = '#2f250a'
    ctx.font = '26px "Noto Nastaliq Urdu", "Jameel Noori Nastaleeq", "Urdu Typesetting", Tahoma, serif'
    ctx.direction = 'rtl'
    lines.forEach((line, i) => ctx.fillText(line, width - 28, 92 + i * lineH))
    return { data: canvas.toDataURL('image/png'), ratio: height / width }
  } catch (_) {
    return null
  }
}

export async function generateInvoicePdf({ jsPDF, html2canvas, view, warrantyEl, filename }) {
  try { if (document.fonts?.ready) await document.fonts.ready } catch (_) { /* fonts optional */ }
  const warrantyImg = view.warrantyLines.length ? (await captureWarranty(html2canvas, warrantyEl)) || drawWarrantyCanvas(view) : null

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  let y = M
  const ensure = (h) => {
    if (y + h > PAGE_H - M - FOOTER_SPACE) { pdf.addPage(); y = M + 2 }
  }

  // Header
  const shop = view.shop
  let logoDrawn = false
  if (shop.logo && /^data:image\/(png|jpe?g)/i.test(shop.logo)) {
    try {
      pdf.addImage(shop.logo, /png/i.test(shop.logo.slice(0, 20)) ? 'PNG' : 'JPEG', M, y, 14, 14)
      logoDrawn = true
    } catch (_) { /* fall back to initials */ }
  }
  if (!logoDrawn) {
    pdf.setFillColor(...C.accent)
    pdf.roundedRect(M, y, 14, 14, 2.5, 2.5, 'F')
    text(pdf, shop.initials, M + 7, y + 9, { size: 11, bold: true, color: [255, 255, 255], align: 'center' })
  }
  text(pdf, shop.name, M + 18, y + 5.5, { size: 15, bold: true, maxWidth: 110 })
  const metaLines = wrap(pdf, [shop.address, shop.phone].filter(Boolean).join('  ·  '), 105, 8)
  metaLines.slice(0, 2).forEach((line, i) => text(pdf, line, M + 18, y + 10.5 + i * 3.6, { size: 8, color: C.muted }))
  text(pdf, view.docLabel.toUpperCase(), PAGE_W - M, y + 3.5, { size: 7.5, bold: true, color: C.accent, align: 'right' })
  text(pdf, view.billNo, PAGE_W - M, y + 9.5, { size: 13, bold: true, mono: true, align: 'right' })
  text(pdf, view.date, PAGE_W - M, y + 14, { size: 8, color: C.muted, align: 'right' })
  y += 19
  pdf.setDrawColor(...C.ink)
  pdf.setLineWidth(0.6)
  pdf.line(M, y, PAGE_W - M, y)
  y += 5

  // Status band
  const ok = view.status.tone === 'ok'
  pdf.setFillColor(...(ok ? C.okSoft : C.dueSoft))
  pdf.roundedRect(M, y, CW, 9, 2, 2, 'F')
  text(pdf, view.status.title, M + 4, y + 5.9, { size: 9.5, bold: true, color: ok ? C.ok : C.due })
  text(pdf, view.status.detail, PAGE_W - M - 4, y + 5.9, { size: 8, color: ok ? C.ok : C.due, align: 'right' })
  y += 13

  // Parties
  const colW = CW / view.parties.length
  view.parties.forEach((p, i) => {
    const x = M + i * colW
    text(pdf, p.label.toUpperCase(), x, y + 3, { size: 6.5, bold: true, color: C.muted })
    text(pdf, p.value, x, y + 8, { size: 9, bold: true, maxWidth: colW - 3 })
  })
  y += 13

  // Devices
  if (!view.isExchange) {
    ensure(10)
    text(pdf, view.devicesLabel.toUpperCase(), M, y + 3, { size: 7, bold: true, color: C.muted })
    y += 6
    for (const d of view.devices) {
      const { h } = cardHeight(pdf, d, CW)
      ensure(h + 3)
      drawCard(pdf, d, M, y, CW)
      y += h + 3
    }
  } else {
    const gap = 6
    const w = (CW - gap) / 2
    const colHeight = (list) => list.reduce((s, d) => s + cardHeight(pdf, d, w).h + 3, 0)
    ensure(Math.max(colHeight(view.given), colHeight(view.received)) + 8)
    text(pdf, 'GIVEN TO CUSTOMER', M, y + 3, { size: 7, bold: true, color: C.muted })
    text(pdf, 'RECEIVED FROM CUSTOMER (TRADE-IN)', M + w + gap, y + 3, { size: 7, bold: true, color: C.muted })
    y += 6
    let ly = y
    let ry = y
    view.given.forEach(d => { ly += drawCard(pdf, d, M, ly, w) + 3 })
    view.received.forEach(d => { ry += drawCard(pdf, d, M + w + gap, ry, w) + 3 })
    y = Math.max(ly, ry)
  }
  y += 2

  // Verify (QR) + totals / settlement
  const rightW = 78
  const leftW = CW - rightW - 6
  const rightX = PAGE_W - M - rightW
  let rightH
  if (!view.isExchange) {
    rightH = view.totals.length * 5.6 + 4 + (view.totals.findIndex(r => r.kind === 'net') > 0 ? 3 : 0)
  } else {
    rightH = 6 + 6 + wrap(pdf, view.settlement.who, rightW - 8, 8.5, true).length * 4 + 6
  }
  const blockH = Math.max(30, rightH)
  ensure(blockH + 4)

  pdf.setDrawColor(207, 216, 212)
  pdf.setLineWidth(0.3)
  pdf.setLineDashPattern([1.2, 1], 0)
  pdf.roundedRect(M, y, leftW, 30, 2, 2, 'S')
  pdf.setLineDashPattern([], 0)
  const hasQr = view.verifyUrl ? drawQr(pdf, view.verifyUrl, M + 3, y + 3, 24) : false
  const tx = M + (hasQr ? 30 : 4)
  if (view.verifyUrl) {
    text(pdf, 'Verify this bill', tx, y + 9, { size: 9, bold: true })
    text(pdf, hasQr ? 'Scan the code or open' : 'Open', tx, y + 13.5, { size: 7.5, color: C.muted })
    pdf.setFont('courier', 'normal')
    pdf.setFontSize(7)
    pdf.splitTextToSize(latin(String(view.verifyUrl).replace(/^https?:\/\//, '')), leftW - (tx - M) - 3)
      .slice(0, 3)
      .forEach((line, i) => text(pdf, line, tx, y + 18 + i * 3.3, { size: 7, mono: true }))
  } else {
    // No server-confirmed link: never print a QR that opens "Invoice not found"
    text(pdf, 'Online copy not available yet', tx, y + 9, { size: 9, bold: true })
    wrap(pdf, 'This bill has not reached the server yet, so it has no verification link or QR code.', leftW - 8, 7.5)
      .forEach((line, i) => text(pdf, line, tx, y + 14 + i * 3.6, { size: 7.5, color: C.muted }))
  }

  if (!view.isExchange) {
    let ty = y + 4
    view.totals.forEach((row, rowIndex) => {
      if (row.kind === 'net' && rowIndex > 0) {
        pdf.setDrawColor(...C.ink)
        pdf.setLineWidth(0.35)
        pdf.line(rightX, ty - 1, rightX + rightW, ty - 1)
        ty += 3
      }
      const color = row.kind === 'muted' ? C.muted : row.kind === 'bal' ? C.due : C.ink
      const size = row.kind === 'net' ? 10.5 : 8.5
      const bold = row.kind === 'net' || row.kind === 'bal'
      text(pdf, row.label, rightX, ty + 1.5, { size, bold, color })
      text(pdf, row.value, rightX + rightW, ty + 1.5, { size, bold, mono: true, color, align: 'right' })
      ty += 5.6
    })
  } else {
    pdf.setFillColor(...C.tint)
    pdf.roundedRect(rightX, y, rightW, rightH, 2, 2, 'F')
    text(pdf, 'SETTLEMENT', rightX + 4, y + 5, { size: 6.5, bold: true, color: C.muted })
    text(pdf, `${view.settlement.sale} - ${view.settlement.trade} = ${view.settlement.result}`, rightX + 4, y + 10.5, { size: 8, bold: true, mono: true })
    const whoColor = view.settlement.whoTone === 'due' ? C.due : C.ok
    wrap(pdf, view.settlement.who, rightW - 8, 8.5, true).forEach((line, i) => text(pdf, line, rightX + 4, y + 16 + i * 4, { size: 8.5, bold: true, color: whoColor }))
  }
  y += blockH + 6

  // Warranty card (image)
  if (warrantyImg) {
    const h = CW * warrantyImg.ratio
    ensure(h + 2)
    pdf.addImage(warrantyImg.data, 'PNG', M, y, CW, h)
    y += h + 5
  }

  // Exchange declaration
  if (view.declaration) {
    const lines = wrap(pdf, view.declaration, CW, 7.5)
    ensure(lines.length * 3.4 + 4)
    pdf.setDrawColor(...C.line)
    pdf.setLineWidth(0.3)
    pdf.line(M, y, PAGE_W - M, y)
    lines.forEach((line, i) => text(pdf, line, M, y + 4.5 + i * 3.4, { size: 7.5, color: C.muted }))
    y += lines.length * 3.4 + 6
  }

  // Footer on every page
  const pages = pdf.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p)
    const fy = PAGE_H - M
    pdf.setDrawColor(...C.line)
    pdf.setLineWidth(0.3)
    pdf.line(M, fy - 5, PAGE_W - M, fy - 5)
    text(pdf, `Computer-generated bill ${view.billNo}. No signature needed.`, M, fy - 1, { size: 7.5, color: C.muted })
    text(pdf, pages > 1 ? `Page ${p} of ${pages}` : `Thank you for your trust · ${shop.name}`, PAGE_W - M, fy - 1, { size: 7.5, color: C.muted, align: 'right' })
  }

  pdf.save(filename)
}
