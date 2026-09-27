import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { Empty, Loading, PageHead, Problem, Ring, pct, when } from '../components/Bits.jsx';

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function Overview() {
  const { user } = useAuth();
  const { data, loading, error } = useApi('/overview');

  if (loading) return <Loading what="Building your overview" />;
  if (error) return <Problem>{error}</Problem>;

  return (
    <>
      <PageHead title={`Good day, ${user.name.split(' ')[0]}`} note={new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} />
      {data.role === 'student' && <StudentBrief data={data} />}
      {data.role === 'teacher' && <TeacherBrief data={data} />}
      {data.role === 'hod' && <HodBrief data={data} />}
      {data.role === 'admin' && <AdminBrief data={data} />}
      {data.role === 'mentor' && <MentorBrief />}
    </>
  );
}

function StudentBrief({ data }) {
  const a = data.attendance;
  return (
    <div className="grid-2">
      <div className="panel">
        <header><h3>Your attendance</h3></header>
        <div className="body row" style={{ alignItems: 'center', gap: 'var(--s-5)' }}>
          <Ring value={a.percentage} minimum={data.minimum} caption={`of ${data.minimum}% needed`} />
          <div style={{ flex: '1 1 12rem' }}>
            <p className="label" style={{ marginBottom: 'var(--s-3)' }}>
              {a.present_count} present of {a.present_count + a.absent_count} counted classes
              {a.leave_count ? `, and ${a.leave_count} on approved leave` : ''}.
            </p>
            {a.needed > 0 && (
              <div className="notice bad">
                Attend {a.needed} more {a.needed === 1 ? 'class' : 'classes'} in a row to reach {data.minimum}%.
              </div>
            )}
            {a.needed === 0 && <div className="notice good">You are above the minimum. Keep it there.</div>}
            {a.percentage === null && <div className="notice">No classes have been marked for you yet.</div>}
          </div>
        </div>
      </div>

      <div className="panel">
        <header><h3>Today</h3></header>
        {data.todayClasses.length === 0
          ? <Empty>No classes scheduled today.</Empty>
          : (
            <ul className="plain feed">
              {data.todayClasses.map((s) => (
                <li key={s.id}>
                  Period {s.period_number} · {s.subject_name}
                  <div className="meta">{s.teacher_name}</div>
                </li>
              ))}
            </ul>
          )}
        <div className="body">
          <Link to="/leave">Leave desk</Link>
          {data.pendingLeave ? ` — ${data.pendingLeave} request awaiting a decision` : ''}
        </div>
      </div>
    </div>
  );
}

function TeacherBrief({ data }) {
  return (
    <div className="grid-2">
      <div className="panel">
        <header><h3>Your classes today</h3><Link to="/attendance">Mark attendance</Link></header>
        {data.todayClasses.length === 0
          ? <Empty>Nothing on your timetable today.</Empty>
          : (
            <ul className="plain feed">
              {data.todayClasses.map((s) => (
                <li key={s.id}>
                  Period {s.period_number} · {s.subject_name}
                  <div className="meta">{s.course_name} {s.section_name}</div>
                </li>
              ))}
            </ul>
          )}
      </div>
      <div className="panel">
        <header><h3>Waiting on you</h3></header>
        <div className="body">
          <div className="figure">{data.pendingLeave}</div>
          <p className="label">leave {data.pendingLeave === 1 ? 'request' : 'requests'} from your sections.</p>
          <Link to="/leave">Open the leave desk</Link>
        </div>
      </div>
    </div>
  );
}

const SETUP_STEPS = [
  { key: 'courses', done: (s) => s.courses > 0, what: 'Add a course', why: 'Everything else hangs off a course.', to: '/setup' },
  { key: 'sections', done: (s) => s.sections > 0, what: 'Add sections', why: 'Students and timetables belong to a section.', to: '/setup' },
  { key: 'subjects', done: (s) => s.subjects > 0, what: 'Add subjects', why: 'Each period on the timetable teaches one.', to: '/setup' },
  { key: 'teachers', done: (s) => s.teachers > 0, what: 'Create teacher accounts', why: 'The timetable assigns a teacher to every period.', to: '/setup' },
  { key: 'allocations', done: (s) => s.sections > 0 && s.sections_without_teacher === 0, what: 'Allocate a class teacher to each section', why: 'Leave requests route to them. Without one, only you see them.', to: '/setup' },
  { key: 'slots', done: (s) => s.sections > 0 && s.sections_without_timetable === 0, what: 'Fill each section\u2019s timetable', why: 'Nobody can mark attendance until the grid exists.', to: '/schedule' },
  { key: 'criteria', done: (s) => s.criteria > 0, what: 'Set the minimum attendance percentage', why: 'Without it every course falls back to 75%.', to: '/setup' },
  { key: 'students', done: (s) => s.students > 0, what: 'Add students', why: 'One at a time, or paste a CSV in bulk.', to: '/setup' },
];

