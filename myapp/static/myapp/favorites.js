// Saved lines (Task 6): keeps the signed-in user's favorites in sync with /api/favorites/.

import { getIdToken } from "./auth.js";

const FAVORITES_URL = "/api/favorites/";
const ROUTE_KIND = "route";

const favoriteIds = new Map(); // route -> favorite id on the server
const pending = new Set(); // routes with a save/remove in flight
const listeners = new Set();
let generation = 0;
let stationFavorites = [];

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
  const current = generation;
  const token = await getIdToken();
  if (current !== generation) throw new Error("Account changed. Please try again.");
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
  const current = ++generation;
  stationFavorites = [];
  pending.clear();
  favoriteIds.clear();
  notify();
  if (signedIn) {
    const data = await api(FAVORITES_URL);
    if (current !== generation) return;
    stationFavorites = data.favorites.filter((f) => f.kind === "station");
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
  const current = generation;
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
      if (current === generation) favoriteIds.set(route, data.favorite.id);
    }
  } catch (err) {
    if (current !== generation) return;
    if (wasSaved) favoriteIds.set(route, oldId);
    else favoriteIds.delete(route);
    throw err;
  } finally {
    if (current === generation) { pending.delete(route); notify(); }
  }
}

export function savedStations() { return stationFavorites; }
export function isStationSaved(id) { return stationFavorites.some((f) => f.station_id === id); }
export function stationPending(id) { return pending.has(`station-${id}`); }
export async function toggleStation(id, legacyId = null) {
  const key = `station-${id || legacyId}`;
  if (pending.has(key)) return;
  const current = generation;
  const existing = stationFavorites.find((f) => legacyId ? f.id === legacyId : f.station_id === id);
  pending.add(key);
  notify();
  try {
    if (existing) {
      await api(`${FAVORITES_URL}${existing.id}/`, { method: "DELETE" });
      if (current === generation) stationFavorites = stationFavorites.filter((f) => f.id !== existing.id);
    } else {
      const data = await api(FAVORITES_URL, {method: "POST", body: JSON.stringify({kind: "station", station_id: id})});
      if (current === generation) stationFavorites.push(data.favorite);
    }
  } finally {
    if (current === generation) { pending.delete(key); notify(); }
  }
}
