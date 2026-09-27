import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installMockApi } from './mockApi.js';
import { AuthProvider } from '../src/auth.jsx';
import App from '../src/App.jsx';

installMockApi();

export function mount(el, path) {
  const root = createRoot(el);
  root.render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><App /></AuthProvider>
    </MemoryRouter>,
  );
  return root;
}
