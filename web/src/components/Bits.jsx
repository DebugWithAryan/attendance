/** Shared scraps: headings, loading and empty states, pickers, figures. */

export function PageHead({ title, note, children }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      {note && <p>{note}</p>}
      <span style={{ flex: 1 }} />
      {children}
    </div>
  );
}

/**
 * Skeleton rows rather than a spinner: the shape of what is coming tells a
 * teacher the roster is on its way, and the page does not jump when it lands.
 */
export function Loading({ what = 'Loading', rows = 3 }) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <span className="label">{what}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton" style={{ width: `${100 - i * 12}%` }} />
      ))}
    </div>
  );
}

export const Problem = ({ children }) => (
  <div className="notice bad" role="alert">{children}</div>
);

/** Confirmations are announced, not just shown, for anyone using a screen reader. */
export const Done = ({ children }) => (
  <div className="notice good" role="status" aria-live="polite">{children}</div>
);

/** An empty screen is an invitation to act, so it takes an action when there is one. */
export function Empty({ children, action }) {
  return (
    <div className="empty">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Field({ label, children }) {
  return <label className="field">{label}{children}</label>;
}

export function Select({ label, value, onChange, options, placeholder = 'Select', ...rest }) {
  return (
    <Field label={label}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

/**
 * The student's percentage against the minimum, as a filled arc. The number is
 * the answer; the ring is how far off the line they are at a glance.
 */
export function Ring({ value, minimum, caption }) {
  const filled = Math.max(0, Math.min(100, value ?? 0));
  const low = value !== null && value !== undefined && value < minimum;
  return (
    <div
      className="ring"
      style={{ '--value': filled, '--tone': low ? 'var(--absent)' : 'var(--present)' }}
      role="img"
      aria-label={value === null || value === undefined
        ? 'No classes recorded yet'
        : `${value.toFixed(1)} percent attendance against a minimum of ${minimum} percent`}
    >
      <div>
        <div className={`figure ${low ? 'low' : ''}`}>{pct(value)}</div>
        {caption && <div className="label">{caption}</div>}
      </div>
    </div>
  );
}

export const pct = (v) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(1)}%`);

export const when = (ts) => (ts ? new Date(ts).toLocaleString(undefined, {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
}) : '');