function SetupChecklist({ setup }) {
  const firstUndone = SETUP_STEPS.find((step) => !step.done(setup));
  return (
    <div className="panel">
      <header>
        <h3>Finish setting up the department</h3>
        <span className="label">
          {SETUP_STEPS.filter((s) => s.done(setup)).length} of {SETUP_STEPS.length} done
        </span>
      </header>
      <p className="label" style={{ padding: '0 var(--s-4)', marginTop: 'var(--s-3)' }}>
        Teachers cannot mark a register until the timetable exists. These steps depend on each other,
        so work down the list.
      </p>
      <ul className="checklist">
        {SETUP_STEPS.map((step) => {
          const done = step.done(setup);
          return (
            <li key={step.key} className={`${done ? 'done' : ''} ${step === firstUndone ? 'next' : ''}`}>
              <span className="mark" aria-hidden="true">{done ? '\u2713' : '\u25cb'}</span>
              <span className="what">
                {done ? step.what : <Link to={step.to}>{step.what}</Link>}
                <span className="why">{step.why}</span>
              </span>
              <span className="label">{done ? 'done' : step === firstUndone ? 'next' : ''}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HodBrief({ data }) {
  return (
    <div className="stack">
      {data.setup && !data.setup.complete && <SetupChecklist setup={data.setup} />}
      <div className="grid-2">
        <div className="panel">
          <header><h3>Average attendance by section</h3><Link to="/records">Records</Link></header>
          <div className="scroll-x">
            <table>
              <thead><tr><th>Course</th><th>Section</th><th className="num">Students</th><th className="num">Average</th></tr></thead>
              <tbody>
                {data.courseAverages.length === 0 && (
                  <tr><td colSpan={4} className="label">No attendance has been marked yet.</td></tr>
                )}
                {data.courseAverages.map((r) => (
                  <tr key={`${r.course_id}-${r.section_name}`} className={r.avg_percentage !== null && r.avg_percentage < 75 ? 'flagged' : ''}>
                    <td>{r.course_name}</td><td>{r.section_name}</td>
                    <td className="num">{r.students}</td><td className="num">{pct(r.avg_percentage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <header><h3>Leave desk</h3></header>
          <div className="body">
            <div className="figure">{data.pendingLeave}</div>
            <p className="label">requests awaiting a decision.</p>
            <Link to="/leave">Review them</Link>
          </div>
        </div>
      </div>

      <div className="panel">
        <header><h3>Latest activity</h3><Link to="/activities">Full audit trail</Link></header>
        <ul className="plain feed">
          {data.recentActivity.map((a) => (
            <li key={a.id}>
              <strong>{a.action_type}</strong> by {a.actor_name || 'system'}
              <div className="meta">{when(a.created_at)}{a.reason ? ` · ${a.reason}` : ''}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const MentorBrief = () => (
  <div className="grid-2">
    <div className="panel">
      <header><h3>Your club</h3></header>
      <div className="body"><p>Create a club, add members by login ID, and post events that credit class periods.</p><Link to="/clubs">Open clubs</Link></div>
    </div>
    <div className="panel">
      <header><h3>Events</h3></header>
      <div className="body"><p>Approving a join request marks the student present for the periods your event covers.</p><Link to="/events">Open events</Link></div>
    </div>
  </div>
);

/**
 * An administrator has no timetable and no register, so their landing page is
 * the state of the college: who exists, and the one thing that blocks
 * everything else when a department has no HOD.
 */
function AdminBrief({ data }) {
  const a = data.accounts;
  const rows = [
    ['Administrators', a.admins],
    ['HODs', a.hods],
    ['Teachers', a.teachers],
    ['Mentors', a.mentors],
    ['Students', a.students],
  ];

  return (
    <div className="stack">
      {a.hods === 0 && (
        <div className="panel">
          <div className="body">
            <div className="notice">
              <p className="label" style={{ marginBottom: 'var(--s-3)' }}>
                Nothing can happen until a department has a head. The HOD creates the courses,
                the timetable and the students; you create the HOD.
              </p>
              <Link to="/accounts">Create the HOD account</Link>
            </div>
          </div>
        </div>
      )}

      <div className="grid-2">
        <div className="panel">
          <header><h3>Accounts</h3></header>
          <div className="body">
            <table>
              <tbody>
                {rows.map(([label, n]) => (
                  <tr key={label}><td>{label}</td><td style={{ textAlign: 'right' }}><strong>{n}</strong></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <header><h3>Recent activity</h3></header>
          {!data.recentActivity.length
            ? <Empty>Nothing has happened yet.</Empty>
            : (
              <ul className="plain feed">
                {data.recentActivity.map((r) => (
                  <li key={r.id}>
                    {String(r.action_type || '').replace(/[._]/g, ' ')}
                    <div className="meta">{r.actor_name || 'system'} · {when(r.created_at)}</div>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>
    </div>
  );
}
