import { supabase } from './supabase'

/*
 * Shop notifications ("Updates" in the bell), pushed from the superadmin portal.
 * Database: sql/shop_notifications.sql. The server functions only ever return or
 * change the signed-in shop's own copies.
 */

const cacheKey = (shopId) => `shop_notifications_${shopId}`
const isMissingFunction = (err) => err?.code === 'PGRST202' || /could not find the function/i.test(err?.message || '')

export function readCachedNotifications(shopId) {
  if (!shopId) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey(shopId)) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeCache(shopId, list) {
  try { localStorage.setItem(cacheKey(shopId), JSON.stringify(list.slice(0, 100))) } catch { /* storage full: cache only */ }
}

/** Newest first. Falls back to this device's copy when offline. */
export async function fetchShopNotifications(shopId) {
  if (!shopId) return { list: [], fromCache: false }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { list: readCachedNotifications(shopId), fromCache: true }
  }
  const { data, error } = await supabase.rpc('get_shop_notifications', { p_limit: 100 })
  if (error) {
    // Not installed yet, or a temporary problem: keep showing what this device has
    if (!isMissingFunction(error)) console.warn('Notifications could not be loaded:', error.message)
    return { list: readCachedNotifications(shopId), fromCache: true }
  }
  const list = Array.isArray(data) ? data : []
  writeCache(shopId, list)
  return { list, fromCache: false }
}

/** The one-time popup was shown: never pop these up again (on any device of the shop). */
export async function markNotificationsSeen(shopId, ids) {
  const clean = (ids || []).map(Number).filter(Number.isFinite)
  if (!shopId || clean.length === 0) return
  const now = new Date().toISOString()
  writeCache(shopId, readCachedNotifications(shopId).map(n => (clean.includes(Number(n.id)) && !n.seen_at ? { ...n, seen_at: now } : n)))
  const { error } = await supabase.rpc('mark_shop_notifications_seen', { p_ids: clean })
  if (error && !isMissingFunction(error)) console.warn('Could not mark notifications seen:', error.message)
}

/** Permanent delete of the shop's copy (shop owner / admin only; the database checks). */
export async function deleteShopNotification(shopId, id) {
  const { data, error } = await supabase.rpc('delete_shop_notification', { p_id: Number(id) })
  if (error) throw new Error(error.message || 'Could not delete the notification')
  writeCache(shopId, readCachedNotifications(shopId).filter(n => String(n.id) !== String(id)))
  return data
}

export const NOTIFICATION_CATEGORIES = {
  feature: { label: 'New', className: 'bg-blue-100 text-blue-700' },
  fix: { label: 'Fixed', className: 'bg-emerald-100 text-emerald-700' },
  important: { label: 'Important', className: 'bg-rose-100 text-rose-700' }
}

export const canDeleteNotifications = (user) => ['owner', 'admin'].includes(String(user?.role || '').toLowerCase()) && !user?.isImpersonating
