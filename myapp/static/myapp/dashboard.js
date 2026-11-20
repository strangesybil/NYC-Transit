// NYC Transit Hub dashboard.
//   /api/status/      one status per line        -> headline + line grid
//   /api/alerts/      the MTA's service alerts   -> "What's wrong right now" + details
//   /api/elevators/   broken elevators/escalators -> details + accessibility badges
// Sign-in is in auth.js, saved lines in favorites.js.

import { signIn, signOut, startAuth } from "./auth.js";
import { favoriteRoutes, isFavorite, isPending, loadFavorites, onFavoritesChange, toggleFavorite } from "./favorites.js";

const STATUS_URL = "/api/status/";
const ALERTS_URL = "/api/alerts/";
const ELEVATORS_URL = "/api/elevators/";
const REFRESH_MS = 60 * 1000; // the server only re-checks the MTA once a minute anyway
const TOAST_MS = 5000;
const GOOD_SERVICE = "Good Service";
const ISSUES_ONLY_KEY = "nyc-transit-issues-only";
const NOTIFY_KEY = "nyc-transit-notify";
const MOBILE_QUERY = "(max-width: 900px)";
const MAX_HEADLINE_BULLETS = 6; // more than this and the headline just gives a count
const OUTAGES_SHOWN = 4; // the rest fold under "Show N more"

// Official MTA line colors.
const LINE_COLORS = {
  1: "#EE352E", 2: "#EE352E", 3: "#EE352E",
  4: "#00933C", 5: "#00933C", 6: "#00933C",
  7: "#B933AD",
  A: "#0039A6", C: "#0039A6", E: "#0039A6",
  B: "#FF6319", D: "#FF6319", F: "#FF6319", M: "#FF6319",
  G: "#6CBE45",
  J: "#996633", Z: "#996633",
  L: "#A7A9AC",
  N: "#FCCC0A", Q: "#FCCC0A", R: "#FCCC0A", W: "#FCCC0A",
  GS: "#808183", FS: "#808183", H: "#808183",
  SI: "#0039A6",
};
const DARK_TEXT_LINES = ["N", "Q", "R", "W"]; // yellow bullets need black letters
const DISPLAY_NAMES = { GS: "S", FS: "S", H: "S", SI: "SIR" }; // the feed's ids vs what riders call them
const LINE_NAMES = { GS: "42 St Shuttle", FS: "Franklin Av Shuttle", H: "Rockaway Park Shuttle", SI: "Staten Island Railway" };

const $ = (id) => document.getElementById(id);
const els = {
  headline: $("headline"), updated: $("updated"), refresh: $("refresh"), warning: $("warning"),
  mine: $("mine"), mineList: $("mine-list"), notify: $("notify"),
  problems: $("problems"), problemList: $("problem-list"),
  tiles: $("tiles"), issuesOnly: $("issues-only"), details: $("details"), toast: $("toast"),
  account: $("account"), signInBtn: $("sign-in"), me: $("me"), meName: $("me-name"),
  meAvatar: $("me-avatar"), signOutBtn: $("sign-out"),
};

let statuses = {}; // { A: { status: "Delays", alerts: 1, upcoming: 2 }, ... }
let activeAlerts = []; // alerts happening right now, all lines
let outages = []; // elevator/escalator outages, all lines
let selected = null; // { route, alerts } for the details panel
let authOn = false;
let user = null;
let saveAfterSignIn = null; // line the rider tried to save while signed out
let lastStatuses = null; // to notice when a saved line changes
let toastTimer = null;

// ---------- small helpers ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // textContent: feed text can't inject HTML
  return node;
}

const shortName = (route) => DISPLAY_NAMES[route] || route;
const longName = (route) => LINE_NAMES[route] || `${route} line`;
const statusOf = (route) => statuses[route] || { status: GOOD_SERVICE, alerts: 0, upcoming: 0 };

function severity(status) {
  if (status === GOOD_SERVICE) return "good";
  return status.startsWith("Planned") ? "planned" : "bad";
}

