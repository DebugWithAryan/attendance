import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/** Small data hook: one request, one loading flag, one readable error, refetch. */
export function useApi(path, { skip = false } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!skip);

  const reload = useCallback(() => {
    if (skip || !path) return undefined;
    setLoading(true);
    return api.get(path)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [path, skip]);

  useEffect(() => { reload(); }, [reload]);

  return { data, error, loading, reload, setData };
}

/**
 * Notification and activity feeds refresh on a timer — no websocket to operate,
 * and no serverless function burning invocations while nobody is looking:
 * polling stops when the tab is hidden and catches up on return. A phone left
 * open on a desk all day costs nothing.
 */
export function usePolling(path, ms = 120_000) {
  const state = useApi(path);
  const { reload } = state;

  useEffect(() => {
    let id;
    const start = () => { id = setInterval(reload, ms); };
    const stop = () => clearInterval(id);

    const onVisibility = () => {
      stop();
      if (document.visibilityState === 'visible') { reload(); start(); }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [reload, ms]);

  return state;
}
