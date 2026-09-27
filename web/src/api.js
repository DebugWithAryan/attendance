/**
 * One fetch wrapper for the whole app: attaches the token, unwraps errors into
 * Error instances carrying the server's readable message, and handles the CSV
 * download as a blob rather than JSON.
 */
const TOKEN_KEY = 'attendance.token';

export const getToken = () => sessionStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY));

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && path !== '/auth/login') {
    setToken(null);
    window.location.reload();
    return null;
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const error = new Error(data?.message || 'That did not work. Try again.');
    error.details = data?.details;
    error.status = res.status;
    throw error;
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),

  /**
   * Reads a file into a data URL so it can travel inside ordinary JSON. The
   * certificate goes with the leave request itself — one call, nothing left
   * orphaned in storage if the request is never submitted.
   */
  async readFile(file) {
    if (file.size > 2 * 1024 * 1024) {
      throw new Error('Certificates must be under 2 MB. Take the photo again at a lower resolution.');
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('That file could not be read.'));
      reader.readAsDataURL(file);
    });
  },

  /**
   * Opens a medical certificate. The server checks who is asking and logs the
   * view, so this cannot be a plain link — the bytes come back over an
   * authorised request and are shown from a temporary object URL.
   */
  async openDocument(path) {
    const res = await fetch(`/api${path}`, { headers: { authorization: `Bearer ${getToken()}` } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || 'That certificate could not be opened.');
    }
    const url = URL.createObjectURL(await res.blob());
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },

  /** Triggers a real file download from the export endpoint. */
  async download(path) {
    const res = await fetch(`/api${path}`, { headers: { authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error('Export failed.');
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'export.csv';
    const rows = Number(res.headers.get('x-row-count') || 0);

    // On a phone, the share sheet is how this reaches WhatsApp or email. On a
    // desktop it falls through to an ordinary download.
    const file = new File([blob], name, { type: 'text/csv' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return { name, rows, shared: true };
      } catch (err) {
        if (err.name === 'AbortError') return { name, rows, shared: false, cancelled: true };
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return { name, rows, shared: false };
  },
};

export const qs = (params) => {
  const usable = Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined);
  return usable.length ? `?${new URLSearchParams(usable)}` : '';
};
