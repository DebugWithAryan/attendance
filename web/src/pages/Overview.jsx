import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { AttendanceBadge, Empty, Loading, PageHead, Problem, Ring, localToday, pct, when } from '../components/Bits.jsx';
import { CancellationList } from '../components/Cancellations.jsx';

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function Overview() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi('/overview');

  // Only the first load shows a skeleton: a refresh after cancelling a class
  // must not unmount the panel that is offering to undo it.
  if (loading && !data) return <Loading what="Building your overview" />;
  if (error && !data) return <Problem>{error}</Problem>;

  return (
    <>
      <PageHead title={`Good day, ${user.name.split(' ')[0]}`} note={new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} />
      {data.role === 'student' && <StudentBrief data={data} user={user} />}
      {data.role === 'teacher' && <TeacherBrief data={data} user={user} onChanged={reload} />}
      {data.role === 'hod' && <HodBrief data={data} user={user} onChanged={reload} />}
      {data.role === 'admin' && <AdminBrief data={data} user={user} onChanged={reload} />}
      {data.role === 'mentor' && <MentorBrief />}
    </>
  );
}

/** One of today's classes, struck through with its reason when it has been cancelled. */
function TodayClass({ slot, detail, time, children }) {
  return (
    <li className={slot.cancelled ? 'is-cancelled' : ''}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span>
          <span className="what">Period {slot.period_number}{time ? ` (${time})` : ''} · {slot.subject_name}</span>
          {slot.cancelled && <> <span className="chip cancelled">cancelled</span></>}
          {slot.register_taken && <> <span className="chip approved">register taken</span></>}
        </span>
        {children}
      </div>
      <div className="meta">
        {detail}
        {slot.cancelled && slot.cancel_reason ? ` · ${slot.cancel_reason}` : ''}
      </div>
    </li>
  );
}

