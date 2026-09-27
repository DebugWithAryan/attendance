// Test-only entry: mounts the real App under a MemoryRouter so a runner can
// drive it inside jsdom against the live API.
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/auth.jsx';
import App from '../src/App.jsx';

export function mount(el, path) {
  const root = createRoot(el);
  root.render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
  return root;
}
