type Window = { count: number; first: number; last: number };

const general = new Map<string, Window>();

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

/** Every click or command. Wrong passwords are limited again by the API, per room. */
export function checkRateLimit(userId: string) {
  return hit(general, userId, 20, 800);
}

setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [key, value] of general) {
    if (value.first < cutoff) general.delete(key);
  }
}, 60000).unref();
