import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { PageHead, Problem } from '../components/Bits.jsx';

export default function Profile() {
  const { user } = useAuth();
  const p = user.profile || {};
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const change = async (e) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    try {
      await api.post('/auth/password', form);
      setForm({ currentPassword: '', newPassword: '' });
      setDone('Password changed.');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHead title="Profile" />
      <div className="grid-2">
        <div className="panel">
          <header><h3>{user.name}</h3></header>
          <div className="body">
            <table>
              <tbody>
                <tr><th>Login ID</th><td>{user.loginId}</td></tr>
                <tr><th>Role</th><td>{user.role}</td></tr>
                <tr><th>Password</th><td>••••••••</td></tr>
                {user.role === 'student' && (
                  <>
                    <tr><th>Roll number</th><td>{p.roll_number}</td></tr>
                    <tr><th>Course</th><td>{p.course_name}</td></tr>
                    <tr><th>Section</th><td>{p.section_name}</td></tr>
                    <tr><th>Class teacher</th><td>{p.class_teacher_name || 'not allocated'}</td></tr>
                  </>
                )}
              </tbody>
            </table>

            {user.role === 'teacher' && (
              <>
                <h3 style={{ margin: '1rem 0 0.5rem' }}>Your classes</h3>
                <ul className="plain">
                  {(p.assignments || []).map((a, i) => (
                    <li key={i}>{a.subject} <span className="label">· {a.course} {a.section}</span></li>
                  ))}
                </ul>
                {(p.class_teacher_of || []).length > 0 && (
                  <p className="label">Class teacher for {(p.class_teacher_of || []).length} section(s).</p>
                )}
              </>
            )}
          </div>
        </div>

        <div className="panel">
          <header><h3>Change password</h3></header>
          <form className="body stack" style={{ gap: '0.75rem' }} onSubmit={change}>
            <label className="field">
              Current password
              <input type="password" required value={form.currentPassword}
                onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} autoComplete="current-password" />
            </label>
            <label className="field">
              New password
              <input type="password" required minLength={8} value={form.newPassword}
                onChange={(e) => setForm({ ...form, newPassword: e.target.value })} autoComplete="new-password" />
            </label>
            {error && <Problem>{error}</Problem>}
            {done && <div className="notice good">{done}</div>}
            <div><button type="submit">Change password</button></div>
          </form>
        </div>
      </div>
    </>
  );
}
