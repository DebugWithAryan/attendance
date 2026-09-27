import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function Login() {
  // Undefined until the check answers: a failed check must fall back to the
  // ordinary sign-in form, never to the setup form.
  const [firstRun, setFirstRun] = useState(undefined);

  useEffect(() => {
    api.get('/bootstrap')
      .then((r) => setFirstRun(!!r?.needed))
      .catch(() => setFirstRun(false));
  }, []);

  return (
    <div className="login">
      <div className="panel">
        <div className="bar" />
        <div className="body">
          {firstRun ? <FirstRun onDone={() => setFirstRun(false)} /> : <SignIn />}
        </div>
      </div>
    </div>
  );
}

function SignIn() {
  const { signIn } = useAuth();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(loginId.trim(), password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Attendance</h1>
      <p className="label" style={{ marginBottom: 'var(--s-5)' }}>
        Sign in with the login ID your department gave you. Forgotten it? Your class teacher
        or the HOD can set a new password.
      </p>
      <form onSubmit={submit} className="stack" style={{ gap: '0.875rem' }}>
        <label className="field">
          Login ID
          <input value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label className="field">
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <div className="notice bad" role="alert">{error}</div>}
        <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </>
  );
}

/**
 * The first screen a brand new deployment shows.
 *
 * Without this, the only way to create the first account is a shell with the
 * production connection string. The server allows it exactly while the users
 * table is empty, so this form stops existing the moment it is used.
 */
function FirstRun({ onDone }) {
  const { signIn } = useAuth();
  const [form, setForm] = useState({ name: '', loginId: '', password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;
  const valid = form.name.trim().length > 1 && form.loginId.trim().length > 2
    && form.password.length >= 8 && form.confirm === form.password;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/bootstrap', {
        name: form.name.trim(),
        loginId: form.loginId.trim(),
        password: form.password,
      });
      await signIn(form.loginId.trim(), form.password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
      // Someone else finished the setup while this form was open.
      if (err.status === 403) onDone();
    }
  };

  return (
    <>
      <h1>Set up this college</h1>
      <p className="label" style={{ marginBottom: 'var(--s-5)' }}>
        Nobody has an account yet, so this is the one time an account can be made without signing in.
        Create the administrator: from here on, every other account is created inside the app.
      </p>
      <form onSubmit={submit} className="stack" style={{ gap: '0.875rem' }}>
        <label className="field">
          Your name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="College Administrator" autoFocus required />
        </label>
        <label className="field">
          Login ID
          <input value={form.loginId} onChange={(e) => setForm({ ...form, loginId: e.target.value })}
            placeholder="admin" autoComplete="username" required />
        </label>
        <label className="field">
          Password
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="at least 8 characters" autoComplete="new-password" required />
        </label>
        <label className="field">
          Confirm password
          <input type="password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            autoComplete="new-password" required />
        </label>
        {mismatch && <div className="notice bad" role="alert">Those two passwords are not the same.</div>}
        {error && <div className="notice bad" role="alert">{error}</div>}
        <button type="submit" disabled={!valid || busy}>
          {busy ? 'Creating…' : 'Create administrator'}
        </button>
      </form>
    </>
  );
}
