import { useMemo, useState } from 'react';
import { api, qs } from '../api.js';
import { useApi } from '../hooks.js';
import { Done, Empty, Loading, PageHead, Problem, Select, when } from '../components/Bits.jsx';

const STATUSES = [
  { key: 'present', short: 'P' },
  { key: 'absent', short: 'A' },
  { key: 'leave', short: 'L' },
];

// Local calendar date. toISOString() would show yesterday to anyone marking
// attendance before 05:30 IST.
const today = () => new Date().toLocaleDateString('en-CA');

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
            <Select label="Period" value={period} options={[1, 2, 3, 4, 5, 6, 7, 8].map((p) => ({ value: String(p), label: `Period ${p}` }))}
              onChange={(v) => { setPeriod(v); setMarks({}); }} />
          </div>
        </div>

        {saved && <Done>{saved}</Done>}
        {saveError && <Problem>{saveError}</Problem>}

        {!ready && <Empty>Choose a course, section, date and period. The roster loads from the timetable.</Empty>}
        {ready && roster.loading && <Loading what="Loading roster" />}
        {ready && roster.error && <Problem>{roster.error}</Problem>}

        {ready && !roster.loading && students.length > 0 && (
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
