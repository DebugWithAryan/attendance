import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { PageHead, QrCode } from '../components/Bits.jsx';

/**
 * What to do, in order, for whichever role is reading.
 *
 * The Overview already nags an HOD through an empty department; this is the
 * calmer version that stays useful afterwards and covers everybody else, so a
 * teacher who has forgotten how corrections work has somewhere to look that is
 * not a person.
 */
const STEPS = {
  admin: [
    { what: 'Create the HOD account', why: 'One per department. They build the timetable and enrol the students — you do not.', to: '/accounts' },
    { what: 'Hand the login ID and password over in person', why: 'Nothing is emailed. Read it out, or write it down and give it to them.' },
    { what: 'Ask them to change it from Profile', why: 'The password you chose has been said out loud. Theirs should not be.', to: '/profile' },
    { what: 'Create a second administrator', why: 'If you are the only one and you lose your password, nobody can reset it for you.', to: '/accounts' },
    { what: 'Reset passwords when people are locked out', why: 'Six wrong attempts locks an account for a while. A reset clears it immediately.', to: '/accounts' },
  ],
  hod: [
    { what: 'Add a course', why: 'Everything else hangs off a course.', to: '/setup' },
    { what: 'Add sections and subjects', why: 'Students belong to a section; each period teaches one subject.', to: '/setup' },
    { what: 'Create teacher accounts', why: 'The timetable assigns a teacher to every period.', to: '/setup' },
    { what: 'Allocate a class teacher to each section', why: 'Leave requests route to them. Without one, only you see them.', to: '/setup' },
    { what: 'Set how many periods a day, then fill each section’s timetable', why: 'Pick the course on Schedule, save the day length, and tap add in any period. Nobody can mark attendance until the grid exists.', to: '/schedule' },
    { what: 'Set the minimum attendance percentage', why: 'Without it every course falls back to 75%.', to: '/setup' },
    { what: 'Add students, one at a time or as a CSV', why: 'They can sign in the moment the account exists.', to: '/setup' },
    { what: 'Cancel classes ahead of holidays and events', why: 'One tap on Schedule, or on an event card. Cancelled classes count for nobody, and undo is one more tap.', to: '/schedule?cancel=1' },
    { what: 'Then: decide leave and watch the shortfalls', why: 'Records flags anyone below the minimum before it is too late to fix.', to: '/records' },
  ],
  teacher: [
    { what: 'Open Attendance and mark your register', why: 'Your periods for today are already listed. Mark all present, then tap the absentees.', to: '/attendance' },
    { what: 'Mark everyone before you save', why: 'A held class where a student has no mark counts as missed for them.', to: '/attendance' },
    { what: 'Fix mistakes inside the edit window', why: 'After it closes, the HOD makes the correction and it is recorded against their name.', to: '/attendance' },
    { what: 'Not taking a class? Cancel it', why: 'One tap next to the class on your overview. Your students and the HOD are told, and you can undo it.', to: '/' },
    { what: 'Decide leave for your section', why: 'Approving writes leave across every period of that day for you.', to: '/leave' },
    { what: 'Export a register when someone asks for proof', why: 'Filtered CSV, straight to a share sheet on a phone.', to: '/records' },
  ],
  student: [
    { what: 'Check where you stand', why: 'The ring shows your percentage against the minimum, counted over the classes your section actually held.', to: '/analytics' },
    { what: 'Aim for the 90% badge', why: 'Reach 90% and a badge appears on your overview and profile. Below it, the app tells you how many classes it takes.', to: '/' },
    { what: 'Apply for leave before the day, if you can', why: 'Attach the medical certificate with the request; it never becomes a public link.', to: '/leave' },
    { what: 'Join events that credit attendance', why: 'Each event shows exactly which of your periods it credited, and why any were not.', to: '/events' },
    { what: 'Change the password you were given', why: 'Whoever created your account knows the one you have now.', to: '/profile' },
  ],
  mentor: [
    { what: 'Create your club', why: 'Members are added by login ID, so ask students for theirs.', to: '/clubs' },
    { what: 'Post an event', why: 'Members-only events are visible only to the people you added.', to: '/events' },
    { what: 'Set a credit period when the event replaces a class', why: 'That is what turns an absence into a credited attendance.', to: '/events' },
    { what: 'Add attendance for everyone who took part', why: 'Paste their login IDs, or pick the whole club, and the credit applies at once.', to: '/events' },
  ],
};

