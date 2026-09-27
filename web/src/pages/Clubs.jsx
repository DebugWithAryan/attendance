import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { Empty, Loading, PageHead, Problem } from '../components/Bits.jsx';

export default function Clubs() {
  const { user } = useAuth();
  const clubs = useApi('/clubs');
  const [name, setName] = useState('');
  const [logins, setLogins] = useState({});
  const [error, setError] = useState(null);
  const isMentor = user.role === 'mentor';

  const act = async (fn) => {
    setError(null);
    try {
      await fn();
      await clubs.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHead title="Clubs" note={isMentor ? 'Add members by login ID.' : 'Every club in the department, with its mentor and members.'} />

      <div className="stack">
        {error && <Problem>{error}</Problem>}

        {isMentor && (
          <div className="panel">
            <header><h3>Create a club</h3></header>
            <div className="body row">
              <label className="field" style={{ flex: 1, minWidth: '14rem' }}>
                Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Robotics Club" />
              </label>
              <button disabled={name.trim().length < 2}
                onClick={() => act(async () => { await api.post('/clubs', { name: name.trim() }); setName(''); })}>
                Create
              </button>
            </div>
          </div>
        )}

        {clubs.loading && <Loading what="Loading clubs" />}
        {!clubs.loading && (clubs.data || []).length === 0 && <Empty>No clubs yet.</Empty>}

        {(clubs.data || []).map((c) => (
          <div className="panel" key={c.id}>
            <header>
              <h3>{c.name}</h3>
              <span className="label">Mentor: {c.mentor_name} ({c.mentor_login_id})</span>
              <span className="chip pending">{c.members.length} members</span>
            </header>

            {c.members.length === 0
              ? <Empty>No members yet.</Empty>
              : (
                <div className="scroll-x">
                  <table>
                    <thead><tr><th>Roll</th><th>Name</th><th>Login ID</th>{isMentor && <th />}</tr></thead>
                    <tbody>
                      {c.members.map((m) => (
                        <tr key={m.student_id}>
                          <td>{m.roll_number}</td>
                          <td>{m.name}</td>
                          <td>{m.login_id}</td>
                          {isMentor && (
                            <td className="num">
                              <button className="link" onClick={() => act(() => api.del(`/clubs/${c.id}/members/${m.student_id}`))}>remove</button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

            {isMentor && (
              <div className="body row">
                <label className="field">
                  Student login ID
                  <input value={logins[c.id] || ''} onChange={(e) => setLogins({ ...logins, [c.id]: e.target.value })} placeholder="cse-a4" />
                </label>
                <button className="quiet" disabled={!(logins[c.id] || '').trim()}
                  onClick={() => act(async () => {
                    await api.post(`/clubs/${c.id}/members`, { loginId: logins[c.id].trim() });
                    setLogins({ ...logins, [c.id]: '' });
                  })}>
                  Add member
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
