import { useState } from 'react';
import { qs } from '../api.js';
import { usePolling } from '../hooks.js';
import { Empty, Loading, PageHead, Problem, Select, when } from '../components/Bits.jsx';

const ACTIONS = [
  'attendance.saved', 'attendance.edited', 'attendance.override', 'attendance.credited',
  'attendance.credit_override', 'leave.applied', 'leave.approved', 'leave.rejected',
  'records.exported', 'user.created', 'user.removed', 'allocation.class_teacher',
  'criteria.updated', 'schedule.slot_saved', 'event.created', 'club.created', 'notification.posted',
];

/** HOD-only. One table, every consequential action, newest first. */
export default function Activities() {
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const feed = usePolling(`/activity${qs({ action, from, to, limit: 200 })}`);

  return (
    <>
      <PageHead title="Activities" note="Every attendance edit, override, credit, approval and export." />

      <div className="stack">
        <div className="panel">
          <div className="body row">
            <Select label="Action" value={action} placeholder="Everything"
              options={ACTIONS.map((a) => ({ value: a, label: a }))} onChange={setAction} />
            <label className="field">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="field">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
        </div>

        {feed.loading && <Loading what="Loading the audit trail" />}
        {feed.error && <Problem>{feed.error}</Problem>}
        {!feed.loading && (feed.data || []).length === 0 && <Empty>Nothing recorded for this filter.</Empty>}

        {(feed.data || []).length > 0 && (
          <div className="panel scroll-x">
            <table>
              <thead>
                <tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th><th>Reason</th></tr>
              </thead>
              <tbody>
                {feed.data.map((a) => (
                  <tr key={a.id}>
                    <td>{when(a.created_at)}</td>
                    <td>{a.actor_name || 'system'}<div className="meta">{a.actor_role}</div></td>
                    <td>
                      <span className={`chip ${a.action_type.includes('override') ? 'credit' : 'pending'}`}>{a.action_type}</span>
                    </td>
                    <td>{Object.entries(a.details || {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}</td>
                    <td>{a.reason || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