const WHO = [
  ['Administrator', 'Creates HODs, teachers and mentors. Resets passwords. Does not teach.'],
  ['HOD', 'Builds the department: courses, sections, subjects, timetable, students. Decides leave and corrects old registers.'],
  ['Teacher', 'Marks attendance for their own periods. Decides leave for the section they are class teacher of.'],
  ['Student', 'Checks their own attendance, applies for leave, joins events.'],
  ['Mentor', 'Runs clubs and posts events that can credit attendance.'],
];

export default function Guide() {
  const { user } = useAuth();
  const steps = STEPS[user.role] || [];
  const intro = `${window.location.origin}/welcome`;

  // Prints only the poster: the rest of the page is hidden by the print stylesheet.
  const printPoster = () => {
    document.body.classList.add('print-poster');
    const done = () => { document.body.classList.remove('print-poster'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1000);
  };

  return (
    <div className="stack">
      <PageHead title="Guide" note="What to do, in the order it has to happen." />

      <div className="panel">
        <header><h3>Your steps</h3></header>
        <div className="body">
          <ul className="checklist">
            {steps.map((step) => (
              <li key={step.what}>
                <span className="mark" aria-hidden="true">{'○'}</span>
                <span className="what">
                  {step.to ? <Link to={step.to}>{step.what}</Link> : step.what}
                  <span className="why">{step.why}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="panel manual-panel">
        <header><h3>User manual</h3></header>
        <div className="body row" style={{ alignItems: 'center' }}>
          <p className="label" style={{ flex: '1 1 18rem', margin: 0 }}>
            The full illustrated guide for every role, from signing in for the first time to cancelling a day of
            classes. Keep it on your phone, or print it for the staff room.
          </p>
          <a className="button" href="/user-manual.pdf" download>Download the manual (PDF)</a>
          <a className="button quiet" href="/user-manual.html" target="_blank" rel="noopener">Read it online</a>
        </div>
      </div>

      <div className="panel qr-share">
        <header>
          <h3>Share the app</h3>
          <button className="quiet" onClick={printPoster}>Print a poster</button>
        </header>
        <div className="body row poster" style={{ alignItems: 'center' }}>
          <QrCode value={intro} size={180} label="QR code for the introduction page" />
          <div style={{ flex: '1 1 16rem' }}>
            <p className="poster-title">Scan to open the attendance app</p>
            <p className="label">
              The code opens an introduction page that anyone can read before they have an account: what the app
              does, how to sign in, and the user manual. Put it on a notice board, a slide or a stall.
            </p>
            <p className="label"><Link to="/welcome">Open the introduction page</Link> · <code>{intro}</code></p>
          </div>
        </div>
      </div>

      <div className="panel">
        <header><h3>Who does what</h3></header>
        <div className="body">
          <table>
            <thead><tr><th>Role</th><th>Responsible for</th></tr></thead>
            <tbody>
              {WHO.map(([role, does]) => (
                <tr key={role}>
                  <td><strong>{role}</strong></td>
                  <td>{does}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <header><h3>Passwords</h3></header>
        <div className="body stack" style={{ gap: '0.5rem' }}>
          <p className="label">
            There is no reset-by-email anywhere in this system, which is deliberate: it would need a mail
            service, and a college hands out credentials in person anyway.
          </p>
          <p className="label">
            If you are locked out, the person who created your account can set a new password. A student
            asks their class teacher or HOD; a teacher, mentor or HOD asks the administrator.
          </p>
          <p className="label">
            Repeated wrong passwords lock an account for a few minutes. A password reset clears the lock.
          </p>
        </div>
      </div>
    </div>
  );
}
