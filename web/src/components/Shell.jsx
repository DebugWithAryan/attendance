import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { navFor } from '../nav.js';
import { usePolling } from '../hooks.js';

const ROLE_LABEL = {
  admin: 'Administrator', hod: 'Head of department', teacher: 'Teacher', student: 'Student', mentor: 'Mentor',
};

export default function Shell({ children }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { data: notifications } = usePolling('/notifications', 120_000);
  const unread = (notifications || []).filter((n) => !n.read_at).length;

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>

      <aside className="rail">
        <div className="brand">
          <strong>Attendance</strong>
          <span>{ROLE_LABEL[user.role]}</span>
        </div>

        <nav aria-label="Sections">
          {navFor(user.role).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>
              {item.label}
              {item.to === '/notifications' && unread > 0 && (
                <span className="count" aria-label={`${unread} unread`}>{unread}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="who">
          <strong>{user.name}</strong>
          {user.loginId}
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <span className="label">{user.name} · {ROLE_LABEL[user.role]}</span>
          <span className="spacer" />
          <button
            className="quiet"
            onClick={() => {
              // Reset the route too, so the next person on a shared machine
              // lands on their own overview rather than this page.
              navigate('/', { replace: true });
              signOut();
            }}
          >
            Sign out
          </button>
        </div>

        {user.isDemo && (
          <div className="demo-banner" role="note">
            <span>
              <strong>Demo account.</strong> This is a sample college for trying the app; anything you change is
              seen by the next visitor too.
            </span>
            <button className="link" onClick={() => { navigate('/', { replace: true }); signOut(); }}>
              Try another role
            </button>
          </div>
        )}
        <main className="content" id="main">{children}</main>
      </div>
    </div>
  );
}
