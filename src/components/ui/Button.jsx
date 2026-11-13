/**
 * The one button. variant: primary (main action of a screen or dialog) | secondary |
 * danger (deletes, irreversible) | ghost (low emphasis). size: sm | md | lg.
 * Label it with what it does ("Save expense", "Delete sale"), not "OK" / "Submit".
 */
export default function Button({ variant = 'secondary', size = 'md', block = false, loading = false, className = '', type = 'button', children, disabled, ...rest }) {
  const classes = ['ui-btn', `ui-btn--${variant}`, size !== 'md' ? `ui-btn--${size}` : '', block ? 'ui-btn--block' : '', className].filter(Boolean).join(' ')
  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {children}
    </button>
  )
}
