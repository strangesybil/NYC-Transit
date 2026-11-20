// Saved lines (Task 6): keeps the signed-in user's favorites in sync with /api/favorites/.

import { getIdToken } from "./auth.js";

const FAVORITES_URL = "/api/favorites/";
const ROUTE_KIND = "route";

const favoriteIds = new Map(); // route -> favorite id on the server
const pending = new Set(); // routes with a save/remove in flight
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn());
}

/** Call fn() whenever the saved lines change. */
export function onFavoritesChange(fn) {
  listeners.add(fn);
}

export function isFavorite(route) {
  return favoriteIds.has(route);
}

export function isPending(route) {
  return pending.has(route);
}

/** Saved lines, in the order they were saved. */
export function favoriteRoutes() {
  return [...favoriteIds.keys()];
}

async function api(path, options = {}) {
  const token = await getIdToken();
  if (!token) throw new Error("Sign in to save lines.");
  const res = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
  return data;
}

/** Load the signed-in user's favorites (or clear them when signed out). */
export async function loadFavorites(signedIn) {
  favoriteIds.clear();
  if (signedIn) {
    const data = await api(FAVORITES_URL);
    data.favorites
      .filter((f) => f.kind === ROUTE_KIND)
      .forEach((f) => favoriteIds.set(f.name, f.id));
  }
  notify();
}

/**
 * Save or un-save a line. The star flips right away; if the server says no,
 * it flips back and the error is thrown so the caller can show it.
 */
export async function toggleFavorite(route) {
  if (pending.has(route)) return;
  const wasSaved = favoriteIds.has(route);
  const oldId = favoriteIds.get(route);
  pending.add(route);
  if (wasSaved) favoriteIds.delete(route);
  else favoriteIds.set(route, null); // id arrives from the server below
  notify();

  try {
    if (wasSaved) {
      await api(`${FAVORITES_URL}${oldId}/`, { method: "DELETE" });
    } else {
      const data = await api(FAVORITES_URL, {
        method: "POST",
        body: JSON.stringify({ kind: ROUTE_KIND, name: route }),
      });
      favoriteIds.set(route, data.favorite.id);
    }
  } catch (err) {
    if (wasSaved) favoriteIds.set(route, oldId);
    else favoriteIds.delete(route);
    throw err;
  } finally {
    pending.delete(route);
    notify();
  }
}