// "Planned - Part Suspended" -> "Planned work", "Good Service" -> "Good service", "Delays" -> "Delays"
function statusWord(status) {
  if (severity(status) === "planned") return "Planned work";
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function bullet(route, size = "") {
  const b = el("span", `bullet ${size}`.trim(), shortName(route));
  b.style.setProperty("--line", LINE_COLORS[route] || "#808183");
  if (DARK_TEXT_LINES.includes(route)) b.classList.add("dark-text");
  if (shortName(route).length > 1) b.classList.add("wide");
  b.setAttribute("aria-label", longName(route));
  return b;
}

function elevatorsOut(route) {
  return outages.filter((o) => !o.upcoming && o.type === "Elevator" && o.lines.includes(route)).length;
}

function when(iso, withWeekday = true) {
  if (!iso) return null;
  return new Date(iso).toLocaleString([], {
    ...(withWeekday ? { weekday: "short" } : {}), month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function toast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), TOAST_MS);
}

// Re-rendering swaps out buttons; put keyboard focus back where it was.
function keepFocus(render) {
  const key = document.activeElement && document.activeElement.dataset.key;
  render();
  if (key) document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus();
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`server returned ${res.status}`);
  return res.json();
}

// ---------- headline: the whole subway in one sentence ----------

function renderHeadline() {
  const routes = Object.keys(statuses);
  if (!routes.length) return;
  const problems = new Map(); // "Delays" -> ["A", "C"]
  const planned = [];
  routes.forEach((r) => {
    const s = statuses[r].status;
    if (severity(s) === "bad") problems.set(s, [...(problems.get(s) || []), r]);
    if (severity(s) === "planned") planned.push(r);
  });

  const clause = (text, lines, kind) => {
    const span = el("span", `clause ${kind}`, `${text} `);
    if (lines.length > MAX_HEADLINE_BULLETS) span.append(`${lines.length} lines`);
    else lines.forEach((r) => span.append(bullet(r, "inline")));
    span.append(". ");
    return span;
  };
  const parts = [];
  problems.forEach((lines, status) => parts.push(clause(`${statusWord(status)} on`, lines, "bad")));
  if (planned.length) parts.push(clause("Planned work on", planned, "planned"));
  const good = routes.length - planned.length - [...problems.values()].flat().length;
  if (!parts.length) parts.push(el("span", "clause good", "Good service on every line."));
  else if (good) parts.push(el("span", "clause good", "Good service on the rest."));
  els.headline.replaceChildren(...parts);
}

// ---------- your saved lines ----------

function lineRow(route) {
  const info = statusOf(route);
  const row = el("button", `line-row ${severity(info.status)}`);
  row.type = "button";
  row.dataset.key = `mine-${route}`;
  row.append(bullet(route));
  const text = el("span", "line-row-text");
  text.append(el("span", "line-row-status", statusWord(info.status)));
  const out = elevatorsOut(route);
  if (out) text.append(el("span", "line-row-note", `${out} elevator${out > 1 ? "s" : ""} out`));
  row.append(text);
  row.setAttribute("aria-label", `${longName(route)}: ${statusWord(info.status)}. Show details.`);
  row.addEventListener("click", () => selectLine(route));
  return row;
}

function renderMine() {
  els.mine.hidden = !(authOn && user);
  if (els.mine.hidden) return;
  const routes = favoriteRoutes();
  els.mineList.replaceChildren(
    ...(routes.length
      ? routes.map(lineRow)
      : [el("p", "empty", "Open any line and press Save line to keep it here.")]),
  );
  els.notify.textContent = notifyOn() ? "Alerts on" : "Get alerts";
  els.notify.setAttribute("aria-pressed", String(notifyOn()));
}

// ---------- what's wrong right now ----------

function renderProblems() {
  const now = activeAlerts.filter((a) => !(a.type || "").startsWith("Planned") && a.routes.length);
  els.problems.hidden = !now.length;
  els.problemList.replaceChildren(
    ...now.map((alert) => {
      const li = el("li");
      const btn = el("button", "problem");
      btn.type = "button";
      btn.dataset.key = `problem-${alert.id}`;
      const lines = el("span", "problem-lines");
      alert.routes.forEach((r) => lines.append(bullet(r)));
      const text = el("span", "problem-text");
      text.append(el("strong", null, alert.type || "Service change"), el("span", null, alert.header));
      btn.append(lines, text);
      btn.addEventListener("click", () => selectLine(alert.routes[0]));
      li.append(btn);
      return li;
    }),
  );
}

// ---------- every line ----------

function renderTiles() {
  const issuesOnly = els.issuesOnly.checked;
  const routes = Object.keys(statuses).filter((r) => !issuesOnly || statuses[r].status !== GOOD_SERVICE);
  if (!routes.length && Object.keys(statuses).length) {
    els.tiles.replaceChildren(el("p", "empty", "Every line has good service right now."));
    return;
  }
  els.tiles.replaceChildren(
    ...routes.map((route) => {
      const info = statusOf(route);
      const tile = el("button", `tile ${severity(info.status)}`);
      tile.type = "button";
      tile.dataset.key = `tile-${route}`;
      if (selected && selected.route === route) tile.classList.add("selected");
      tile.append(bullet(route, "big"), el("span", "tile-status", statusWord(info.status)));
      if (isFavorite(route)) tile.append(el("span", "tile-saved", "★"));
      tile.setAttribute("aria-label", `${longName(route)}: ${statusWord(info.status)}${isFavorite(route) ? ", saved" : ""}`);
      tile.addEventListener("click", () => selectLine(route));
      return tile;
    }),
  );
}

