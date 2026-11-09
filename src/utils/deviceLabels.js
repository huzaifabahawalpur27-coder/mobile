/**
 * Shared phone/device wording for WhatsApp receipts, the online bill and the PDF,
 * so every place shows the same name, IMEI, condition and PTA labels.
 */

function parseSnapshot(raw) {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try { return JSON.parse(raw) } catch (_) { return {} }
  }
  return {}
}

/** Removes "[IMEI: …]" / "(IMEI …)" tags that older code appended to product names. */
export function cleanDeviceName(raw) {
  return String(raw || '')
    .replace(/\[(?:IMEI:?\s*)?[0-9a-zA-Z\s/-]+\]/gi, '')
    .replace(/\((?:IMEI:?\s*)?[0-9]{8,}[0-9\s/-]*\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const titleCase = (s) => String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim()

/** "new" | "used" | "" for colour-coding. */
export function conditionTone(raw) {
  const c = String(raw || '').toLowerCase()
  if (!c) return ''
  if (c === 'new' || c.includes('brand') || c.includes('box')) return 'new'
  return 'used'
}

export function conditionLabel(raw, lang = 'en') {
  const c = String(raw || '').toLowerCase().trim()
  if (!c) return ''
  if (c === 'new' || c.includes('brand') || c === 'box_pack' || c === 'box pack') return lang === 'ur' ? 'New (Box Pack)' : 'New (box pack)'
  if (c.includes('open')) return 'Open box'
  if (c.includes('refurb')) return 'Refurbished'
  if (c.includes('used') || c.includes('pre')) return 'Used'
  return titleCase(raw)
}

/** "approved" | "not" | "" for colour-coding. */
export function ptaTone(raw) {
  const p = String(raw || '').toLowerCase()
  if (!p) return ''
  if (p.includes('non') || p === 'not_approved' || p.includes('blocked') || p.includes('patch')) return 'not'
  return 'approved'
}

export function ptaLabel(raw) {
  const p = String(raw || '').toLowerCase().trim()
  if (!p) return ''
  if (p === 'approved' || p.includes('official') || p === 'pta' || p === 'pta_approved') return 'PTA Approved'
  if (p.includes('non') || p === 'not_approved') return 'Non-PTA'
  if (p.includes('cpid')) return 'CPID Approved'
  if (p === 'jv' || p.includes('jv')) return 'JV'
  if (p.includes('patch')) return 'Patched'
  return titleCase(raw)
}

/** 356789104523781 -> 35-678910-452378-1 (reporting body, TAC, serial, check digit). */
export function formatImeiGrouped(imei) {
  const s = String(imei || '').replace(/\s+/g, '')
  return /^\d{15}$/.test(s) ? `${s.slice(0, 2)}-${s.slice(2, 8)}-${s.slice(8, 14)}-${s.slice(14)}` : s
}

/**
 * Normalizes a cart line, sale_item, exchange_item or public-invoice item into one shape.
 */
export function normalizeDevice(item = {}) {
  const snap = parseSnapshot(item.imei_snapshot)
  const rawSnapImei = typeof item.imei_snapshot === 'string' && !item.imei_snapshot.trim().startsWith('{') ? item.imei_snapshot.trim() : ''
  const brand = item.brand || snap.brand || ''
  const model = item.model || snap.model || ''
  let name = cleanDeviceName(item.name || item.product_name || '')
  if (!name) name = `${brand} ${model}`.trim()
  const storage = item.storage || snap.storage || ''
  const color = item.color || snap.color || ''
  const nameLower = name.toLowerCase()
  const battery = item.battery_health || item.inspection_details?.battery_health || snap.battery_health || ''
  const imei1 = String(item.imei_1 || item.imei || snap.imei_1 || rawSnapImei || '').trim()
  const imei2 = String(item.imei_2 || snap.imei_2 || '').trim()
  const condition = item.condition || snap.condition || ''
  const pta = item.pta_status || snap.pta_status || ''
  return {
    name: name || 'Item',
    // Only list storage/colour separately when the name does not already contain them
    storage: storage && !nameLower.includes(String(storage).toLowerCase()) ? storage : '',
    color: color && !nameLower.includes(String(color).toLowerCase()) ? color : '',
    imei1,
    imei2: imei2 && imei2 !== imei1 ? imei2 : '',
    condition,
    pta,
    battery: battery ? String(battery).replace(/%$/, '') : '',
    isPhone: Boolean(imei1 || item.phone_id || item.is_phone || item.item_type === 'phone' || pta)
  }
}

export function paymentMethodLabel(raw, lang = 'en') {
  const m = String(raw || '').toLowerCase().trim()
  if (!m || m === 'cash') return lang === 'ur' ? 'Cash' : 'Cash'
  if (m === 'credit' || m === 'udhaar') return lang === 'ur' ? 'ادھار (Credit)' : 'Credit'
  if (m === 'split') return lang === 'ur' ? 'Split (ملا جلا)' : 'Split payment'
  if (m === 'online' || m === 'bank' || m === 'bank_transfer') return 'Bank / Online'
  if (m.includes('easypaisa')) return 'Easypaisa'
  if (m.includes('jazz')) return 'JazzCash'
  if (m === 'card') return 'Card'
  return titleCase(raw)
}

export function formatRs(n) {
  return `Rs. ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`
}
