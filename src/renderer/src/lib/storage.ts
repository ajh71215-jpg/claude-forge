// Tiny localStorage JSON helpers (best-effort — never throw). Shared by the shell
// (persisted LIMITS / pins) and the chat-tabs hook (session→workspace map).

/** Read a JSON value from localStorage, falling back to a default on any error. */
export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

/** Persist a JSON value to localStorage (best-effort). */
export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore quota / serialization errors */
  }
}
