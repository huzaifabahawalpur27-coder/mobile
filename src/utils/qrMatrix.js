import qrcode from 'qrcode-generator'

/**
 * QR code modules for a bill link, generated locally (the link is never sent anywhere).
 * Returns { size, isDark(row, col) } or null if the text cannot be encoded.
 */
export function qrMatrix(text) {
  if (!text) return null
  try {
    const qr = qrcode(0, 'M')
    qr.addData(String(text))
    qr.make()
    const size = qr.getModuleCount()
    return { size, isDark: (r, c) => qr.isDark(r, c) }
  } catch (err) {
    console.warn('QR code could not be generated:', err)
    return null
  }
}

/** SVG path data drawing every dark module as a 1x1 square. */
export function qrSvgPath(matrix) {
  if (!matrix) return ''
  let d = ''
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) {
      if (matrix.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
    }
  }
  return d
}
