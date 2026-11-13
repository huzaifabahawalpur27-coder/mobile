import { useId } from 'react'

/**
 * A labelled form control. The label is always visible and tied to the control, so a
 * tap on the label focuses it and screen readers announce it. A placeholder is an
 * example of what to type, never the label.
 *
 *   <Field label="Amount (Rs.)" hint="Before discount" error={err}>
 *     {(props) => <input type="number" {...props} value={v} onChange={...} />}
 *   </Field>
 *
 * Or let it render a plain input / select / textarea:
 *   <Field label="Note" value={note} onChange={e => setNote(e.target.value)} />
 *   <Field as="select" label="Account" value={id} onChange={...}>{options}</Field>
 */
export default function Field({ label, hint, error, as = 'input', children, className = '', id: givenId, ...rest }) {
  const autoId = useId()
  const id = givenId || autoId
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined
  const controlProps = { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, className: 'ui-input' }
  const Control = as
  return (
    <div className={`ui-field ${className}`}>
      <label className="ui-field__label" htmlFor={id}>{label}</label>
      {typeof children === 'function'
        ? children(controlProps)
        : <Control {...controlProps} {...rest}>{as === 'select' ? children : undefined}</Control>}
      {hint && !error && <p id={`${id}-hint`} className="ui-field__hint">{hint}</p>}
      {error && <p id={`${id}-error`} className="ui-field__error" role="alert">{error}</p>}
    </div>
  )
}
