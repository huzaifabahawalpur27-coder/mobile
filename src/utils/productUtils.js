/**
 * Deduplicates product records based on ID, name + barcode/sku,
 * ensuring no item appears more than once in catalog, inventory, or POS grids.
 * Prefers integer cloud IDs over client-side temporary UUIDs.
 */
export const deduplicateProducts = (products = []) => {
  if (!Array.isArray(products)) return []

  const seenIds = new Set()
  const seenBusinessKeys = new Map()
  const results = []

  // Prioritize items with numeric IDs (cloud synced) over string UUIDs
  const sorted = [...products].sort((a, b) => {
    const aIsInt = typeof a.id === 'number' || (!isNaN(Number(a.id)) && !String(a.id).includes('-'))
    const bIsInt = typeof b.id === 'number' || (!isNaN(Number(b.id)) && !String(b.id).includes('-'))
    if (aIsInt && !bIsInt) return -1
    if (!aIsInt && bIsInt) return 1
    return 0
  })

  for (const item of sorted) {
    if (!item) continue
    const idStr = String(item.id)
    if (seenIds.has(idStr)) continue

    const nameNorm = (item.name || '').trim().toLowerCase()
    const codeNorm = (item.barcode || item.sku || '').trim().toLowerCase()
    const shopStr = String(item.shop_id || '')
    const businessKey = `${shopStr}::${nameNorm}::${codeNorm}`

    if (nameNorm && seenBusinessKeys.has(businessKey)) {
      continue
    }

    seenIds.add(idStr)
    if (nameNorm) seenBusinessKeys.set(businessKey, item)
    results.push(item)
  }

  return results
}

/**
 * Deduplicates mobile phone inventory items by IMEI 1
 */
export const deduplicatePhones = (phones = []) => {
  if (!Array.isArray(phones)) return []
  const seenImeis = new Set()
  const results = []
  for (const phone of phones) {
    if (!phone) continue
    const imei = String(phone.imei_1 || phone.id || '').trim().toLowerCase()
    if (seenImeis.has(imei)) continue
    seenImeis.add(imei)
    results.push(phone)
  }
  return results
}
