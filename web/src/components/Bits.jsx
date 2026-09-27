/** Shared scraps: headings, loading and empty states, pickers, figures. */
import { useEffect, useState } from 'react';

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

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Local calendar date. toISOString() would show yesterday to anyone using the
// app before 05:30 IST.
export const localToday = () => new Date().toLocaleDateString('en-CA');

/** "Fri, 2 Oct" for a YYYY-MM-DD calendar date, whatever the browser's zone. */
export const shortDate = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, {
  weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
}) : '');

/** 1..n, for period pickers that follow the course's day. */
export const periodList = (n) => Array.from({ length: Math.max(1, Math.min(12, Number(n) || 8)) }, (_, i) => i + 1);

/** "P3", "P3–5", "P1, P3" */
export const periodsLabel = (periods = []) => {
  const list = [...periods].map(Number).sort((a, b) => a - b);
  if (!list.length) return 'all day';
  const contiguous = list.every((p, i) => i === 0 || p === list[i - 1] + 1);
  if (contiguous && list.length > 2) return `P${list[0]}\u2013${list.at(-1)}`;
  return list.map((p) => `P${p}`).join(', ');
};

/**
 * The attendance badge: a seal on the register for students at or above the
 * threshold. Below it, the same spot tells them how close they are, which is
 * the motivating half of the idea.
 */
export function AttendanceBadge({ badge, compact = false }) {
  if (!badge) return null;
  if (!badge.earned) {
    if (badge.current === null || badge.current === undefined || !badge.needed) return null;
    return (
      <p className="badge-hint">
        <span aria-hidden="true">{'\u2606'}</span> Attend {badge.needed} more {badge.needed === 1 ? 'class' : 'classes'} in a row
        to earn the {badge.threshold}% attendance badge.
      </p>
    );
  }
  return (
    <div className={`seal${compact ? ' compact' : ''}`} role="img"
      aria-label={`Attendance badge: ${badge.threshold} percent or more`}>
      <span className="star" aria-hidden="true">{'\u2605'}</span>
      <span className="seal-text">
        <strong>{badge.threshold}%+ attendance</strong>
        {!compact && <span>Badge earned. Keep it up.</span>}
      </span>
    </div>
  );
}

/**
 * A QR code drawn as SVG. The encoder is loaded only when a QR code is on
 * screen, so it adds nothing to the bundle every other page pays for. It is
 * always dark on white, because a scanner needs the contrast in dark mode too.
 */
export function QrCode({ value, size = 200, label }) {
  const [shape, setShape] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setShape(null);
    import('qrcode-generator').then(({ default: qrcode }) => {
      const qr = qrcode(0, 'M');
      qr.addData(value);
      qr.make();
      const n = qr.getModuleCount();
      const quiet = 4;
      let d = '';
      for (let r = 0; r < n; r += 1) {
        for (let c = 0; c < n; c += 1) {
          if (qr.isDark(r, c)) d += `M${c + quiet},${r + quiet}h1v1h-1z`;
        }
      }
      if (live) setShape({ d, box: n + quiet * 2 });
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [value]);

  if (failed) return <p className="label">The QR code could not be drawn here. Share this link instead: {value}</p>;
  if (!shape) return <span className="skeleton" style={{ width: size, height: size, borderRadius: 4 }} />;
  return (
    <svg className="qr" role="img" aria-label={label || `QR code linking to ${value}`}
      viewBox={`0 0 ${shape.box} ${shape.box}`} width={size} height={size}
      shapeRendering="crispEdges" data-value={value}>
      <rect width={shape.box} height={shape.box} fill="#ffffff" />
      <path d={shape.d} fill="#000000" />
    </svg>
  );
}
