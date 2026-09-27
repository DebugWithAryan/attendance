import { useState } from 'react';
import { api, qs } from '../api.js';
import { useApi } from '../hooks.js';
import { Empty, Loading, PageHead, Problem, Select, pct } from '../components/Bits.jsx';

/** The register HOD and teachers read, and the two exports that come off it. */
export default function Records() {
  const [courseId, setCourseId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState(null);

  const courses = useApi('/courses');
  const sections = useApi(courseId ? `/sections?courseId=${courseId}` : null, { skip: !courseId });

  const ready = courseId || sectionId;
  const query = qs({ courseId, sectionId, from, to });
  const rows = useApi(ready ? `/records${query}` : null, { skip: !ready });

  const download = async (onlyBelow) => {
    setNote(null);
    try {
      const res = await api.download(`/records/export${qs({ courseId, sectionId, from, to, onlyBelow })}`);
      if (res.cancelled) setNote('Sharing cancelled. Nothing left this device.');
      else setNote(`${res.name} ${res.shared ? 'shared' : 'downloaded'} (${res.rows} rows). The export is recorded in the audit trail.`);
    } catch (err) {
      setNote(err.message);
    }
  };

  const data = rows.data || [];
  const below = data.filter((r) => r.belowMinimum).length;
  const badged = data.filter((r) => r.badge).length;
  // Each section's own count of classes held in the range: the college's total.
  const heldBySection = [...new Map(data.map((r) => [r.section_name, r.section_classes_held])).entries()];

  return (
    <>
      <PageHead title="Records" note="Attendance by student, with anyone under the minimum flagged." />

      <div className="stack">
        <div className="panel">
          <div className="body row">
            <Select label="Course" value={courseId} options={(courses.data || []).map((c) => ({ value: c.id, label: c.name }))}
              onChange={(v) => { setCourseId(v); setSectionId(''); }} />
            <Select label="Section" value={sectionId} placeholder="All sections"
              options={(sections.data || []).map((s) => ({ value: s.id, label: s.name }))} onChange={setSectionId} />
            <label className="field">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="field">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <button className="quiet" onClick={() => window.print()} disabled={!ready}>Print / PDF</button>
            <button className="quiet" onClick={() => download(false)} disabled={!ready}>Export all</button>
            <button onClick={() => download(true)} disabled={!ready}>Export under minimum</button>
          </div>
        </div>

        {note && <div className="notice">{note}</div>}
        {!ready && <Empty>Pick a course to load the register.</Empty>}
        {rows.loading && <Loading what="Loading records" />}
        {rows.error && <Problem>{rows.error}</Problem>}

        {ready && !rows.loading && data.length > 0 && (
          <div className="panel">
            <header>
              <h3>{data.length} students</h3>
              <span className="label">{below} under the minimum</span>
              <span className="label"><span className="star-mark" aria-hidden="true">{'\u2605'}</span> {badged} with the attendance badge</span>
            </header>
            <p className="label held-line">
              Classes held{from || to ? ' in this range' : ''}: {heldBySection.map(([name, n]) => `${name} ${n}`).join(' \u00b7 ')}.
              {' '}Percentages count a held class with no mark as missed.
            </p>
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>Roll</th><th>Name</th><th>Login ID</th><th>Section</th>
                    <th className="num">Held</th><th className="num">Present</th>
                    <th className="num">Absent</th><th className="num">Not marked</th><th className="num">Leave</th>
                    <th className="num">Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.student_id} className={r.belowMinimum ? 'flagged' : ''}>
                      <td>{r.roll_number}</td>
                      <td>
                        {r.name}
                        {r.badge && <span className="star-mark" title="Attendance badge" aria-label="has the attendance badge"> {'\u2605'}</span>}
                      </td>
                      <td>{r.login_id}</td>
                      <td>{r.section_name}</td>
                      <td className="num">{r.conducted}</td>
                      <td className="num">{r.present_count}</td>
                      <td className="num">{r.absent_count}</td>
                      <td className="num">{r.not_marked}</td>
                      <td className="num">{r.leave_count}</td>
                      <td className="num"><strong>{pct(r.percentage)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
