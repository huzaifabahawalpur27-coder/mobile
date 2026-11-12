import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchShopNotifications, markNotificationsSeen, deleteShopNotification, readCachedNotifications
} from '../services/notificationService'

const REFRESH_MS = 5 * 60 * 1000
const MIN_GAP_MS = 60 * 1000

/*
 * Shop "Updates" for the bell and the one-time popup.
 * - The newest update the shop has never seen pops up once; showing it marks every
 *   unseen update as seen on the server, so it never pops up again on any device.
 * - Updates seen for the first time in this visit stay highlighted as "New" in the list.
 */
export default function useShopNotifications(user) {
  const shopId = user?.shop_id
  const enabled = Boolean(shopId) && user?.role !== 'superadmin'
  const [items, setItems] = useState(() => (enabled ? readCachedNotifications(shopId) : []))
  const [newIds, setNewIds] = useState(() => new Set())
  const [popup, setPopup] = useState(null)
  const lastLoad = useRef(0)

  const load = useCallback(async (force = false) => {
    if (!enabled) return
    const now = Date.now()
    if (!force && now - lastLoad.current < MIN_GAP_MS) return
    lastLoad.current = now
    const { list, fromCache } = await fetchShopNotifications(shopId)
    setItems(list)
    if (fromCache) return
    const unseen = list.filter(n => !n.seen_at)
    if (unseen.length === 0) return
    setNewIds(prev => new Set([...prev, ...unseen.map(n => String(n.id))]))
    setPopup({ item: unseen[0], more: unseen.length - 1 })
    await markNotificationsSeen(shopId, unseen.map(n => n.id))
  }, [enabled, shopId])

  useEffect(() => {
    if (!enabled) { setItems([]); return undefined }
    setItems(readCachedNotifications(shopId))
    load(true)
    const onOnline = () => load(true)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    const timer = setInterval(() => load(), REFRESH_MS)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, shopId, load])

  const closePopup = useCallback(() => setPopup(null), [])

  const remove = useCallback(async (id) => {
    await deleteShopNotification(shopId, id)
    setItems(prev => prev.filter(n => String(n.id) !== String(id)))
    setPopup(p => (p && String(p.item.id) === String(id) ? null : p))
  }, [shopId])

  return {
    items,
    newIds,
    newCount: items.filter(n => newIds.has(String(n.id))).length,
    popup,
    closePopup,
    clearNew: () => setNewIds(new Set()),
    remove,
    refresh: () => load(true)
  }
}
