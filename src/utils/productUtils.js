/**
 * Deduplicates product records based on ID, and merges temporary client-side
 * offline UUIDs with their synced cloud numeric IDs.
 * Distinct products with different numeric IDs are NEVER dropped.
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
    const isCurrentInt = typeof item.id === 'number' || (!isNaN(Number(item.id)) && !String(item.id).includes('-'))

    // Only deduplicate by businessKey if there is a non-empty barcode/sku,
    // to bridge client-side temporary UUIDs with synced cloud numeric IDs.
    // Distinct cloud items with numeric IDs are NEVER dropped even if names match.
    if (codeNorm && nameNorm) {
      const businessKey = `${shopStr}::${nameNorm}::${codeNorm}`
      if (seenBusinessKeys.has(businessKey)) {
        const existing = seenBusinessKeys.get(businessKey)
        const isExistingInt = typeof existing.id === 'number' || (!isNaN(Number(existing.id)) && !String(existing.id).includes('-'))
        // If the existing item is already a synced cloud item and current is a temp UUID, skip the temp one
        if (isExistingInt && !isCurrentInt) {
          continue
        }
      } else {
        seenBusinessKeys.set(businessKey, item)
      }
    }

    seenIds.add(idStr)
    results.push(item)
  }

  return results
}

/**
 * Deduplicates mobile phone inventory items by IMEI 1,
 * while safely preserving distinct phones that have empty or placeholder IMEIs.
 */
export const deduplicatePhones = (phones = []) => {
  if (!Array.isArray(phones)) return []
  const seenImeis = new Set()
  const results = []
  
  const PLACEHOLDER_STRINGS = new Set(['', 'n/a', 'na', 'none', 'null', '0', '000000000000000', 'undefined', '-'])

  for (const phone of phones) {
    if (!phone) continue
    const rawImei = String(phone.imei_1 || '').trim().toLowerCase()
    const isPlaceholder = PLACEHOLDER_STRINGS.has(rawImei)
    // If it has a real IMEI, deduplicate by IMEI. If placeholder, deduplicate by unique phone ID.
    const key = isPlaceholder ? `id-${phone.id}` : `imei-${rawImei}`
    
    if (seenImeis.has(key)) continue
    seenImeis.add(key)
    results.push(phone)
  }
  return results
}
