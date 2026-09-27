import { useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { Done, Problem, Select, localToday, periodList, periodsLabel, shortDate } from './Bits.jsx';

/** Today, or Monday when today is a Sunday: there is nothing to cancel on a Sunday. */
function nextTeachingDay() {
  const today = localToday();
  const sunday = new Date(`${today}T00:00:00Z`).getUTCDay() === 0;
  if (!sunday) return today;
  const next = new Date(`${today}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * Cancelling classes in advance: pick a date, tap once. By default that is
 * every class on the timetable for the day; narrowing it to a course, a
 * section or some periods is optional. A teacher's cancellation only ever
 * reaches their own periods. Every cancellation can be undone from the same
 * place, which is what makes a single tap safe.
 */
export function CancelClasses({ user, onChanged, preset }) {
  const isTeacher = user.role === 'teacher';
  const courses = useApi('/courses');
  const sections = useApi(isTeacher ? null : '/sections', { skip: isTeacher });
  const [form, setForm] = useState({
    date: preset?.date || nextTeachingDay(),
    scope: preset?.scope || 'all',
    periods: preset?.periods || [],
    reason: preset?.reason || '',
  });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const courseName = (id) => (courses.data || []).find((c) => c.id === id)?.name || '';
  const widest = Math.max(1, ...(courses.data || []).map((c) => Number(c.periods_per_day) || 8));
  const scopes = isTeacher
    ? [{ value: 'all', label: 'Your classes that day' }]
    : [
      { value: 'all', label: 'Every class in the college' },
      ...(courses.data || []).map((c) => ({ value: `course:${c.id}`, label: `All of ${c.name}` })),
      ...(sections.data || []).map((s) => ({ value: `section:${s.id}`, label: `${courseName(s.course_id)} · ${s.name}` })),
    ];

  const toggle = (p) => setForm((f) => ({
    ...f, periods: f.periods.includes(p) ? f.periods.filter((x) => x !== p) : [...f.periods, p].sort((a, b) => a - b),
  }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    const [kind, id] = form.scope.split(':');
    try {
      const res = await api.post('/classes/cancel', {
        date: form.date,
        periods: form.periods.length ? form.periods : undefined,
        reason: form.reason.trim() || undefined,
        courseId: kind === 'course' ? id : undefined,
        sectionId: kind === 'section' ? id : undefined,
      });
      setResult(res);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.del(`/classes/cancellations/${result.batchId}`);
      setResult({ undone: res.restored });
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel cancel-panel">
      <header>
        <h3>Cancel classes</h3>
        <span className="label">A holiday, a strike, a fest: one tap, and nothing is marked or counted.</span>
      </header>
      <div className="body stack" style={{ gap: '0.75rem' }}>
        <div className="row">
          <label className="field">
            Date
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <Select label="Which classes" value={form.scope === 'all' ? '' : form.scope} placeholder={isTeacher ? 'Your classes that day' : 'Every class in the college'}
            options={scopes.slice(1)} onChange={(v) => setForm({ ...form, scope: v || 'all' })} disabled={isTeacher} />
          <label className="field" style={{ flex: 1, minWidth: '14rem' }}>
            Reason (students see this)
            <input value={form.reason} maxLength={200} onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="College closed for heavy rain" />
          </label>
        </div>
        <div>
          <div className="label" style={{ marginBottom: '0.25rem' }}>
            Periods {form.periods.length ? `(${periodsLabel(form.periods)})` : '(leave all unselected for the whole day)'}
          </div>
          <div className="marks period-picks" role="group" aria-label="Periods to cancel">
            {periodList(widest).map((p) => (
              <button key={p} type="button" data-status="absent" aria-pressed={form.periods.includes(p)}
                onClick={() => toggle(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
        {error && <Problem>{error}</Problem>}
        {result?.undone !== undefined && <Done>Undone. {result.undone} classes are back on the timetable.</Done>}
        {result?.batchId && (
          <div className="notice good" role="status" aria-live="polite">
            <p style={{ margin: 0 }}>
              <strong>Cancelled {result.cancelled.length} {result.cancelled.length === 1 ? 'class' : 'classes'}</strong>
              {' '}on {shortDate(result.date)}{result.reason ? ` — ${result.reason}` : ''}. Students and teachers have been told.
            </p>
            <p className="label" style={{ margin: '0.25rem 0 0' }}>
              {summarise(result.cancelled)}
              {result.recordsRemoved ? ` · ${result.recordsRemoved} advance leave or credit marks cleared` : ''}
            </p>
            {result.skipped.length > 0 && (
              <p className="label" style={{ margin: '0.25rem 0 0' }}>
                Left alone: {result.skipped.map((s) => `${s.sectionName} P${s.periodNumber} (${s.reason})`).join(', ')}.
              </p>
            )}
            <button className="quiet" style={{ marginTop: '0.5rem' }} onClick={undo} disabled={busy}>Undo</button>
          </div>
        )}
        {result && !result.batchId && result.undone === undefined && (
          <Problem>
            Nothing was cancelled: {result.skipped.map((s) => `${s.sectionName} P${s.periodNumber} (${s.reason})`).join(', ')}.
          </Problem>
        )}
        <div>
          <button className="danger" onClick={submit} disabled={busy || !form.date}>
            {busy ? 'Working…' : `Cancel ${form.periods.length ? periodsLabel(form.periods) : 'classes'} on ${shortDate(form.date) || 'this date'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "CSE-A P1–5 · CSE-B P1–5" */
function summarise(classes) {
  const bySection = new Map();
  for (const c of classes) bySection.set(c.sectionName, [...(bySection.get(c.sectionName) || []), c.periodNumber]);
  return [...bySection].map(([name, periods]) => `${name} ${periodsLabel(periods)}`).join(' · ');
}

/**
 * Cancellations still ahead. The HOD and administrator can restore any; a
 * teacher can restore the ones they made; a student just sees what is off.
 */
export function CancellationList({ user, items, onChanged, empty = 'No classes are cancelled from today on.' }) {
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const canRestore = (row) => ['hod', 'admin'].includes(user.role) || row.recorded_by === user.id;

  const restore = async (row) => {
    setError(null);
    setDone(null);
    try {
      const res = await api.del(`/classes/cancellations/${row.batch_id}`);
      setDone(`${res.restored} ${res.restored === 1 ? 'class is' : 'classes are'} back on for ${shortDate(res.date)}.`);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      {error && <Problem>{error}</Problem>}
      {done && <Done>{done}</Done>}
      {!items?.length
        ? <p className="label" style={{ padding: 'var(--s-3) var(--s-4)', margin: 0 }}>{empty}</p>
        : (
          <ul className="plain feed cancellations">
            {items.map((row) => (
              <li key={row.batch_id}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>
                    <span className="chip cancelled">cancelled</span>{' '}
                    <strong>{shortDate(row.class_date)}</strong> · {periodsLabel(row.periods)} · {row.section_names.join(', ')}
                  </span>
                  {canRestore(row) && <button className="link" onClick={() => restore(row)}>restore</button>}
                </div>
                <div className="meta">
                  {row.reason || 'No reason given'}{row.event_title && !(row.reason || '').includes(row.event_title) ? ` · for ${row.event_title}` : ''}
                  {' · '}{row.classes} {Number(row.classes) === 1 ? 'class' : 'classes'} · by {row.cancelled_by_name}
                </div>
              </li>
            ))}
          </ul>
        )}
    </>
  );
}
