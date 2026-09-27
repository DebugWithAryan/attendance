import { useRef, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { Empty, Loading, PageHead, Problem, when } from '../components/Bits.jsx';

export default function Leave() {
  const { user } = useAuth();
  return user.role === 'student' ? <StudentLeave /> : <ApproverLeave />;
}

/** Opens a certificate through the authorised endpoint rather than a link. */
function CertificateButton({ id, hasDocument, onError }) {
  const [busy, setBusy] = useState(false);
  if (!hasDocument) return <span className="label">No certificate attached.</span>;

  return (
    <button
      className="quiet"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.openDocument(`/leave/${id}/document`);
        } catch (err) {
          onError?.(err.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? 'Opening…' : 'View medical certificate'}
    </button>
  );
}

function StudentLeave() {
  const mine = useApi('/leave/mine');
  const [form, setForm] = useState({ fromDate: '', toDate: '', reason: '' });
  const [certificate, setCertificate] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const camera = useRef(null);
  const picker = useRef(null);

  const attach = async (file) => {
    if (!file) return;
    setError(null);
    try {
      setCertificate({ dataUrl: await api.readFile(file), name: file.name || 'photo' });
    } catch (err) {
      setError(err.message);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The certificate travels with the request, so nothing is stored unless
      // the request itself is created.
      await api.post('/leave', { ...form, certificate: certificate?.dataUrl });
      setForm({ fromDate: '', toDate: '', reason: '' });
      setCertificate(null);
      await mine.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Leave desk" note="Apply for leave and attach a medical certificate." />
      <div className="grid-2">
        <div className="panel">
          <header><h3>Apply</h3></header>
          <form className="body stack" style={{ gap: '0.75rem' }} onSubmit={submit}>
            <div className="row">
              <label className="field">From<input type="date" required value={form.fromDate}
                onChange={(e) => setForm({ ...form, fromDate: e.target.value })} /></label>
              <label className="field">To<input type="date" required value={form.toDate}
                onChange={(e) => setForm({ ...form, toDate: e.target.value })} /></label>
            </div>
            <label className="field">
              Reason
              <textarea required minLength={5} value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Viral fever, advised three days rest" />
            </label>

            {/* Camera capture and file picker are two inputs, one path. */}
            <input ref={camera} type="file" accept="image/*" capture="environment" hidden
              onChange={(e) => attach(e.target.files[0])} />
            <input ref={picker} type="file" accept="image/*,application/pdf" hidden
              onChange={(e) => attach(e.target.files[0])} />
            <div className="row">
              <button type="button" className="quiet" onClick={() => camera.current.click()}>Take a photo</button>
              <button type="button" className="quiet" onClick={() => picker.current.click()}>Choose a file</button>
            </div>
            {certificate && (
              <div className="notice good">
                Certificate attached ({certificate.name}). Only your class teacher and the HOD can open it.
                {' '}
                <button type="button" className="link" onClick={() => setCertificate(null)}>Remove</button>
              </div>
            )}
            {error && <Problem>{error}</Problem>}
            <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
          </form>
        </div>

        <div className="panel">
          <header><h3>Your requests</h3></header>
          {mine.loading && <Loading />}
          {!mine.loading && (mine.data || []).length === 0 && <Empty>No requests yet.</Empty>}
          <ul className="plain feed">
            {(mine.data || []).map((r) => (
              <li key={r.id}>
                <strong>{r.from_date} to {r.to_date}</strong> <span className={`chip ${r.status}`}>{r.status}</span>
                <div className="meta">{r.reason}</div>
                {r.decision_note && <div className="meta">Note: {r.decision_note}</div>}
                {r.has_document && <div className="meta">Certificate attached</div>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

function ApproverLeave() {
  const [tab, setTab] = useState('pending');
  const queue = useApi(`/leave/queue${tab === 'history' ? '' : `?status=${tab}`}`, { skip: tab === 'history' });
  const history = useApi('/leave/history', { skip: tab !== 'history' });
  const [note, setNote] = useState({});
  const [revising, setRevising] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const active = tab === 'history' ? history : queue;
  const rows = active.data || [];

  const decide = async (id, status) => {
    setError(null);
    setMessage(null);
    try {
      const res = await api.patch(`/leave/${id}`, { status, note: note[id] || undefined });
      setMessage(status === 'approved'
        ? `Approved. ${res.periodsMarked} periods marked as leave and the teachers were notified.`
        : 'Request rejected.');
      await active.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const revise = async () => {
    setError(null);
    setMessage(null);
    try {
      const res = await api.patch(`/leave/${revising.id}/decision`, {
        status: revising.status, reason: revising.reason,
      });
      setMessage(revising.status === 'approved'
        ? `Changed to approved. ${res.periodsChanged} periods marked as leave.`
        : `Changed to rejected. ${res.periodsChanged} leave periods removed from the register.`);
      setRevising(null);
      await active.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHead title="Leave desk" note="Approving a request marks those periods as leave for every teacher.">
        <div className="row">
          {['pending', 'approved', 'rejected', 'history'].map((t) => (
            <button key={t} className={t === tab ? '' : 'quiet'}
              onClick={() => { setTab(t); setMessage(null); setError(null); setRevising(null); }}>
              {t}
            </button>
          ))}
        </div>
      </PageHead>

      <div className="stack">
        {message && <div className="notice good">{message}</div>}
        {error && <Problem>{error}</Problem>}
        {active.loading && <Loading what="Loading requests" />}
        {!active.loading && rows.length === 0 && <Empty>Nothing here.</Empty>}

        {rows.map((r) => (
          <div className="panel" key={r.id}>
            <header>
              <h3>{r.student_name} · {r.roll_number}</h3>
              <span className={`chip ${r.status}`}>{r.status}</span>
              <span className="label">{r.from_date} to {r.to_date}</span>
            </header>
            <div className="body stack" style={{ gap: '0.75rem' }}>
              <p>{r.reason}</p>
              <div><CertificateButton id={r.id} hasDocument={r.has_document} onError={setError} /></div>

              {r.status === 'pending' && (
                <>
                  <label className="field">
                    Note (optional)
                    <input value={note[r.id] || ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })}
                      placeholder="Certificate verified" />
                  </label>
                  <div className="row">
                    <button onClick={() => decide(r.id, 'approved')}>Approve</button>
                    <button className="quiet" onClick={() => decide(r.id, 'rejected')}>Reject</button>
                  </div>
                </>
              )}

              {r.decided_at && (
                <div className="meta label">
                  Decided {when(r.decided_at)}{r.decision_note ? ` · ${r.decision_note}` : ''}
                </div>
              )}

              {r.status !== 'pending' && revising?.id !== r.id && (
                <div>
                  <button className="link" onClick={() => setRevising({
                    id: r.id, status: r.status === 'approved' ? 'rejected' : 'approved', reason: '',
                  })}>
                    Change this decision
                  </button>
                </div>
              )}

              {revising?.id === r.id && (
                <div className="notice">
                  <p className="label">
                    Changing to <strong>{revising.status}</strong>.{' '}
                    {revising.status === 'rejected'
                      ? 'The leave days this approval wrote will be removed from the register.'
                      : 'Those days will be marked as leave across the timetable.'}
                    {' '}The student and the class teacher are notified, and the change is logged.
                  </p>
                  <label className="field">
                    Reason
                    <input value={revising.reason} autoFocus
                      onChange={(e) => setRevising({ ...revising, reason: e.target.value })}
                      placeholder="Certificate turned out to be for a different date" />
                  </label>
                  <div className="row" style={{ marginTop: '0.5rem' }}>
                    <button onClick={revise} disabled={revising.reason.trim().length < 3}>
                      Change to {revising.status}
                    </button>
                    <button className="quiet" onClick={() => setRevising(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
