/*
 * In-page messages instead of the browser's alert() box, which stops the whole screen
 * until OK is pressed. notify(message) shows a message at the top of the page:
 *   - success / info messages close by themselves
 *   - warnings and errors stay until closed, so they cannot be missed
 * The kind is worked out from the text unless given: notify('Saved', 'success').
 * No React provider is needed, so services can call it too.
 */

const KINDS = {
  success: { bar: '#059669', bg: '#ecfdf5', fg: '#064e3b', icon: '✓' },
  error: { bar: '#dc2626', bg: '#fef2f2', fg: '#7f1d1d', icon: '!' },
  warning: { bar: '#d97706', bg: '#fffbeb', fg: '#78350f', icon: '!' },
  info: { bar: '#2563eb', bg: '#eff6ff', fg: '#1e3a8a', icon: 'i' }
}

const ERROR_RE = /\berror\b|failed|fail\b|could not|couldn't|cannot|not saved|nahi h|nahi ho|❌|not found|refused|invalid/i
const WARN_RE = /⚠️|warning|please check|but |partially|max \d|not enough|lazmi|khali|select karein|enter karo|must be|required|offline/i
const OK_RE = /✅|success|saved|save ho gaya|restored|deleted|moved to trash|copied|updated|🗑️/i

export function kindOf(message) {
  const text = String(message ?? '')
  if (ERROR_RE.test(text)) return 'error'
  if (WARN_RE.test(text)) return 'warning'
  if (OK_RE.test(text)) return 'success'
  return 'info'
}

let host = null
function getHost() {
  if (host && document.body.contains(host)) return host
  host = document.createElement('div')
  host.setAttribute('aria-live', 'polite')
  host.setAttribute('role', 'status')
  host.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483000;display:flex;flex-direction:column;gap:8px;width:min(92vw,440px);pointer-events:none'
  document.body.appendChild(host)
  return host
}

export function notify(message, kind) {
  let text = String(message ?? '')
  // The database refused the request because the login session is missing or expired
  if (/row-level security policy|row violates row-level security/i.test(text)) {
    text = 'Your login has expired\nLog out, then log in again to continue. Nothing was saved.'
    kind = 'error'
  }
  if (typeof document === 'undefined' || !document.body) {
    console.log(text)
    return
  }
  const k = KINDS[kind] ? kind : kindOf(text)
  const style = KINDS[k]
  const sticky = k === 'error' || k === 'warning'

  const card = document.createElement('div')
  card.setAttribute('role', sticky ? 'alert' : 'status')
  card.style.cssText = `pointer-events:auto;display:flex;gap:10px;align-items:flex-start;background:${style.bg};color:${style.fg};border-left:5px solid ${style.bar};border-radius:12px;padding:12px 12px 12px 14px;box-shadow:0 10px 25px rgba(0,0,0,.18);font:600 14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;opacity:0;transform:translateY(-8px);transition:opacity .18s ease,transform .18s ease`

  const icon = document.createElement('span')
  icon.textContent = style.icon
  icon.setAttribute('aria-hidden', 'true')
  icon.style.cssText = `flex:none;width:22px;height:22px;border-radius:50%;background:${style.bar};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px`

  const body = document.createElement('div')
  body.textContent = text
  body.style.cssText = 'flex:1;min-width:0;white-space:pre-line;word-break:break-word;max-height:50vh;overflow:auto'

  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = '✕'
  close.setAttribute('aria-label', 'Close message')
  close.style.cssText = `flex:none;min-width:32px;min-height:32px;border:0;background:transparent;color:${style.fg};font-size:16px;font-weight:800;cursor:pointer;border-radius:8px`

  let timer = null
  const remove = () => {
    if (timer) clearTimeout(timer)
    card.style.opacity = '0'
    card.style.transform = 'translateY(-8px)'
    setTimeout(() => card.remove(), 200)
  }
  close.addEventListener('click', remove)

  card.append(icon, body, close)
  const h = getHost()
  // Same message already showing: do not stack copies
  for (const existing of h.children) {
    if (existing.dataset.text === text) existing.remove()
  }
  card.dataset.text = text
  h.appendChild(card)
  while (h.children.length > 4) h.firstChild.remove()
  requestAnimationFrame(() => {
    card.style.opacity = '1'
    card.style.transform = 'translateY(0)'
  })
  if (!sticky) timer = setTimeout(remove, Math.min(9000, 3500 + text.length * 45))
}
