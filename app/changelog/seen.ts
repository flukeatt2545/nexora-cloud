"use client";

import { useSyncExternalStore } from "react";
import { RELEASES, type Release } from "./entries";

// Which release this browser has already looked at, so the menus can point at a newer one.
const SEEN_KEY = "nexora-changelog-seen";
const SEEN_EVENT = "nexora:changelog-seen";

/** Newest first: 1.10.0 above 1.9.0. */
export function compareVersions(a: string, b: string) {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pb[i] || 0) - (pa[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

export const SORTED_RELEASES: Release[] = [...RELEASES].sort((a, b) => compareVersions(a.version, b.version));
export const LATEST_RELEASE: Release | undefined = SORTED_RELEASES[0];

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(SEEN_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SEEN_EVENT, onChange);
  };
}

function hasUnseen() {
  if (!LATEST_RELEASE) return false;
  try {
    const seen = window.localStorage.getItem(SEEN_KEY);
    return !seen || compareVersions(LATEST_RELEASE.version, seen) < 0;
  } catch {
    return false;
  }
}

/** True when there is a release this browser hasn't opened /changelog for. False on the server. */
export function useChangelogUnseen() {
  return useSyncExternalStore(subscribe, hasUnseen, () => false);
}

export function markChangelogSeen() {
  if (!LATEST_RELEASE) return;
  try {
    window.localStorage.setItem(SEEN_KEY, LATEST_RELEASE.version);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(SEEN_EVENT));
}
