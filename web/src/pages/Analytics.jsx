import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { Empty, Loading, PageHead, Problem, pct } from '../components/Bits.jsx';

/**
 * Bars drawn with plain divs. A charting library would add ~90 KB to the
 * bundle for a horizontal bar, which the CSS already does.
 */
function Bars({ rows, label, value, minimum = 75 }) {
  const max = Math.max(100, ...rows.map((r) => Number(value(r)) || 0));
  return (
    <ul className="plain feed">
      {rows.map((r, i) => {
        const v = Number(value(r));
        const low = v < minimum;
        return (
          <li key={i}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span>{label(r)}</span>
              <strong style={{ color: low ? 'var(--absent)' : 'inherit' }}>{pct(v)}</strong>
            </div>
            <div style={{ background: '#eef1f4', borderRadius: 999, height: 8, marginTop: 4 }}>
              <div style={{
                width: `${Math.max(2, (v / max) * 100)}%`,
                height: 8,
                borderRadius: 999,
                background: low ? 'var(--absent)' : 'var(--present)',
              }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function Analytics() {
  const { user } = useAuth();
  const isStudent = user.role === 'student';
  const courses = useApi(isStudent ? null : '/analytics/courses', { skip: isStudent });
  const mine = useApi(isStudent ? `/attendance/student/${user.id}` : null, { skip: !isStudent });

  if (isStudent) {
    if (mine.loading) return <Loading what="Loading your attendance" />;
    if (mine.error) return <Problem>{mine.error}</Problem>;
    const d = mine.data;
    return (
      <>
        <PageHead title="Your attendance" note={`Minimum for your course is ${d.minimum}%.`} />
        <div className="grid-2">
          <div className="panel">
            <header><h3>Overall</h3></header>
            <div className="body">
              <div className={`figure ${d.overall.belowMinimum ? 'low' : ''}`}>{pct(d.overall.percentage)}</div>
              <p className="label">{d.overall.conducted} classes held · {d.overall.present_count} present · {d.overall.absent_count} absent · {d.overall.leave_count} approved leave</p>
              {d.overall.needed > 0 && <div className="notice bad">Attend {d.overall.needed} more classes in a row to reach {d.minimum}%.</div>}
            </div>
          </div>
          <div className="panel">
            <header><h3>By subject</h3></header>
            {d.subjects.length === 0 ? <Empty>No classes recorded yet.</Empty> : (
              <Bars rows={d.subjects} minimum={d.minimum}
                label={(s) => `${s.subject_name} (${s.present_count}/${s.present_count + s.absent_count})`}
                value={(s) => s.percentage ?? 0} />
            )}
          </div>
        </div>
        <div className="panel" style={{ marginTop: '1.25rem' }}>
          <header><h3>Subject detail</h3></header>
          <div className="scroll-x">
            <table>
              <thead><tr><th>Subject</th><th className="num">Held</th><th className="num">Present</th><th className="num">Absent</th><th className="num">Leave</th><th className="num">%</th><th className="num">Classes needed</th></tr></thead>
              <tbody>
                {d.subjects.map((s) => (
                  <tr key={s.subject_id} className={s.belowMinimum ? 'flagged' : ''}>
                    <td>{s.subject_name}</td>
                    <td className="num">{s.conducted}</td>
                    <td className="num">{s.present_count}</td>
                    <td className="num">{s.absent_count}</td>
                    <td className="num">{s.leave_count}</td>
                    <td className="num"><strong>{pct(s.percentage)}</strong></td>
                    <td className="num">{s.needed || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  if (courses.loading) return <Loading what="Loading analytics" />;
  if (courses.error) return <Problem>{courses.error}</Problem>;

  return (
    <>
      <PageHead title="Analytics" note="Average attendance per section." />
      <div className="panel">
        <header><h3>Sections</h3></header>
        {(courses.data || []).length === 0 ? <Empty>No attendance recorded yet.</Empty> : (
          <Bars rows={courses.data} label={(r) => `${r.course_name} · ${r.section_name} (${r.students} students)`}
            value={(r) => r.avg_percentage ?? 0} />
        )}
      </div>
    </>
  );
}
