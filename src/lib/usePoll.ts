"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Fetch a JSON endpoint and keep it fresh on an interval. Pauses while the tab is hidden. */
export function usePoll<T>(url: string | null, ms = 5000) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  /** when the last successful response arrived */
  const [updatedAt, setUpdatedAt] = useState<number | undefined>();
  const urlRef = useRef(url);

  const load = useCallback(async () => {
    const u = urlRef.current;
    if (!u) return;
    try {
      const res = await fetch(u, { cache: "no-store" });
      const json = await res.json();
      if (urlRef.current !== u) return; // url changed mid-flight
      if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
      setData(json);
      setUpdatedAt(Date.now());
      setError(undefined);
    } catch (e) {
      if (urlRef.current === u) setError(e instanceof Error ? e.message : "Request failed");
    }
  }, []);

  useEffect(() => {
    urlRef.current = url;
    load(); // previous data stays on screen until the new url resolves
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, ms);
    return () => clearInterval(id);
  }, [url, ms, load]);

  return { data, error, reload: load, updatedAt };
}
