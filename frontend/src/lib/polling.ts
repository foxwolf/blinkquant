'use client';

import { useEffect, useRef } from 'react';

interface PollSubscription {
  fn: () => void | Promise<void>;
  interval: number;
  timer: ReturnType<typeof setInterval> | null;
}

const subscriptions = new Set<PollSubscription>();
let listening = false;

function start(sub: PollSubscription) {
  if (sub.timer !== null) return;
  sub.timer = setInterval(() => { void sub.fn(); }, sub.interval);
}

function stop(sub: PollSubscription) {
  if (sub.timer === null) return;
  clearInterval(sub.timer);
  sub.timer = null;
}

function syncVisibility() {
  if (typeof document === 'undefined') return;
  if (document.hidden) {
    subscriptions.forEach(stop);
  } else {
    subscriptions.forEach((sub) => { void sub.fn(); start(sub); });
  }
}

function ensureListener() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('visibilitychange', syncVisibility);
}

export function subscribePolling(fn: () => void | Promise<void>, interval: number): () => void {
  ensureListener();
  const sub: PollSubscription = { fn, interval, timer: null };
  subscriptions.add(sub);
  if (!document.hidden) start(sub);
  return () => {
    stop(sub);
    subscriptions.delete(sub);
  };
}

export function usePolling(
  fn: () => void | Promise<void>,
  interval: number,
  options?: { enabled?: boolean },
) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const enabled = options?.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    return subscribePolling(() => fnRef.current(), interval);
  }, [enabled, interval]);
}
