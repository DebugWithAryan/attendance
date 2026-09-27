import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { installMockApi } from './mockApi.js';
import { AuthProvider } from '../src/auth.jsx';
import App from '../src/App.jsx';
import '../src/styles.css';

// Stand in for the Node API before anything renders.
installMockApi();

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>,
);
