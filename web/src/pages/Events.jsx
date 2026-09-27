import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { Empty, Loading, PageHead, Problem, Select } from '../components/Bits.jsx';

const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

export default function Events() {
  const { user } = useAuth();
  const events = useApi('/events');
  const clubs = useApi(['mentor', 'hod'].includes(user.role) ? '/clubs' : null, { skip: !['mentor', 'hod'].includes(user.role) });
  const [open, setOpen] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const canPost = ['hod', 'teacher', 'mentor'].includes(user.role);

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
        ? 'Approving a join request credits the periods you set here.'
        : 'Join an event to have its periods credited once the organiser approves.'} />

      <div className="stack">
        {error && <Problem>{error}</Problem>}
        {message && <div className="notice good">{message}</div>}

        {canPost && <NewEvent clubs={clubs.data || []} role={user.role} onCreated={() => { events.reload(); setMessage('Event posted.'); }} />}

        {events.loading && <Loading what="Loading events" />}
        {!events.loading && (events.data || []).length === 0 && <Empty>No events yet.</Empty>}

        {(events.data || []).map((e) => (
          <div className="panel" key={e.id}>
            <header>
              <h3>{e.title}</h3>
              <span className="label">{e.event_date}</span>
              {e.visibility === 'members_only' && <span className="chip pending">{e.club_name} members only</span>}
              {e.credit_periods.length > 0 && <span className="chip credit">credits period {e.credit_periods.join(', ')}</span>}
            </header>
            <div className="body stack" style={{ gap: '0.75rem' }}>
              {e.description && <p>{e.description}</p>}
              <div className="meta label">Posted by {e.posted_by_name}</div>
              {user.role === 'student' && (
                e.my_request_status
                  ? <span className={`chip ${e.my_request_status}`}>your request: {e.my_request_status}</span>
                  : <div><button onClick={() => join(e.id)}>Ask to join</button></div>
              )}
              {e.created_by === user.id && (
                <div>
                  <button className="quiet" onClick={() => setOpen(open === e.id ? null : e.id)}>
                    {open === e.id ? 'Hide' : 'Review'} join requests{e.pending_count ? ` (${e.pending_count} pending)` : ''}
                  </button>
                </div>
              )}
              {open === e.id && <Requests eventId={e.id} onDecided={() => events.reload()} />}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function NewEvent({ clubs, role, onCreated }) {
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
          <div className="label" style={{ marginBottom: '0.25rem' }}>Periods this event counts for</div>
          <div className="marks">
            {PERIODS.map((p) => (
              <button key={p} type="button" data-status="present" aria-pressed={periods.includes(p)}
                onClick={() => setPeriods((ps) => (ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p].sort()))}>
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

function Requests({ eventId, onDecided }) {
  const requests = useApi(`/events/${eventId}/requests`);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const decide = async (id, status) => {
    setError(null);
    try {
      const res = await api.patch(`/events/requests/${id}`, { status });
      const overrides = (res.credits || []).filter((c) => c.wasOverride).length;
      setMessage(status === 'approved'
        ? `Approved. ${(res.credits || []).filter((c) => !c.skipped).length} period(s) credited${overrides ? `, ${overrides} overriding a teacher's mark` : ''}.`
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
      <table>
        <thead><tr><th>Roll</th><th>Student</th><th>Section</th><th>Status</th><th /></tr></thead>
        <tbody>
          {requests.data.map((r) => (
            <tr key={r.id}>
              <td>{r.roll_number}</td>
              <td>{r.student_name}</td>
              <td>{r.section_name}</td>
              <td><span className={`chip ${r.status}`}>{r.status}</span></td>
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
    </>
  );
}
