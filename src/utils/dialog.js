/*
 * Pop-up behaviour for the whole app, plus the in-page replacement for confirm().
 *
 * installDialogBehavior() (called once from main.jsx) makes EVERY pop-up on the page
 * (any element with role="dialog") behave the same way, whether it is the shared
 * <Modal> or one of the older hand-built ones:
 *   - Esc closes the top-most pop-up (it presses that pop-up's Close / Cancel button)
 *   - Tab stays inside the pop-up instead of wandering to the page behind
 *   - focus returns to where it was when the pop-up closes
 *   - the page behind does not scroll
 *
 * confirmDialog(message, options) replaces the browser's confirm() box:
 *   if (!await confirmDialog('Delete 3 expenses?', { confirmLabel: 'Delete expenses', danger: true })) return
 * It resolves true / false. The buttons say what they do, the dangerous one is red,
 * and Esc or the backdrop means "no".
 */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const CLOSE_TEXT = /^(✕|×|x|close|cancel|no|back|dismiss|band karein)$/i

const isShown = (el) => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
}

function openDialogs() {
  return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(isShown)
}
const topDialog = () => openDialogs().pop() || null

function findCloseControl(dialog) {
  const buttons = [...dialog.querySelectorAll('button')].filter(isShown)
  return (
    buttons.find(b => /close|cancel|dismiss/i.test(b.getAttribute('aria-label') || '')) ||
    buttons.find(b => b.dataset.dialogClose !== undefined) ||
    buttons.find(b => CLOSE_TEXT.test((b.textContent || '').trim())) ||
    null
  )
}

let installed = false
let lastFocusBeforeDialog = null

export function installDialogBehavior() {
  if (installed || typeof document === 'undefined') return
  installed = true

  document.addEventListener('keydown', (e) => {
    const dialog = topDialog()
    if (!dialog) return

    if (e.key === 'Escape') {
      const close = findCloseControl(dialog)
      if (close) {
        e.preventDefault()
        e.stopPropagation()
        close.click()
      }
      return
    }

    if (e.key === 'Tab') {
      const items = [...dialog.querySelectorAll(FOCUSABLE)].filter(isShown)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!dialog.contains(active)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }, true)

  // Remember where focus was, lock the page scroll while a pop-up is open, and give
  // focus back when the last one closes
  let wasOpen = false
  const sync = () => {
    const open = openDialogs().length > 0
    if (open && !wasOpen) {
      const active = document.activeElement
      lastFocusBeforeDialog = active && active !== document.body ? active : null
      document.body.classList.add('ui-dialog-open')
    } else if (!open && wasOpen) {
      document.body.classList.remove('ui-dialog-open')
      const target = lastFocusBeforeDialog
      lastFocusBeforeDialog = null
      if (target && document.body.contains(target)) {
        try { target.focus({ preventScroll: true }) } catch (_) { /* element gone */ }
      }
    }
    wasOpen = open
  }
  let queued = false
  new MutationObserver(() => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => { queued = false; sync() })
  }).observe(document.body, { childList: true, subtree: true })
}

/**
 * In-page yes / no question. Returns a Promise<boolean>.
 *   title         short question ("Delete this expense?"); defaults to the first line of the message
 *   confirmLabel  what "yes" does, as a verb ("Delete expense"); default "Confirm"
 *   cancelLabel   default "Cancel"
 *   danger        true for deletes and anything that cannot be undone (red button)
 */
export function confirmDialog(message, { title, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  if (typeof document === 'undefined' || !document.body) return Promise.resolve(false)
  const text = String(message ?? '')
  const lines = text.split('\n')
  const heading = title || lines[0]
  const body = title ? text : lines.slice(1).join('\n').trim()

  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'ui-overlay'
    overlay.setAttribute('role', 'alertdialog')
    overlay.setAttribute('aria-modal', 'true')

    const panel = document.createElement('div')
    panel.className = 'ui-panel'
    panel.style.maxWidth = '26rem'

    const header = document.createElement('div')
    header.className = 'ui-panel__header'
    const h = document.createElement('h2')
    h.className = 'ui-panel__title'
    h.id = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    h.textContent = heading
    header.appendChild(h)
    overlay.setAttribute('aria-labelledby', h.id)
    panel.appendChild(header)

    if (body) {
      const p = document.createElement('div')
      p.className = 'ui-panel__body'
      p.textContent = body
      panel.appendChild(p)
    }

    const footer = document.createElement('div')
    footer.className = 'ui-panel__footer'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'ui-btn ui-btn--secondary'
    cancel.dataset.dialogClose = ''
    cancel.textContent = cancelLabel
    const ok = document.createElement('button')
    ok.type = 'button'
    ok.className = `ui-btn ${danger ? 'ui-btn--danger' : 'ui-btn--primary'}`
    ok.textContent = confirmLabel
    footer.append(cancel, ok)
    panel.appendChild(footer)
    overlay.appendChild(panel)

    const finish = (answer) => {
      overlay.remove()
      resolve(answer)
    }
    cancel.addEventListener('click', () => finish(false))
    ok.addEventListener('click', () => finish(true))
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) finish(false) })

    document.body.appendChild(overlay)
    // A dangerous action starts on Cancel, so a stray Enter does not delete anything
    ;(danger ? cancel : ok).focus()
  })
}

/**
 * Asks before saving an amount that looks like a typing slip (see unusualAmount in
 * moneyMath.js). Resolves true to go ahead.
 */
export async function confirmUnusualAmount(amount, usual, label = 'This amount') {
  if (usual == null) return true
  return confirmDialog(
    `${label} of Rs. ${Math.abs(Number(amount) || 0).toLocaleString()} looks too large\n` +
    `Amounts here are usually about Rs. ${Number(usual).toLocaleString()}. Check for an extra digit before saving.`,
    { confirmLabel: 'Save anyway', cancelLabel: 'Go back and check' }
  )
}
