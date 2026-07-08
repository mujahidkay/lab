// Tiny API client shared in spirit by both apps: token in localStorage, bearer
// on every request, SSE subscription that re-fires on any lab change.

const TKEY = 'lab_token';
export const getToken = () => localStorage.getItem(TKEY) || '';
export const setToken = (t: string) => localStorage.setItem(TKEY, t.trim());
export const clearToken = () => localStorage.removeItem(TKEY);

export class AuthError extends Error {}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${getToken()}`,
      ...(init?.headers || {}),
    },
  });
  if (res.status === 401) throw new AuthError('unauthorized');
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error((msg as { error?: string }).error || res.statusText);
  }
  return (await res.json()) as T;
}

/** Subscribe to server-sent change events. Returns an unsubscribe fn. */
export function subscribe(onChange: () => void): () => void {
  let es: EventSource | null = null;
  try {
    es = new EventSource(`/api/events?token=${encodeURIComponent(getToken())}`);
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === 'change') onChange();
      } catch { /* ignore keepalive */ }
    };
    es.onerror = () => { /* browser auto-reconnects */ };
  } catch { /* EventSource unavailable */ }
  return () => es?.close();
}
