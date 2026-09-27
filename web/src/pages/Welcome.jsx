import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { QrCode } from '../components/Bits.jsx';
import { DemoAccounts } from '../components/Demo.jsx';

/**
 * The introduction page: where the QR code on a poster, a slide or a stall
 * lands. It is public, so someone who has never heard of the app can find out
 * what it is before anyone gives them a login ID.
 */
const FEATURES = [
  {
    title: 'A register in a few taps',
    body: 'The teacher picks the class, taps the absentees and saves. Everyone else is already marked present.',
  },
  {
    title: 'Measured against classes held',
    body: 'Attendance counts every class the college actually held, so a missed mark cannot flatter a percentage.',
  },
  {
    title: 'Know where you stand',
    body: 'Students see their percentage, how many classes it takes to reach the minimum, and a badge at 90%.',
  },
  {
    title: 'Timetable, and one-tap cancellations',
    body: 'The HOD builds each section’s week. A holiday or a fest cancels classes in one tap, with undo.',
  },
  {
    title: 'Events that count',
    body: 'A club event during a class can credit that period, and the student can see exactly which ones were.',
  },
  {
    title: 'Every change on the record',
    body: 'Corrections, leave decisions, credits and exports are written to an audit trail the HOD can read.',
  },
];

const ROLES = [
  ['Student', 'Checks attendance, applies for leave with a certificate, joins events.'],
  ['Teacher', 'Marks their own classes, corrects mistakes within 48 hours, decides leave for their section.'],
  ['HOD', 'Builds courses and timetables, adds students, cancels classes, reads every record.'],
  ['Mentor', 'Runs clubs and posts events that credit class attendance.'],
  ['Administrator', 'Creates the accounts that run the college and resets passwords.'],
];

export default function Welcome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const here = typeof window === 'undefined' ? '/welcome' : `${window.location.origin}/welcome`;

  return (
    <div className="welcome">
      <header className="welcome-hero">
        <div className="bar" aria-hidden="true" />
        <div className="welcome-inner">
          <p className="welcome-brand">Attendance</p>
          <h1>The college attendance register, on every phone.</h1>
          <p className="lede">
            Teachers mark a class in seconds. Students see exactly where they stand. The head of department sees
            everything, with an audit trail behind every change.
          </p>
          <div className="row">
            <Link className="button" to="/">{user ? 'Open the app' : 'Sign in'}</Link>
            <a className="button quiet" href="/user-manual.pdf" download>Download the user manual (PDF)</a>
            <a href="/user-manual.html">Read the manual online</a>
          </div>
        </div>
      </header>

      <main className="welcome-inner stack">
        {!user && <DemoAccounts onSignedIn={() => navigate('/')} />}

        <section aria-labelledby="what-heading">
          <h2 id="what-heading">What it does</h2>
          <div className="feature-grid">
            {FEATURES.map((f) => (
              <div className="panel feature" key={f.title}>
                <div className="body">
                  <h3>{f.title}</h3>
                  <p className="label">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="who-heading">
          <h2 id="who-heading">Who uses it</h2>
          <div className="panel">
            <table>
              <tbody>
                {ROLES.map(([role, does]) => (
                  <tr key={role}><td><strong>{role}</strong></td><td>{does}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="start-heading">
          <h2 id="start-heading">Getting started</h2>
          <ol className="steps">
            <li><strong>Get your login ID.</strong> Your department creates your account and gives you a login ID and a first password in person.</li>
            <li><strong>Sign in</strong> on this site. It works in any phone browser; add it to your home screen to open it like an app.</li>
            <li><strong>Change your password</strong> from Profile, because whoever created your account knows the first one.</li>
            <li><strong>Read the guide for your role</strong> under Guide, or download the user manual above.</li>
          </ol>
        </section>

        <section className="panel welcome-share" aria-labelledby="share-heading">
          <div className="body row" style={{ alignItems: 'center' }}>
            <QrCode value={here} size={148} label="QR code for this introduction page" />
            <div style={{ flex: '1 1 16rem' }}>
              <h2 id="share-heading">Pass it on</h2>
              <p className="label">
                Scan this code with a phone camera to open this page. Staff can print it as a poster from the Guide page.
              </p>
              <p className="label"><code>{here}</code></p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
