import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { AttendanceBadge, Empty, Loading, PageHead, Problem, pct, shortDate } from '../components/Bits.jsx';

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
            <div className="bar-track">
              <div className="bar-fill" style={{
                width: `${Math.max(2, (v / max) * 100)}%`,
                background: low ? 'var(--absent)' : 'var(--present)',
              }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const counted = (s) => s.present_count + s.absent_count + (s.not_marked || 0);

export default function Analytics() {
  const { user } = useAuth();
  const isStudent = user.role === 'student';
  const courses = useApi(isStudent ? null : '/analytics/courses', { skip: isStudent });
  const mine = useApi(isStudent ? `/attendance/student/${user.id}` : null, { skip: !isStudent });

  if (isStudent) {
    if (mine.loading) return <Loading what="Loading your attendance" />;
    if (mine.error) return <Problem>{mine.error}</Problem>;
    const d = mine.data;
    const o = d.overall;
    return (
      <>
        <PageHead title="Your attendance" note={`Minimum for your course is ${d.minimum}%.`} />
        <div className="grid-2">
          <div className="panel">
            <header><h3>Overall</h3></header>
            <div className="body stack" style={{ gap: 'var(--s-3)' }}>
              <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <div className={`figure ${o.belowMinimum ? 'low' : ''}`}>{pct(o.percentage)}</div>
                <AttendanceBadge badge={d.badge} compact />
              </div>
              <p className="label" style={{ margin: 0 }}>
                {o.conducted} classes held for you · {o.present_count} present · {o.absent_count} absent
                {o.not_marked ? ` · ${o.not_marked} not marked` : ''} · {o.leave_count} approved leave
              </p>
              <p className="label" style={{ margin: 0 }}>
                Your section has held {d.classesHeld?.section ?? 0} {d.classesHeld?.section === 1 ? 'class' : 'classes'} in total
                {d.classesHeld?.cancelled ? `; ${d.classesHeld.cancelled} more were cancelled and do not count` : ''}.
                Your percentage is measured against the classes that were held.
              </p>
              {o.needed > 0 && <div className="notice bad">Attend {o.needed} more classes in a row to reach {d.minimum}%.</div>}
              {!d.badge?.earned && <AttendanceBadge badge={d.badge} />}
            </div>
          </div>
          <div className="panel">
            <header><h3>By subject</h3></header>
            {d.subjects.every((s) => s.percentage === null) ? <Empty>No classes recorded yet.</Empty> : (
              <Bars rows={d.subjects.filter((s) => s.percentage !== null)} minimum={d.minimum}
                label={(s) => `${s.subject_name} (${s.present_count}/${counted(s)})`}
                value={(s) => s.percentage ?? 0} />
            )}
          </div>
        </div>

        <div className="panel" style={{ marginTop: '1.25rem' }}>
          <header><h3>Subject detail</h3></header>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Subject</th><th className="num">Held</th><th className="num">Present</th><th className="num">Absent</th>
                  <th className="num">Not marked</th><th className="num">Leave</th><th className="num">%</th><th className="num">Classes needed</th>
                </tr>
              </thead>
              <tbody>
                {d.subjects.map((s) => (
                  <tr key={s.subject_id} className={s.belowMinimum ? 'flagged' : ''}>
                    <td>{s.subject_name}</td>
                    <td className="num">{s.conducted}</td>
                    <td className="num">{s.present_count}</td>
                    <td className="num">{s.absent_count}</td>
                    <td className="num">{s.not_marked || 0}</td>
                    <td className="num">{s.leave_count}</td>
                    <td className="num"><strong>{pct(s.percentage)}</strong></td>
                    <td className="num">{s.needed || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="label" style={{ padding: '0 var(--s-4) var(--s-3)', margin: 0 }}>
            &ldquo;Not marked&rdquo; is a class your section held where the register has no mark for you. It counts as
            missed; if you were there, ask your teacher to correct it.
          </p>
        </div>

        <div className="panel" style={{ marginTop: '1.25rem' }}>
          <header><h3>Attendance from events</h3></header>
          {(d.eventCredits || []).length === 0
            ? <Empty>No event has credited a class for you yet. Join an event on the Events page.</Empty>
            : (
              <div className="scroll-x">
                <table>
                  <thead><tr><th>Event</th><th>Date</th><th className="num">Period</th><th>Class</th><th>Status</th></tr></thead>
                  <tbody>
                    {d.eventCredits.map((c) => (
                      <tr key={c.id}>
                        <td>{c.event_title}</td>
                        <td>{shortDate(c.event_date)}</td>
                        <td className="num">{c.period_number}</td>
                        <td>{c.subject_name || '—'}</td>
                        <td>
                          {c.counted
                            ? <span className="chip credit">present, credited</span>
                            : <span className="chip pending">no longer counted</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </>
    );
  }

  if (courses.loading) return <Loading what="Loading analytics" />;
  if (courses.error) return <Problem>{courses.error}</Problem>;
  const rows = courses.data || [];
  const held = rows.reduce((n, r) => n + Number(r.classes_held || 0), 0);
  const cancelled = rows.reduce((n, r) => n + Number(r.classes_cancelled || 0), 0);

  return (
    <>
      <PageHead title="Analytics" note="Average attendance per section, against the classes each section actually held." />
      <div className="stack">
        {rows.length > 0 && (
          <div className="grid-2">
            <div className="panel">
              <div className="body">
                <div className="figure">{held}</div>
                <p className="label" style={{ margin: 0 }}>classes held across the college so far</p>
              </div>
            </div>
            <div className="panel">
              <div className="body">
                <div className="figure">{cancelled}</div>
                <p className="label" style={{ margin: 0 }}>classes cancelled in advance, which count for nobody</p>
              </div>
            </div>
          </div>
        )}
        <div className="panel">
          <header><h3>Sections</h3></header>
          {rows.length === 0 ? <Empty>No attendance recorded yet.</Empty> : (
            <Bars rows={rows}
              label={(r) => `${r.course_name} · ${r.section_name} (${r.students} students · ${r.classes_held} classes held${Number(r.classes_cancelled) ? `, ${r.classes_cancelled} cancelled` : ''})`}
              value={(r) => r.avg_percentage ?? 0} />
          )}
        </div>
      </div>
    </>
  );
}
