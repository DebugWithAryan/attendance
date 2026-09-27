import { useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { useAuth } from '../auth.jsx';
import { Empty, Loading, PageHead, Problem, Done, when } from '../components/Bits.jsx';

/**
 * Account administration.
 *
 * This is the administrator's whole job: create the HOD who runs a department,
 * hand over the password, and be the person who can put it right when someone
 * is locked out. Everything about a department — courses, sections, timetable,
 * students — is built by the HOD from Setup, not here.
 */
const ROLES = [
  { value: 'admin', label: 'Administrator', hint: 'Creates accounts and resets passwords. Make a second one: if you are the only administrator and you lose your password, nobody can reset it for you.' },
  { value: 'hod', label: 'HOD', hint: 'Runs a department: builds the timetable, enrols students, decides leave.' },
  { value: 'teacher', label: 'Teacher', hint: 'Marks attendance for their own classes.' },
  { value: 'mentor', label: 'Mentor', hint: 'Runs clubs and posts events.' },
];

export default function Accounts() {
  const { user } = useAuth();
  const [role, setRole] = useState('hod');
  const [form, setForm] = useState({ name: '', loginId: '', password: '' });
  const [resetting, setResetting] = useState(null);
  const [problem, setProblem] = useState(null);
  const [done, setDone] = useState(null);
  const list = useApi(`/users?role=${role}`);

  const onDone = async (work, message) => {
    setProblem(null);
    setDone(null);
    try {
      await work();
      setDone(message);
    } catch (err) {
      setProblem(err.message);
    }
  };

  const valid = form.name.trim().length > 1 && form.loginId.trim().length > 2 && form.password.length >= 8;

  const create = () => onDone(async () => {
    await api.post('/users', {
      name: form.name.trim(),
      loginId: form.loginId.trim(),
      password: form.password,
      role,
    });
    setForm({ name: '', loginId: '', password: '' });
    await list.reload();
  }, 'Account created. Give them the login ID and password yourself — nothing is emailed.');

  const remove = (id) => onDone(async () => {
    await api.del(`/users/${id}`);
    await list.reload();
  }, 'Account removed. They can no longer sign in.');

  const chosen = ROLES.find((r) => r.value === role);

  return (
    <div className="stack">
      <PageHead
        title="Accounts"
        note="Create the people who run the college. Passwords are handed over in person, not emailed."
      />

      {problem && <Problem>{problem}</Problem>}
      {done && <Done>{done}</Done>}

      <div className="panel">
        <header>
          <h3>Create an account</h3>
          <div className="row">
            {ROLES.map((r) => (
              <button key={r.value} className={role === r.value ? '' : 'quiet'} onClick={() => setRole(r.value)}>
                {r.label}
              </button>
            ))}
          </div>
        </header>

        <div className="body stack" style={{ gap: '0.75rem' }}>
          <p className="label">{chosen.hint}</p>
          <div className="row">
            <label className="field">
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Dr A. Sharma" />
            </label>
            <label className="field">
              Login ID
              <input value={form.loginId} onChange={(e) => setForm({ ...form, loginId: e.target.value })} placeholder="cse-hod" />
            </label>
            <label className="field">
              Password
              <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="at least 8 characters" />
            </label>
            <button disabled={!valid} onClick={create}>Create account</button>
          </div>
          <p className="label">
            The password is shown as plain text on purpose: you have to be able to read it out or write
            it down. Ask them to change it from Profile once they are in.
          </p>
        </div>
      </div>

      {resetting && (
        <div className="panel">
          <div className="body">
            <div className="notice">
              <p className="label">
                Setting a new password for <strong>{resetting.name}</strong>. There is no reset-by-email in
                this system, so tell them the new password yourself. They are notified that it changed.
              </p>
              <div className="row">
                <label className="field">
                  New password
                  <input type="text" value={resetting.password} autoFocus
                    onChange={(e) => setResetting({ ...resetting, password: e.target.value })}
                    placeholder="at least 8 characters" />
                </label>
                <button disabled={resetting.password.length < 8}
                  onClick={() => onDone(async () => {
                    await api.post(`/users/${resetting.id}/password`, { password: resetting.password });
                    setResetting(null);
                  }, 'Password changed. Tell them what it is.')}>
                  Save password
                </button>
                <button className="quiet" onClick={() => setResetting(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        <header><h3>{chosen.label} accounts</h3></header>
        <div className="body">
          {list.loading && <Loading what="Loading accounts" />}
          {list.error && <Problem>{list.error}</Problem>}
          {!list.loading && !list.error && !(list.data || []).length && (
            <Empty>No {chosen.label} accounts yet.</Empty>
          )}
          {!!(list.data || []).length && (
            <table>
              <thead>
                <tr><th>Name</th><th>Login ID</th><th>Added</th><th /></tr>
              </thead>
              <tbody>
                {list.data.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}{u.id === user.id && <span className="label"> (you)</span>}</td>
                    <td>{u.login_id}</td>
                    <td>{when(u.created_at)}</td>
                    <td className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="quiet" onClick={() => setResetting({ id: u.id, name: u.name, password: '' })}>
                        Reset password
                      </button>
                      {u.id !== user.id && (
                        <button className="quiet" onClick={() => remove(u.id)}>Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
