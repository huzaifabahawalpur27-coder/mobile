import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

const WIDTHS = { sm: '24rem', md: '32rem', lg: '44rem', xl: '60rem' }

/**
 * The one pop-up. Closes with Esc and the ✕ button, keeps keyboard focus inside while
 * open, gives focus back afterwards, never grows taller than the screen (the body
 * scrolls, header and footer stay put) and stacks its footer buttons on phones.
 *
 *   <Modal open={open} onClose={close} title="Correct payment"
 *          footer={<><Button onClick={close}>Cancel</Button><Button variant="primary">Save correction</Button></>}>
 *     ...form...
 *   </Modal>
 *
 * Esc and focus handling come from src/utils/dialog.js, which treats every
 * role="dialog" on the page the same way (older hand-built pop-ups included).
 */
export default function Modal({ open, onClose, title, size = 'md', footer, children, closeOnBackdrop = true, labelledBy }) {
  const titleId = useId()
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const first = panelRef.current?.querySelector('[autofocus], input:not([type=hidden]), select, textarea, button:not(.ui-close)')
    ;(first || panelRef.current)?.focus?.()
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="ui-overlay" role="dialog" aria-modal="true" aria-labelledby={labelledBy || (title ? titleId : undefined)}
      onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose?.() }}>
      <div className="ui-panel" style={{ maxWidth: WIDTHS[size] || size }} ref={panelRef} tabIndex={-1}>
        {(title || onClose) && (
          <div className="ui-panel__header">
            <h2 id={titleId} className="ui-panel__title">{title}</h2>
            {onClose && <button type="button" className="ui-close" aria-label="Close" onClick={onClose}>✕</button>}
          </div>
        )}
        <div className="ui-panel__body" style={{ whiteSpace: 'normal' }}>{children}</div>
        {footer && <div className="ui-panel__footer">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}