// ---------- details panel ----------

function alertItem(alert) {
  const item = el("article", `alert ${severity(alert.type || "Delays")}`);
  item.append(el("h4", null, alert.type || "Service change"));
  item.append(el("p", "alert-header", alert.header));
  const start = when(alert.start);
  const end = when(alert.end);
  if (start || end) item.append(el("p", "meta", `${start || "Now"} to ${end || "further notice"}`));
  if (alert.description) {
    const more = el("details");
    more.append(el("summary", null, "More details"), el("p", "alert-more", alert.description));
    item.append(more);
  }
  return item;
}

function outageItem(o) {
  const item = el("article", `outage${o.accessible_route ? " accessible" : ""}`);
  item.append(el("h4", null, o.station));
  item.append(el("p", null, o.serving ? `${o.type}: ${o.serving}` : o.type));
  const notes = [];
  if (o.accessible_route) notes.push("Step-free route");
  if (o.upcoming && o.since) notes.push(`Scheduled to go out ${when(o.since)}`);
  if (!o.back) notes.push("No return date yet");
  else if (new Date(o.back) < new Date()) notes.push(`Was due back ${when(o.back)}`);
  else notes.push(`Back ${when(o.back)}`);
  item.append(el("p", "meta", notes.join(". ")));
  return item;
}

function section(title, items, emptyText) {
  if (!items.length && !emptyText) return [];
  return [el("h3", null, title), ...(items.length ? items : [el("p", "empty", emptyText)])];
}

function saveButton(route) {
  const saved = isFavorite(route);
  const btn = el("button", `save${saved ? " on" : ""}`, saved ? "★ Saved" : "☆ Save line");
  btn.type = "button";
  btn.dataset.key = "save";
  btn.setAttribute("aria-pressed", String(saved));
  if (isPending(route)) btn.setAttribute("aria-busy", "true");
  btn.addEventListener("click", () => onSave(route));
  return btn;
}

function renderDetails() {
  if (!selected) return;
  const { route, alerts } = selected;
  const info = statusOf(route);

  const head = el("div", "details-head");
  const title = el("div");
  title.append(el("h2", null, longName(route)), el("p", `details-status ${severity(info.status)}`, statusWord(info.status)));
  head.append(bullet(route, "huge"), title);
  if (authOn) head.append(saveButton(route));

  // Broken now first, scheduled work after (the server already puts step-free elevators first).
  const lineOutages = outages
    .filter((o) => o.lines.includes(route))
    .sort((a, b) => Number(a.upcoming) - Number(b.upcoming));
  const outageItems = lineOutages.slice(0, OUTAGES_SHOWN).map(outageItem);
  if (lineOutages.length > OUTAGES_SHOWN) {
    const more = el("details", "more-outages");
    more.append(el("summary", null, `Show ${lineOutages.length - OUTAGES_SHOWN} more`));
    lineOutages.slice(OUTAGES_SHOWN).forEach((o) => more.append(outageItem(o)));
    outageItems.push(more);
  }
  const body = [head];
  if (!alerts) {
    body.push(el("p", "empty", "Loading alerts…"));
  } else {
    body.push(
      ...section("Happening now", alerts.filter((a) => a.active).map(alertItem), "Trains are running normally."),
      ...section("Coming up", alerts.filter((a) => !a.active).map(alertItem)),
    );
  }
  body.push(
    ...section(
      "Elevators and escalators",
      outageItems,
      "Every elevator and escalator on this line is working.",
    ),
  );
  els.details.replaceChildren(...body);
}

async function loadLineAlerts(route) {
  try {
    const data = await getJSON(`${ALERTS_URL}?route=${encodeURIComponent(route)}`);
    if (selected && selected.route === route) {
      selected.alerts = data.alerts;
      keepFocus(renderDetails);
    }
  } catch (err) {
    els.details.replaceChildren(el("p", "empty", `Couldn't load alerts for this line (${err.message}).`));
  }
}

function selectLine(route) {
  selected = { route, alerts: null };
  renderTiles();
  renderDetails();
  loadLineAlerts(route);
  if (window.matchMedia(MOBILE_QUERY).matches) els.details.scrollIntoView({ behavior: "smooth" });
}

