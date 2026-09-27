import { useEffect, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { Empty, Loading, PageHead, Problem, Select, when } from '../components/Bits.jsx';

export default function Notifications() {
  const { user } = useAuth();
  const feed = useApi('/notifications');
  const canPost = ['hod', 'teacher', 'mentor'].includes(user.role);
  const [form, setForm] = useState({ title: '', message: '', audience: 'all_students' });
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);

  // Opening the page is the read receipt.
  useEffect(() => { api.post('/notifications/read').catch(() => {}); }, []);

  const post = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.post('/notifications', {
        title: form.title, message: form.message || undefined, audience: form.audience,
      });
      setSent(`Sent to ${res.sent} people.`);
      setForm({ title: '', message: '', audience: form.audience });
      await feed.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHead title="Notifications" />
      <div className="stack">
        {canPost && (
          <div className="panel">
            <header><h3>Post an announcement</h3></header>
            <form className="body stack" style={{ gap: '0.75rem' }} onSubmit={post}>
              <div className="row">
                <label className="field" style={{ flex: 1, minWidth: '14rem' }}>
                  Title<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </label>
                <Select label="Audience" value={form.audience} placeholder="All students"
                  options={[
                    { value: 'all_students', label: 'All students' },
                    { value: 'teachers', label: 'Teachers' },
                    { value: 'mentors', label: 'Mentors' },
                    { value: 'everyone', label: 'Everyone' },
                  ]} onChange={(v) => setForm({ ...form, audience: v })} />
              </div>
              <label className="field">
                Message<textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
              </label>
              {error && <Problem>{error}</Problem>}
              {sent && <div className="notice good">{sent}</div>}
              <div><button type="submit">Send</button></div>
            </form>
          </div>
        )}

        <div className="panel">
          <header><h3>Your notifications</h3></header>
          {feed.loading && <Loading />}
          {!feed.loading && (feed.data || []).length === 0 && <Empty>Nothing yet.</Empty>}
          <ul className="plain feed">
            {(feed.data || []).map((n) => (
              <li key={n.id} className={n.read_at ? '' : 'unread'}>
                <strong>{n.title}</strong>
                {n.message && <div>{n.message}</div>}
                <div className="meta">{when(n.created_at)}{n.posted_by_name ? ` · ${n.posted_by_name}` : ''}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
