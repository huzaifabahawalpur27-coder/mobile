import { supabase } from './supabase'

/**
 * Asks the server whether it recognises this browser's login session.
 *
 * Sessions are created only by the server-side login (secure_login). A session token
 * the server never saved (e.g. after an offline login, when the connection dropped)
 * makes every RLS-protected query return no rows, so screens look empty with no error.
 *
 * Returns one of:
 *   'ok'           server maps the session to this user's shop
 *   'ok-open'      server does not map it, but the shop's data is still readable
 *                  (database without session-scoped RLS): nothing to do
 *   'unrecognised' server does not know this session and hides the shop's data:
 *                  the user must sign in again online
 *   'offline'      could not reach the server: try again later
 *   'unknown'      unexpected server answer (e.g. function missing): do nothing
 *   'skip'         not applicable (no shop user, superadmin, impersonation)
 */
const NETWORK_RE = /fetch|network|load failed|timeout|err_name_not_resolved|connection/i

const isNetworkError = (err) => NETWORK_RE.test(`${err?.message || ''} ${err?.details || ''} ${err?.code || ''}`)

export async function checkServerSession(user) {
  if (!user?.shop_id || user.role === 'superadmin' || user.isImpersonating) return 'skip'
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
  try {
    const who = await supabase.rpc('current_user_shop_id')
    if (who.error) return isNetworkError(who.error) ? 'offline' : 'unknown'
    if (who.data !== null && who.data !== undefined && String(who.data) === String(user.shop_id)) return 'ok'

    // Not mapped to this shop. Only treat it as locked out if the shop's own row is
    // hidden too; on databases without session-scoped RLS the app works without one.
    const shop = await supabase.from('shops').select('id').eq('id', user.shop_id).limit(1)
    if (shop.error) return isNetworkError(shop.error) ? 'offline' : 'unknown'
    return (shop.data || []).length === 0 ? 'unrecognised' : 'ok-open'
  } catch (err) {
    return isNetworkError(err) ? 'offline' : 'unknown'
  }
}

export const RELOGIN_NOTICE_KEY = 'login_notice'

export const RELOGIN_MESSAGE =
  'Your login is not connected to the server, so no data is showing. Check the internet connection, then log in again. ' +
  '(Your session is not connected to the server, so no data can load. Please check the internet and sign in again.)'