// ---------- saving lines + alerts when they change ----------

function onSave(route) {
  if (!user) {
    saveAfterSignIn = route;
    signIn()
      .then((ok) => { if (!ok) saveAfterSignIn = null; })
      .catch((err) => { saveAfterSignIn = null; toast(err.message); });
    return;
  }
  toggleFavorite(route).catch((err) => toast(`Couldn't update your lines: ${err.message}`));
}

function notifyOn() {
  try { return localStorage.getItem(NOTIFY_KEY) === "1"; } catch (_) { return false; }
}

function setNotify(on) {
  try { localStorage.setItem(NOTIFY_KEY, on ? "1" : "0"); } catch (_) {}
  renderMine();
}

async function onNotifyClick() {
  if (notifyOn()) return setNotify(false);
  if ("Notification" in window && Notification.permission !== "granted") {
    const answer = await Notification.requestPermission();
    if (answer !== "granted") {
      toast("Notifications are blocked, so changes will only show on this page while it's open.");
    }
  }
  setNotify(true);
  toast("You'll get an alert when one of your lines changes.");
}

function announceChanges() {
  const before = lastStatuses;
  lastStatuses = Object.fromEntries(Object.entries(statuses).map(([r, s]) => [r, s.status]));
  if (!before || !user) return;
  const changed = favoriteRoutes().filter((r) => before[r] && lastStatuses[r] && before[r] !== lastStatuses[r]);
  if (!changed.length) return;
  const message = changed.map((r) => `${longName(r)}: ${statusWord(lastStatuses[r])}`).join(" · ");
  toast(message);
  if (notifyOn() && "Notification" in window && Notification.permission === "granted") {
    new Notification("Your subway lines changed", { body: message });
  }
}

// ---------- loading + account ----------

function renderAll() {
  keepFocus(() => {
    renderHeadline();
    renderMine();
    renderProblems();
    renderTiles();
    renderDetails();
  });
}

async function loadEverything() {
  els.refresh.disabled = true;
  try {
    // Status first: that request is the one that refreshes from the MTA, so the
    // alerts request right after it reads fresh data instead of racing it.
    const status = await getJSON(STATUS_URL);
    const [alerts, elevators] = await Promise.all([
      getJSON(`${ALERTS_URL}?active=1`),
      getJSON(ELEVATORS_URL).catch(() => ({ outages, warning: "Elevator outages are unavailable right now." })),
    ]);
    statuses = status.routes || {};
    activeAlerts = alerts.alerts || [];
    outages = elevators.outages || [];
    const warning = status.warning || elevators.warning;
    els.warning.hidden = !warning;
    els.warning.textContent = warning || "";
    els.updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
    announceChanges();
    renderAll();
    if (selected) loadLineAlerts(selected.route);
  } catch (err) {
    els.warning.hidden = false;
    els.warning.textContent = `Couldn't load service status (${err.message}). Trying again in a minute.`;
  } finally {
    els.refresh.disabled = false;
  }
}

async function onUserChange(newUser) {
  authOn = true; // Firebase loaded, so saving lines is possible
  user = newUser;
  els.account.hidden = false;
  els.signInBtn.hidden = Boolean(user);
  els.me.hidden = !user;
  if (user) {
    els.meName.textContent = user.name;
    els.meAvatar.textContent = user.name.charAt(0).toUpperCase();
    els.meAvatar.style.backgroundImage = user.photo ? `url("${encodeURI(user.photo)}")` : "";
  }
  try {
    await loadFavorites(Boolean(user));
  } catch (err) {
    toast(`Couldn't load your saved lines: ${err.message}`);
  }
  if (user && saveAfterSignIn && !isFavorite(saveAfterSignIn)) onSave(saveAfterSignIn);
  saveAfterSignIn = null;
  renderAll();
}

// ---------- start ----------

try { els.issuesOnly.checked = localStorage.getItem(ISSUES_ONLY_KEY) === "1"; } catch (_) {}
els.issuesOnly.addEventListener("change", () => {
  try { localStorage.setItem(ISSUES_ONLY_KEY, els.issuesOnly.checked ? "1" : "0"); } catch (_) {}
  keepFocus(renderTiles);
});
els.refresh.addEventListener("click", loadEverything);
els.notify.addEventListener("click", onNotifyClick);
els.signInBtn.addEventListener("click", () => signIn().catch((err) => toast(err.message)));
els.signOutBtn.addEventListener("click", () => signOut());
onFavoritesChange(renderAll);

loadEverything();
setInterval(loadEverything, REFRESH_MS);
startAuth(onUserChange); // sign-in is optional: everything above works without it
