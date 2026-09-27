import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { Problem } from './Bits.jsx';

/**
 * One-tap demo sign-in, shown only when the deployment runs DEMO_MODE and
 * `npm run seed:demo` has created the accounts. Each button signs the visitor
 * into a real role in a sample college, so a tech fest crowd can try the app
 * without anyone typing a password on a stranger's phone.
 */
export function DemoAccounts({ onSignedIn, heading = 'Try it with a demo account' }) {
  const { signInDemo } = useAuth();
  const demo = useApi('/demo');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  if (!demo.data?.enabled || !demo.data.accounts?.length) return null;

  const go = async (loginId) => {
    setBusy(loginId);
    setError(null);
    try {
      await signInDemo(loginId);
      onSignedIn?.();
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  };

  return (
    <section className="demo-panel" aria-labelledby="demo-heading">
      <h2 id="demo-heading">{heading}</h2>
      <p className="label">
        No sign-up. Each button opens a sample college as that person. To type it in instead, the password for
        every demo account is <code>{demo.data.password}</code>.
      </p>
      <div className="demo-grid">
        {demo.data.accounts.map((a) => (
          <button key={a.loginId} type="button" className="demo-account" onClick={() => go(a.loginId)}
            disabled={!!busy} aria-label={`Try the demo as ${a.label}: ${a.name}`}>
            <strong>{busy === a.loginId ? 'Opening…' : a.label}</strong>
            <span className="who">{a.name} <code>{a.loginId}</code></span>
            <span className="blurb">{a.blurb}</span>
          </button>
        ))}
      </div>
      {error && <Problem>{error}</Problem>}
    </section>
  );
}
