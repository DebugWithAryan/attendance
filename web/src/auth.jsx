import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api.get('/auth/me').then(setUser).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    async signIn(loginId, password) {
      const res = await api.post('/auth/login', { loginId, password });
      setToken(res.token);
      setUser(await api.get('/auth/me'));
    },
    // One tap into a shared demo account; only works while the deployment runs DEMO_MODE.
    async signInDemo(loginId) {
      const res = await api.post('/demo/login', { loginId });
      setToken(res.token);
      setUser(await api.get('/auth/me'));
    },
    signOut() {
      setToken(null);
      setUser(null);
    },
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
