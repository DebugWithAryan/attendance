import { useMemo, useState } from 'react';
import { api, qs } from '../api.js';
import { useApi } from '../hooks.js';
import { Done, Empty, Loading, PageHead, Problem, Select, localToday, periodList, when } from '../components/Bits.jsx';

const STATUSES = [
  { key: 'present', short: 'P' },
  { key: 'absent', short: 'A' },
  { key: 'leave', short: 'L' },
];

// Local calendar date. toISOString() would show yesterday to anyone marking
// attendance before 05:30 IST.
const today = localToday;

/**
 * The marking screen. Cascading pickers, then a ledger the teacher can run down
 * with one tap per student. Rows already credited through an event are tinted
 * and explain themselves rather than silently reading "present".
 */
export default function Attendance() {
  const [courseId, setCourseId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [classDate, setClassDate] = useState(today());
  const [period, setPeriod] = useState('');
  const [marks, setMarks] = useState({});
  const [saved, setSaved] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);

  const courses = useApi('/courses');
  const sections = useApi(courseId ? `/sections?courseId=${courseId}` : null, { skip: !courseId });

  const ready = sectionId && classDate && period;
  const roster = useApi(ready ? `/attendance/roster${qs({ sectionId, classDate, periodNumber: period })}` : null, { skip: !ready });

  const students = roster.data?.students || [];
  const cancelled = roster.data?.cancelled;
  const registerTaken = roster.data?.session?.status === 'held';
  // The period picker is as long as the chosen course's day.
  const chosenCourse = (courses.data || []).find((c) => c.id === courseId);
  const periodsPerDay = chosenCourse?.periods_per_day;
  const periodTime = (p) => chosenCourse?.timings?.periods?.[p - 1];
  const [cancelling, setCancelling] = useState(null);
  const current = (s) => marks[s.studentId] ?? s.status ?? null;

  const tally = useMemo(() => students.reduce((acc, s) => {
    const v = current(s);
    return v ? { ...acc, [v]: (acc[v] || 0) + 1 } : { ...acc, unmarked: (acc.unmarked || 0) + 1 };
  }, {}), [students, marks]);

  const setAll = (status) => setMarks(Object.fromEntries(students.map((s) => [s.studentId, status])));

  const save = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      const payload = students
        .map((s) => ({ student_id: s.studentId, status: current(s) }))
        .filter((m) => m.status);
      const res = await api.post('/attendance/roster', {
        sectionId, classDate, periodNumber: Number(period), marks: payload,
      });
      setSaved(`Saved ${res.saved} students.`);
      setMarks({});
      await roster.reload();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // A teacher calling off their own class, and taking it back.
  const cancelClass = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      const res = await api.post('/classes/cancel', {
        date: classDate, sectionId, periods: [Number(period)], reason: cancelling.reason.trim() || undefined,
      });
      if (!res.batchId) throw new Error(`Not cancelled: ${res.skipped.map((x) => x.reason).join(', ')}.`);
      setCancelling(null);
      setSaved('Class cancelled. The students, and the HOD, have been told.');
      await roster.reload();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const restoreClass = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      await api.del(`/classes/cancellations/${cancelled.batchId}`);
      setSaved('The class is back on. Take the register as usual.');
      await roster.reload();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const applyEdit = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      await api.patch(`/attendance/record/${editing.recordId}`, { status: editing.status, reason: editing.reason });
      setEditing(null);
      setSaved('Correction saved and logged.');
      await roster.reload();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Mark attendance" note="Pick the class, then run down the list." />

      <div className="stack">
        <div className="panel">
          <div className="body row">
            <Select label="Course" value={courseId} options={(courses.data || []).map((c) => ({ value: c.id, label: c.name }))}
              onChange={(v) => { setCourseId(v); setSectionId(''); setMarks({}); }} />
            <Select label="Section" value={sectionId} options={(sections.data || []).map((s) => ({ value: s.id, label: s.name }))}
              onChange={(v) => { setSectionId(v); setMarks({}); }} placeholder={courseId ? 'Select' : 'Pick a course first'} />
            <label className="field">
              Date
              <input type="date" value={classDate} onChange={(e) => { setClassDate(e.target.value); setMarks({}); }} />
            </label>
            <Select label="Period" value={period} options={periodList(periodsPerDay).map((p) => ({ value: String(p), label: periodTime(p) ? `Period ${p} · ${periodTime(p)}` : `Period ${p}` }))}
              onChange={(v) => { setPeriod(v); setMarks({}); setCancelling(null); }} />
          </div>
        </div>

        {saved && <Done>{saved}</Done>}
        {saveError && <Problem>{saveError}</Problem>}

        {!ready && <Empty>Choose a course, section, date and period. The roster loads from the timetable.</Empty>}
        {ready && roster.loading && <Loading what="Loading roster" />}
        {ready && roster.error && <Problem>{roster.error}</Problem>}

        {ready && !roster.loading && cancelled && (
          <div className="notice bad">
            <strong>This class is cancelled.</strong>{' '}
            {cancelled.reason ? `${cancelled.reason}. ` : ''}Cancelled by {cancelled.by}, so there is no register to take
            and it does not count towards anyone&apos;s attendance.
            <div style={{ marginTop: '0.5rem' }}>
              <button className="quiet" onClick={restoreClass} disabled={busy}>Restore this class</button>
            </div>
          </div>
        )}

        {ready && !roster.loading && !cancelled && !registerTaken && students.length > 0 && (
          cancelling ? (
            <div className="notice">
              <div className="row">
                <label className="field" style={{ flex: 1, minWidth: '14rem' }}>
                  Why is this class not happening? (optional)
                  <input value={cancelling.reason} autoFocus maxLength={200}
                    onChange={(e) => setCancelling({ reason: e.target.value })} placeholder="Attending a workshop" />
                </label>
                <button className="danger" onClick={cancelClass} disabled={busy}>Cancel this class</button>
                <button className="quiet" onClick={() => setCancelling(null)}>Keep it</button>
              </div>
            </div>
          ) : (
            <div>
              <button className="link" onClick={() => setCancelling({ reason: '' })}>
                Not taking this class? Cancel it instead
              </button>
            </div>
          )
        )}

        {ready && !roster.loading && !cancelled && students.length > 0 && (
          <div className="panel">
            <header>
              <h3>{students.length} students</h3>
              <button className="quiet" onClick={() => setAll('present')}>Mark all present</button>
              <button className="quiet" onClick={() => setMarks({})}>Reset changes</button>
            </header>

            <div className="register">
              {students.map((s) => {
                const status = current(s);
                const credited = s.source === 'event_credit';
                return (
                  <div key={s.studentId} className={`line ${status ? `is-${status}` : 'unmarked'} ${credited ? 'is-credited' : ''}`}>
                    <span className="roll">{s.rollNumber}</span>
                    <span className="who">
                      {s.name}
                      <small>
                        {s.onApprovedLeave && 'On approved leave. '}
                        {s.overrideNote || (s.savedAt ? `Saved ${when(s.savedAt)} by ${s.lastUpdatedBy || 'you'}` : 'Not marked yet')}
                      </small>
                    </span>
                    <span className="marks">
                      {STATUSES.map((st) => (
                        <button
                          key={st.key}
                          data-status={st.key}
                          aria-pressed={status === st.key}
                          title={`Mark ${s.name} ${st.key}`}
                          aria-label={`Mark ${s.name} ${st.key}`}
                          onClick={() => setMarks((m) => ({ ...m, [s.studentId]: st.key }))}
                        >
                          {st.short}
                        </button>
                      ))}
                      {s.recordId && (
                        <button className="quiet" style={{ marginLeft: '0.5rem' }}
                          onClick={() => setEditing({ recordId: s.recordId, name: s.name, status: status || 'present', reason: '' })}>
                          Correct
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="savebar">
              <span className="tally">
                <span>
                  <strong>{tally.present || 0}</strong> present · <strong>{tally.absent || 0}</strong> absent
                  {' · '}<strong>{tally.leave || 0}</strong> leave
                  {tally.unmarked ? ` · ${tally.unmarked} not marked` : ''}
                </span>
                {tally.unmarked > 0 && (
                  <span className="label unmarked-hint">
                    Anyone left unmarked counts as missing this class once it is saved.
                  </span>
                )}
                <span className="progress" aria-hidden="true">
                  <span style={{ width: `${Math.round(((students.length - (tally.unmarked || 0)) / Math.max(1, students.length)) * 100)}%` }} />
                </span>
              </span>
              <button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save attendance'}</button>
            </div>
          </div>
        )}

        {editing && (
          <div className="panel">
            <header><h3>Correct {editing.name}</h3></header>
            <div className="body stack" style={{ gap: '0.75rem' }}>
              <p className="label">
                Corrections are allowed for {roster.data?.editWindowHours || 48} hours after saving, and are recorded
                in the department audit trail with your name.
              </p>
              <div className="row">
                <Select label="New status" value={editing.status} placeholder="Select"
                  options={STATUSES.map((s) => ({ value: s.key, label: s.key }))}
                  onChange={(v) => setEditing((e) => ({ ...e, status: v }))} />
                <label className="field" style={{ flex: 1, minWidth: '16rem' }}>
                  Reason
                  <input value={editing.reason} onChange={(e) => setEditing((x) => ({ ...x, reason: e.target.value }))}
                    placeholder="Marked by mistake" />
                </label>
              </div>
              <div className="row">
                <button onClick={applyEdit} disabled={busy || editing.reason.trim().length < 3}>Save correction</button>
                <button className="quiet" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
