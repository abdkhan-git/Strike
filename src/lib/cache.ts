type Entry<T> = { at: number; value?: T; pending?: Promise<T> };

const store = new Map<string, Entry<unknown>>();

/**
 * Returns a value no older than `ttl` ms. Concurrent callers share one load, so a slow
 * request is never started twice. With `stale`, an expired value is returned immediately
 * while it refreshes in the background; a failed refresh keeps the old value.
 */
export function cached<T>(key: string, ttl: number, load: () => Promise<T>, opts?: { stale?: boolean }): Promise<T> {
  const entry = (store.get(key) as Entry<T> | undefined) ?? { at: 0 };
  const has = entry.value !== undefined;
  if (has && Date.now() - entry.at < ttl) return Promise.resolve(entry.value as T);

  if (!entry.pending) {
    entry.pending = load()
      .then((v) => {
        entry.value = v;
        entry.at = Date.now();
        return v;
      })
      .finally(() => {
        entry.pending = undefined;
      });
    store.set(key, entry);
  }

  if (opts?.stale && has) {
    entry.pending.catch(() => {});
    return Promise.resolve(entry.value as T);
  }
  return entry.pending;
}

