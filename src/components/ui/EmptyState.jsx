/**
 * What a list shows when it has nothing: what belongs here, and the way to add the
 * first one. `action` is usually a <Button variant="primary">.
 */
export default function EmptyState({ title, children, action }) {
  return (
    <div className="ui-empty">
      <p className="ui-empty__title">{title}</p>
      {children && <p className="ui-empty__text">{children}</p>}
      {action}
    </div>
  )
}