function StudentBrief({ data, user }) {
  const a = data.attendance;
  const counted = a.present_count + a.absent_count + (a.not_marked || 0);
  return (
    <div className="stack">
      {data.badge?.earned && (
        <div className="panel badge-panel">
          <div className="body row" style={{ alignItems: 'center' }}>
            <AttendanceBadge badge={data.badge} />
            <p className="label" style={{ margin: 0, flex: '1 1 14rem' }}>
              You have attended {pct(a.percentage)} of the classes held for you. That puts you in the
              {' '}{data.badge.threshold}% club: the badge shows on your profile, and your teachers see it on the register.
            </p>
          </div>
        </div>
      )}
      <div className="grid-2">
        <div className="panel">
          <header><h3>Your attendance</h3></header>
          <div className="body row" style={{ alignItems: 'center', gap: 'var(--s-5)' }}>
            <Ring value={a.percentage} minimum={data.minimum} caption={`of ${data.minimum}% needed`} />
            <div style={{ flex: '1 1 12rem' }}>
              <p className="label" style={{ marginBottom: 'var(--s-3)' }}>
                {a.present_count} present of {counted} counted classes
                {a.not_marked ? ` (${a.not_marked} held without a mark for you)` : ''}
                {a.leave_count ? `, and ${a.leave_count} on approved leave` : ''}.
                {' '}{data.section} has held {data.classesHeld?.section ?? 0} classes so far.
              </p>
              {a.needed > 0 && (
                <div className="notice bad">
                  Attend {a.needed} more {a.needed === 1 ? 'class' : 'classes'} in a row to reach {data.minimum}%.
                </div>
              )}
              {a.needed === 0 && <div className="notice good">You are above the minimum. Keep it there.</div>}
              {a.percentage === null && <div className="notice">No classes have been marked for you yet.</div>}
              {!data.badge?.earned && <AttendanceBadge badge={data.badge} />}
            </div>
          </div>
        </div>

        <div className="panel">
          <header><h3>Today</h3></header>
          {data.todayClasses.length === 0
            ? <Empty>No classes scheduled today.</Empty>
            : (
              <ul className="plain feed today">
                {data.todayClasses.map((s) => (
                  <TodayClass key={s.id} slot={s} detail={s.teacher_name} time={data.timings?.periods?.[s.period_number - 1]} />
                ))}
              </ul>
            )}
          {data.upcomingCancellations?.length > 0 && (
            <>
              <div className="label" style={{ padding: 'var(--s-3) var(--s-4) 0' }}>Cancelled classes ahead</div>
              <CancellationList user={user} items={data.upcomingCancellations} />
            </>
          )}
          <div className="body">
            <Link to="/leave">Leave desk</Link>
            {data.pendingLeave ? ` — ${data.pendingLeave} request awaiting a decision` : ''}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A teacher's day. Each class that has not been taken yet can be called off
 * with one tap, and undone the same way.
 */
function TeacherBrief({ data, user, onChanged }) {
  const [problem, setProblem] = useState(null);
  const [undo, setUndo] = useState(null);

  const cancel = async (slot) => {
    setProblem(null);
    try {
      const res = await api.post('/classes/cancel', { date: localToday(), sectionId: slot.section_id, periods: [slot.period_number] });
      if (!res.batchId) throw new Error(`Not cancelled: ${res.skipped.map((x) => x.reason).join(', ')}.`);
      setUndo({ batchId: res.batchId, label: `Period ${slot.period_number} · ${slot.section_name}` });
      onChanged();
    } catch (err) {
      setProblem(err.message);
    }
  };

  const restore = async () => {
    setProblem(null);
    try {
      await api.del(`/classes/cancellations/${undo.batchId}`);
      setUndo(null);
      onChanged();
    } catch (err) {
      setProblem(err.message);
    }
  };

  return (
    <div className="grid-2">
      <div className="panel">
        <header><h3>Your classes today</h3><Link to="/attendance">Mark attendance</Link></header>
        {problem && <Problem>{problem}</Problem>}
        {undo && (
          <div className="notice good" role="status">
            {undo.label} is cancelled and your students have been told.{' '}
            <button className="link" onClick={restore}>Undo</button>
          </div>
        )}
        {data.todayClasses.length === 0
          ? <Empty>Nothing on your timetable today.</Empty>
          : (
            <ul className="plain feed today">
              {data.todayClasses.map((s) => (
                <TodayClass key={s.id} slot={s} detail={`${s.course_name} ${s.section_name}`} time={s.timings?.periods?.[s.period_number - 1]}>
                  {!s.cancelled && !s.register_taken && (
                    <button className="link" onClick={() => cancel(s)}
                      aria-label={`Cancel period ${s.period_number}, ${s.section_name}, today`}>
                      cancel
                    </button>
                  )}
                </TodayClass>
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
        {data.upcomingCancellations?.length > 0 && (
          <>
            <div className="label" style={{ padding: '0 var(--s-4)' }}>Your cancelled classes ahead</div>
            <CancellationList user={user} items={data.upcomingCancellations} onChanged={onChanged} />
          </>
        )}
      </div>
    </div>
  );
}

/** The college's own count: classes held, today's, and cancellations ahead. */
function ClassStats({ stats, user, cancellations, onChanged }) {
  if (!stats) return null;
  return (
    <div className="panel">
      <header>
        <h3>Classes held</h3>
        <Link to="/schedule?cancel=1">Cancel classes</Link>
      </header>
      <div className="body stat-row">
        <div><div className="figure">{stats.held}</div><p className="label">held so far</p></div>
        <div><div className="figure">{stats.held_today}</div><p className="label">held today</p></div>
        <div><div className="figure">{stats.cancelled_upcoming}</div><p className="label">cancelled ahead</p></div>
      </div>
      {cancellations && cancellations.length > 0 && (
        <CancellationList user={user} items={cancellations} onChanged={onChanged} />
      )}
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

function HodBrief({ data, user, onChanged }) {
  return (
    <div className="stack">
      {data.setup && !data.setup.complete && <SetupChecklist setup={data.setup} />}
      <ClassStats stats={data.classStats} user={user} cancellations={data.upcomingCancellations} onChanged={onChanged} />
      <div className="grid-2">
        <div className="panel">
          <header><h3>Average attendance by section</h3><Link to="/records">Records</Link></header>
          <div className="scroll-x">
            <table>
              <thead><tr><th>Course</th><th>Section</th><th className="num">Students</th><th className="num">Classes held</th><th className="num">Average</th></tr></thead>
              <tbody>
                {data.courseAverages.length === 0 && (
                  <tr><td colSpan={5} className="label">No attendance has been marked yet.</td></tr>
                )}
                {data.courseAverages.map((r) => (
                  <tr key={`${r.course_id}-${r.section_name}`} className={r.avg_percentage !== null && r.avg_percentage < 75 ? 'flagged' : ''}>
                    <td>{r.course_name}</td><td>{r.section_name}</td>
                    <td className="num">{r.students}</td><td className="num">{r.classes_held}</td>
                    <td className="num">{pct(r.avg_percentage)}</td>
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
function AdminBrief({ data, user, onChanged }) {
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

      <ClassStats stats={data.classStats} user={user} onChanged={onChanged} />

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
