import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Shell from './components/Shell.jsx';
import { Loading } from './components/Bits.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Attendance from './pages/Attendance.jsx';
import Records from './pages/Records.jsx';
import Analytics from './pages/Analytics.jsx';
import Schedule from './pages/Schedule.jsx';
import Leave from './pages/Leave.jsx';
import Events from './pages/Events.jsx';
import Clubs from './pages/Clubs.jsx';
import Notifications from './pages/Notifications.jsx';
import Setup from './pages/Setup.jsx';
import Accounts from './pages/Accounts.jsx';
import Guide from './pages/Guide.jsx';
import Activities from './pages/Activities.jsx';
import Profile from './pages/Profile.jsx';
import Welcome from './pages/Welcome.jsx';
import { navFor } from './nav.js';

/** Routes the current role cannot reach fall back to Overview. */
function Guarded({ path, children }) {
  const { user } = useAuth();
  const allowed = navFor(user.role).some((item) => item.to === path);
  return allowed ? children : <Navigate to="/" replace />;
}

export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // The introduction page is public: it is where the QR code on a poster lands,
  // for people who do not have an account yet.
  if (location.pathname === '/welcome') return <Welcome />;
  if (loading) return <Loading what="Signing you in" />;
  if (!user) return <Login />;

  const page = (path, element) => <Guarded path={path}>{element}</Guarded>;

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/attendance" element={page('/attendance', <Attendance />)} />
        <Route path="/records" element={page('/records', <Records />)} />
        <Route path="/analytics" element={page('/analytics', <Analytics />)} />
        <Route path="/schedule" element={page('/schedule', <Schedule />)} />
        <Route path="/leave" element={page('/leave', <Leave />)} />
        <Route path="/events" element={page('/events', <Events />)} />
        <Route path="/clubs" element={page('/clubs', <Clubs />)} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/setup" element={page('/setup', <Setup />)} />
        <Route path="/accounts" element={page('/accounts', <Accounts />)} />
        <Route path="/guide" element={<Guide />} />
        <Route path="/activities" element={page('/activities', <Activities />)} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
