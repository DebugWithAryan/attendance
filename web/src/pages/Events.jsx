import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { Done, Empty, Loading, PageHead, Problem, Select, periodList, periodsLabel, shortDate } from '../components/Bits.jsx';

export default function Events() {
  const { user } = useAuth();
  const events = useApi('/events');
  const courses = useApi('/courses');
  const clubs = useApi(['mentor', 'hod'].includes(user.role) ? '/clubs' : null, { skip: !['mentor', 'hod'].includes(user.role) });
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const canPost = ['admin', 'hod', 'teacher', 'mentor'].includes(user.role);
  const canCancel = ['admin', 'hod'].includes(user.role);
  // Events are college-wide, so the picker is as long as the longest day any course runs.
  const widest = Math.max(1, ...(courses.data || []).map((c) => Number(c.periods_per_day) || 8));

  const join = async (id) => {
    setError(null);
    try {
      await api.post(`/events/${id}/join`);
      setMessage('Request sent. You will hear back when it is approved.');
      await events.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHead title="Events" note={canPost
        ? 'Approving a join request, or adding someone’s attendance, credits the periods you set here.'
        : 'Join an event to have its periods credited once the organiser approves.'} />

      <div className="stack">
        {error && <Problem>{error}</Problem>}
        {message && <div className="notice good">{message}</div>}

        {canPost && (
          <NewEvent clubs={clubs.data || []} widest={widest}
            onCreated={() => { events.reload(); setMessage('Event posted.'); }} />
        )}

        {events.loading && <Loading what="Loading events" />}
        {!events.loading && (events.data || []).length === 0 && <Empty>No events yet.</Empty>}

        {(events.data || []).map((e) => (
          <div className="panel" key={e.id}>
            <header>
              <h3>{e.title}</h3>
              <span className="label" title={e.event_date}>{shortDate(e.event_date)}</span>
              {e.visibility === 'members_only' && <span className="chip pending">{e.club_name} members only</span>}
              {e.credit_periods.length > 0 && <span className="chip credit">credits period {e.credit_periods.join(', ')}</span>}
              {Number(e.cancelled_classes) > 0 && (
                <span className="chip cancelled">{e.cancelled_classes} {Number(e.cancelled_classes) === 1 ? 'class' : 'classes'} cancelled</span>
              )}
            </header>
            <div className="body stack" style={{ gap: '0.75rem' }}>
              {e.description && <p>{e.description}</p>}
              <div className="meta label">
                Posted by {e.posted_by_name}
                {e.created_by === user.id && ` · ${e.approved_count} approved · ${e.credited_students} credited`}
              </div>

              {user.role === 'student' && <MyCredit event={e} onJoin={() => join(e.id)} />}

              {e.created_by === user.id && (
                <div className="row">
                  <button className="quiet" onClick={() => setOpen(open === e.id ? null : e.id)}>
                    {open === e.id ? 'Hide' : 'Review'} join requests{Number(e.pending_count) ? ` (${e.pending_count} pending)` : ''}
                  </button>
                  <button className="quiet" onClick={() => setAdding(adding === e.id ? null : e.id)}>
                    {adding === e.id ? 'Close' : 'Add attendance'}
                  </button>
                </div>
              )}
              {adding === e.id && (
                <AddAttendance event={e} clubs={clubs.data || []}
                  onAdded={() => events.reload()} />
              )}
              {open === e.id && <Requests eventId={e.id} onDecided={() => events.reload()} />}

              {canCancel && e.visibility === 'all_students' && (
                <CancelForEvent event={e} onChanged={() => events.reload()} />
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * What an event did to the student's own register. Credited periods are
 * named with their subject; a period that could not be credited says why,
 * rather than the student finding out from a percentage that did not move.
 */
function MyCredit({ event, onJoin }) {
  if (!event.my_request_status) {
    return <div><button onClick={onJoin}>Ask to join</button></div>;
  }
  if (event.my_request_status === 'pending') {
    return (
      <div className="stack" style={{ gap: '0.25rem' }}>
        <span><span className="chip pending">your request: pending</span></span>
        {event.credit_periods.length > 0 && (
          <span className="label">Once the organiser approves, {periodsLabel(event.credit_periods)} will be marked present for you.</span>
        )}
      </div>
    );
  }
  if (event.my_request_status === 'rejected') {
    return <span><span className="chip rejected">your request: rejected</span></span>;
  }
  const credited = event.my_credits || [];
  const missing = event.my_not_credited || [];
  return (
    <div className="credit-result stack" style={{ gap: '0.375rem' }}>
      <span><span className="chip approved">your request: approved</span></span>
      {credited.map((c) => (
        <div key={c.period} className="credit-line ok">
          <span aria-hidden="true">{'✓'}</span> Attendance credited: period {c.period}{c.subject ? ` · ${c.subject}` : ''}
          {c.was_override ? ' (replaced an absence)' : ''}
        </div>
      ))}
      {missing.map((m) => (
        <div key={m.period} className="credit-line skipped">
          <span aria-hidden="true">{'–'}</span> Period {m.period} not credited: {m.reason}
        </div>
      ))}
      {!credited.length && !missing.length && (
        <span className="label">This event does not credit any class periods.</span>
      )}
    </div>
  );
}

function NewEvent({ clubs, widest, onCreated }) {
  const [form, setForm] = useState({ title: '', description: '', eventDate: '', visibility: 'all_students', clubId: '' });
  const [periods, setPeriods] = useState([]);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/events', {
        title: form.title,
        description: form.description || undefined,
        eventDate: form.eventDate,
        visibility: form.visibility,
        clubId: form.visibility === 'members_only' ? form.clubId : undefined,
        creditPeriods: periods,
      });
      setForm({ title: '', description: '', eventDate: '', visibility: 'all_students', clubId: '' });
      setPeriods([]);
      onCreated();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="panel">
      <header><h3>Post an event</h3></header>
      <form className="body stack" style={{ gap: '0.75rem' }} onSubmit={submit}>
        <div className="row">
          <label className="field" style={{ flex: 1, minWidth: '14rem' }}>
            Title<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="field">
            Date<input type="date" required value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} />
          </label>
          <Select label="Who can see it" value={form.visibility} placeholder="All students"
            options={[{ value: 'all_students', label: 'All students' }, { value: 'members_only', label: 'Club members only' }]}
            onChange={(v) => setForm({ ...form, visibility: v })} />
          {form.visibility === 'members_only' && (
            <Select label="Club" value={form.clubId} options={clubs.map((c) => ({ value: c.id, label: c.name }))}
              onChange={(v) => setForm({ ...form, clubId: v })} />
          )}
        </div>
        <label className="field">
          Description
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <div>
          <div className="label" style={{ marginBottom: '0.25rem' }}>
            Periods this event counts for. A participant is marked present in whichever class their section has then.
          </div>
          <div className="marks">
            {periodList(widest).map((p) => (
              <button key={p} type="button" data-status="present" aria-pressed={periods.includes(p)}
                onClick={() => setPeriods((ps) => (ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p].sort((a, b) => a - b)))}>
                {p}
              </button>
            ))}
          </div>
        </div>
        {error && <Problem>{error}</Problem>}
        <div><button type="submit">Post event</button></div>
      </form>
    </div>
  );
}

/**
 * The organiser recording who took part: login IDs typed or pasted, or the
 * whole club, or everyone who asked. Each student is credited at once.
 */
function AddAttendance({ event, clubs, onAdded }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const club = clubs.find((c) => c.id === event.club_id);
  const loginIds = text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

  const fillPending = async () => {
    setError(null);
    try {
      const rows = await api.get(`/events/${event.id}/requests`);
      const pending = rows.filter((r) => r.status === 'pending').map((r) => r.login_id);
      if (!pending.length) setError('Nobody is waiting for approval on this event.');
      else setText(pending.join('\n'));
    } catch (err) {
      setError(err.message);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post(`/events/${event.id}/attendance`, { loginIds });
      setResult(res);
      if (!res.failed.length) setText('');
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notice add-attendance">
      <p className="label" style={{ marginTop: 0 }}>
        Add the students who took part, by login ID. Their attendance is credited straight away
        {event.credit_periods.length ? ` for ${periodsLabel(event.credit_periods)}` : ''}, and their teachers are told.
      </p>
      <label className="field">
        Student login IDs (one per line, or separated by commas)
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="row" style={{ marginTop: '0.5rem' }}>
        <button onClick={submit} disabled={busy || !loginIds.length}>
          {busy ? 'Adding…' : `Add attendance${loginIds.length ? ` for ${loginIds.length}` : ''}`}
        </button>
        {Number(event.pending_count) > 0 && (
          <button className="quiet" onClick={fillPending}>Everyone who asked ({event.pending_count})</button>
        )}
        {club && club.members.length > 0 && (
          <button className="quiet" onClick={() => setText(club.members.map((m) => m.login_id).join('\n'))}>
            All {club.members.length} club members
          </button>
        )}
      </div>
      {error && <Problem>{error}</Problem>}
      {result && (
        <div className={result.failed.length ? 'notice bad' : 'notice good'} style={{ marginTop: '0.5rem' }}>
          <strong>
            Attendance added for {result.added} {result.added === 1 ? 'student' : 'students'}: {result.creditedPeriods} {result.creditedPeriods === 1 ? 'period' : 'periods'} credited.
          </strong>
          {result.already > 0 && ` ${result.already} already had it.`}
          {result.failed.length > 0 && (
            <ul className="plain" style={{ marginTop: '0.375rem' }}>
              {result.failed.map((f) => <li key={f.loginId}>{f.loginId}: {f.reason}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Requests({ eventId, onDecided }) {
  const requests = useApi(`/events/${eventId}/requests`);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const decide = async (id, status) => {
    setError(null);
    try {
      const res = await api.patch(`/events/requests/${id}`, { status });
      const credits = res.credits || [];
      const overrides = credits.filter((c) => c.wasOverride).length;
      const skipped = credits.filter((c) => c.skipped);
      setMessage(status === 'approved'
        ? `Approved. ${credits.filter((c) => !c.skipped).length} period(s) credited${overrides ? `, ${overrides} overriding a teacher's mark` : ''}.`
          + `${skipped.length ? ` Not credited: ${skipped.map((c) => `period ${c.period} (${c.skipped})`).join(', ')}.` : ''}`
        : 'Request rejected.');
      await requests.reload();
      onDecided();
    } catch (err) {
      setError(err.message);
    }
  };

  if (requests.loading) return <Loading what="Loading requests" />;
  if (!requests.data?.length) return <Empty>No join requests yet.</Empty>;

  return (
    <>
      {error && <Problem>{error}</Problem>}
      {message && <div className="notice good">{message}</div>}
      <div className="scroll-x">
        <table>
          <thead><tr><th>Roll</th><th>Student</th><th>Section</th><th>Status</th><th>Attendance</th><th /></tr></thead>
          <tbody>
            {requests.data.map((r) => (
              <tr key={r.id}>
                <td>{r.roll_number}</td>
                <td>{r.student_name}</td>
                <td>{r.section_name}</td>
                <td><span className={`chip ${r.status}`}>{r.status}</span></td>
                <td className="label">
                  {r.status === 'approved' && (
                    <>
                      {r.credits.map((c) => `P${c.period}${c.subject ? ` ${c.subject}` : ''}`).join(', ') || 'nothing credited'}
                      {r.not_credited.length > 0 && ` · not credited: ${r.not_credited.map((m) => `P${m.period} (${m.reason})`).join(', ')}`}
                    </>
                  )}
                </td>
                <td className="num">
                  {r.status === 'pending' && (
                    <>
                      <button onClick={() => decide(r.id, 'approved')}>Approve</button>{' '}
                      <button className="quiet" onClick={() => decide(r.id, 'rejected')}>Reject</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * The HOD's one tap for a foreseen event: every class it overlaps, across the
 * college, is called off. The event's credit periods if it has any, the whole
 * day if not. Undo is right there.
 */
function CancelForEvent({ event, onChanged }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const scope = event.credit_periods.length ? periodsLabel(event.credit_periods) : 'all classes';

  const cancel = async () => {
    setBusy(true);
    try {
      const res = await api.post('/classes/cancel', {
        date: event.event_date,
        periods: event.credit_periods.length ? event.credit_periods : undefined,
        eventId: event.id,
      });
      setState(res.batchId
        ? { ok: `Cancelled ${res.cancelled.length} classes on ${shortDate(res.date)} for "${event.title}". Everyone affected has been told.`, batchId: res.batchId }
        : { bad: `Nothing to cancel: ${res.skipped.map((s) => `${s.sectionName} P${s.periodNumber} (${s.reason})`).join(', ')}.` });
      onChanged();
    } catch (err) {
      setState({ bad: err.message });
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    setBusy(true);
    try {
      const res = await api.del(`/classes/cancellations/${state.batchId}`);
      setState({ ok: `Undone. ${res.restored} classes are back on.` });
      onChanged();
    } catch (err) {
      setState({ bad: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="event-cancel">
      {state?.ok && <Done>{state.ok}{state.batchId && <>{' '}<button className="link" onClick={undo} disabled={busy}>Undo</button></>}</Done>}
      {state?.bad && <Problem>{state.bad}</Problem>}
      {!state?.batchId && (
        <button className="quiet" onClick={cancel} disabled={busy}>
          Cancel {scope} on {shortDate(event.event_date)} for this event
        </button>
      )}
    </div>
  );
}
