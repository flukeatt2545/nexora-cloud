type Window = { count: number; first: number; last: number };

const general = new Map<string, Window>();
const privileged = new Map<string, Window>();

function hit(store: Map<string, Window>, userId: string, perMinute: number, gapMs: number) {
  const now = Date.now();
  const entry = store.get(userId);
  if (!entry || now - entry.first > 60000) {
    store.set(userId, { count: 1, first: now, last: now });
    return { allowed: true, waitSeconds: 0 };
  }
  if (now - entry.last < gapMs) {
    return { allowed: false, waitSeconds: Math.ceil((gapMs - (now - entry.last)) / 1000) };
  }
  if (entry.count >= perMinute) {
    return { allowed: false, waitSeconds: Math.ceil((60000 - (now - entry.first)) / 1000) };
  }
  entry.count += 1;
  entry.last = now;
  return { allowed: true, waitSeconds: 0 };
}

/** Every click: enough to browse mail comfortably, not enough to hammer the API. */
export function checkRateLimit(userId: string) {
  return hit(general, userId, 30, 600);
}

/** Admin changes such as creating, suspending or deleting a mailbox. */
export function checkPrivilegedRateLimit(userId: string) {
  return hit(privileged, userId, 6, 0);
}

setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const store of [general, privileged]) {
    for (const [key, value] of store) {
      if (value.first < cutoff) store.delete(key);
    }
  }
}, 300000).unref();
