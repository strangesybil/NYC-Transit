import {accessibilityText, LINE_COLORS, el, bullet, icon, longName, shortName, routeText, saveControl, alertPreview, equipmentReport} from "./components.js";
// NYC Transit Hub dashboard.
//   /api/status/      one status per line        -> headline + line grid
//   /api/alerts/      the MTA's service alerts   -> "What's wrong right now" + details
//   /api/elevators/   broken elevators/escalators -> details + accessibility badges
// Sign-in is in auth.js, saved lines in favorites.js.

import { savedStations, isStationSaved, stationPending, toggleStation } from "./favorites.js";
import { searchStations, stationAlerts, stationOutages } from "./stations.js";
import { signIn, signOut, startAuth } from "./auth.js";
import { favoriteRoutes, isFavorite, isPending, loadFavorites, onFavoritesChange, toggleFavorite } from "./favorites.js";

const page = document.body.dataset.page || "lines";
const STATUS_URL = "/api/status/";
const ALERTS_URL = "/api/alerts/";
const ELEVATORS_URL = "/api/elevators/";
const REFRESH_MS = 60 * 1000; // the server only re-checks the MTA once a minute anyway
const TOAST_MS = 5000;
const GOOD_SERVICE = "Good Service";
const ISSUES_ONLY_KEY = "nyc-transit-issues-only";
const NOTIFY_KEY = "nyc-transit-notify";
const MAX_HEADLINE_BULLETS = 6; // more than this and the headline just gives a count

const $ = (id) => document.getElementById(id);
const els = {
  headline: $("headline"), updated: $("updated"), refresh: $("refresh"), warning: $("warning"),
  mine: $("mine"), mineList: $("mine-list"), notify: $("notify"),
  problems: $("problems"), problemList: $("problem-list"),
  tiles: $("tiles"), issuesOnly: $("issues-only"), details: $("details"), toast: $("toast"),
  account: $("account"), signInBtn: $("sign-in"), me: $("me"), meName: $("me-name"),
  meAvatar: $("me-avatar"), signOutBtn: $("sign-out"),
};

let stations = [];
let catalogReady = false;
let authGeneration = 0;
let statuses = {}; // { A: { status: "Delays", alerts: 1, upcoming: 2 }, ... }
let activeAlerts = []; // alerts happening right now, all lines
let outages = []; // elevator/escalator outages, all lines
let equipmentWarning = "";
let selected = null; // { route, alerts } for the details panel
let authOn = false;
let user = null;
let saveAfterSignIn = null; // line the rider tried to save while signed out
let lastStatuses = null; // to notice when a saved line changes
let toastTimer = null;

// ---------- small helpers ----------

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
  if (page === "stations") return;
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
  els.mine.hidden = page === "stations" || !(authOn && user);
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
  if (page === "stations") { els.problems.hidden = true; return; }
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
  if (page === "stations") return;
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
      if (isFavorite(route)) { const saved = el("span", "tile-saved"); saved.append(icon("star")); tile.append(saved); }
      tile.setAttribute("aria-label", `${longName(route)}: ${statusWord(info.status)}${isFavorite(route) ? ", saved" : ""}`);
      tile.addEventListener("click", () => selectLine(route));
      return tile;
    }),
  );
}

// ---------- details panel ----------

function alertItem(alert) {
  const item = el("article", `alert ${severity(alert.type || "Delays")}`);
  const heading = el("h4"); heading.append(icon("triangle-alert"), document.createTextNode(alert.type || "Service change")); item.append(heading);
  const header = el("p", "alert-header"); header.append(routeText(alert.header)); item.append(header);
  const start = when(alert.start);
  const end = when(alert.end);
  if (start || end) item.append(el("p", "meta", `${start || "Now"} to ${end || "further notice"}`));
  if (alert.description) {
    const more = el("details");
    const description = el("p", "alert-more"); description.append(routeText(alert.description));
    more.append(el("summary", null, "More details"), description);
    item.append(more);
  }
  return item;
}

function outageItem(o) { return equipmentReport(o, when); }

function saveButton(route) {
  return saveControl({saved:isFavorite(route), pending:isPending(route), label:"line", key:`save-${route}`, onClick:() => onSave(route)});
}
function scrollToDetails() {
  if (window.matchMedia("(max-width: 1023px)").matches) els.details.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block:"start"});
}
function accessibilityCard(station, route) {
  const card = el("section", "accessibility-card");
  const heading = el("h3"); heading.append(icon("accessibility"), document.createTextNode("Accessibility")); card.append(heading);
  if (station) {
    card.append(el("h4", null, "Published station accessibility"), el("p", null, accessibilityText(station.accessibility)));
    if (station.accessibility_notes) card.append(el("p", "meta", station.accessibility_notes));
  } else card.append(el("p", "meta", "Equipment reports across this line."));
  if (equipmentWarning) card.append(el("p", "data-warning", equipmentWarning));
  const reports = station ? stationOutages(outages, station) : outages.filter((o) => o.lines.includes(route));
  for (const [upcoming, title] of [[false,"Current equipment outages"], [true,"Scheduled equipment outages"]]) {
    const items = reports.filter((o) => Boolean(o.upcoming) === upcoming);
    card.append(el("h4", null, title), ...(items.length ? items.map(outageItem) : [el("p", "empty", "No matching outages reported.")]));
  }
  card.append(el("p", "meta", "Live equipment reports are separate from published accessibility. No matching report does not guarantee step-free access."));
  return card;
}
function renderDetails() {
  if (!selected) return;
  if (selected.station) return renderStationDetails();
  const {route, alerts, warning} = selected;
  const info = statusOf(route);
  const head = el("section", "line-summary");
  head.append(bullet(route,"huge"), el("h2",null,longName(route)), el("p",`details-status ${severity(info.status)}`,statusWord(info.status)));
  if (authOn) head.append(saveButton(route));
  const body = [];
  const overview = el("div","detail-overview"); overview.append(head,accessibilityCard(null,route)); body.push(overview);
  if (warning) body.push(el("p","data-warning",warning));
  if (!alerts) body.push(el("p","empty",selected.error ? "Alert information is unavailable." : "Loading alerts…"));
  else body.push(alertColumns(alerts,`line-${route}`));
  els.details.replaceChildren(...body);
}
function alertColumns(alerts,key) {
  const columns = el("div","alert-columns");
  columns.append(alertPreview("Happening now",alerts.filter((a)=>a.active),`${key}-now`,alertItem,"No current alerts reported."),alertPreview("Coming up",alerts.filter((a)=>!a.active),`${key}-upcoming`,alertItem,"No upcoming alerts reported."));
  return columns;
}

async function loadLineAlerts(route) {
  try {
    const data = await getJSON(`${ALERTS_URL}?route=${encodeURIComponent(route)}`);
    if (selected && selected.route === route) {
      selected.alerts = data.alerts;
      selected.warning = data.warning || "";
      selected.error = false;
      keepFocus(renderDetails);
    }
  } catch (err) {
    if (selected?.route === route) {
      selected.warning = `Couldn't refresh alerts (${err.message}).`;
      selected.error = true;
      keepFocus(renderDetails);
    }
  }
}

function selectLine(route) {
  selected = { route, alerts: null };
  renderTiles();
  renderDetails();
  loadLineAlerts(route);
  scrollToDetails();
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
    renderSavedStations();
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
    equipmentWarning = elevators.warning || "";
    const warning = status.warning || elevators.warning;
    els.warning.hidden = !warning;
    els.warning.textContent = warning || "";
    els.updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
    announceChanges();
    renderAll();
    if (selected?.station) loadStationAlerts(selected.station);
    else if (selected) loadLineAlerts(selected.route);
  } catch (err) {
    els.warning.hidden = false;
    els.warning.textContent = `Couldn't load service status (${err.message}). Trying again in a minute.`;
  } finally {
    els.refresh.disabled = false;
  }
}

async function onUserChange(newUser) {
  const current = ++authGeneration;
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
  if (current !== authGeneration) return;
  if (user && saveAfterSignIn) {
    const target = saveAfterSignIn;
    if (typeof target === "object") { if (!isStationSaved(target.id)) onSaveStation(target); }
    else if (!isFavorite(target)) onSave(target);
  }
  saveAfterSignIn = null;
  renderAll();
}

// ---------- start ----------

try { els.issuesOnly.checked = localStorage.getItem(ISSUES_ONLY_KEY) === "1"; } catch (_) {}
els.issuesOnly.addEventListener("change", () => {
  try { localStorage.setItem(ISSUES_ONLY_KEY, els.issuesOnly.checked ? "1" : "0"); } catch (_) {}
  keepFocus(renderTiles);
});
els.refresh.prepend(icon("refresh-cw"));
els.refresh.addEventListener("click", loadEverything);
els.notify.addEventListener("click", onNotifyClick);
els.signInBtn.addEventListener("click", () => signIn().catch((err) => toast(err.message)));
els.signOutBtn.addEventListener("click", () => signOut());
onFavoritesChange(renderAll);

loadEverything();
setInterval(loadEverything, REFRESH_MS);
startAuth(onUserChange); // sign-in is optional: everything above works without it

// ---------- station browsing ----------
function stationRow(station, keyPrefix) {
  const button = el("button", "station-result");
  button.type = "button";
  button.dataset.key = `${keyPrefix}-${station.id}`;
  button.append(el("strong", null, station.name), el("span", "meta", station.borough));
  const lines = el("span", "station-lines");
  station.lines.forEach((r) => lines.append(bullet(r)));
  button.append(lines);
  button.addEventListener("click", () => selectStation(station));
  return button;
}
function renderStationSearch() {
  const results = searchStations(stations, $("station-query").value, $("station-line").value);
  $("station-message").textContent = results.length ? `${results.length} station${results.length === 1 ? "" : "s"}.${results.length > 20 ? " Showing 20; refine your search for more." : ""}` : "No stations match your search.";
  $("station-results").replaceChildren(...results.slice(0, 20).map((s) => stationRow(s, "search")));
}
async function loadStations() {
  $("station-retry").hidden = true;
  $("station-message").textContent = "Loading stations…";
  try {
    const data = await getJSON("/api/stations/");
    stations = data.stations;
    catalogReady = true;
    const routes = [...new Set(stations.flatMap((s) => s.lines))].sort();
    $("station-line").replaceChildren(new Option("All lines", ""), ...routes.map((r) => new Option(longName(r), r)));
    renderStationSearch();
    renderSavedStations();
  } catch (err) {
    $("station-message").textContent = `Couldn't load stations (${err.message}).`;
    $("station-retry").hidden = false;
  }
}
function renderSavedStations() {
  $("saved-stations").hidden = page !== "stations" || !user;
  const rows = savedStations().map((favorite) => {
    const station = stations.find((s) => s.id === favorite.station_id);
    const row = el("div", "saved-station-row");
    row.append(station ? stationRow(station, "saved") : el("span", null, favorite.name));
    const remove = el("button", "text-btn", "Remove");
    remove.type = "button";
    remove.dataset.key = `remove-station-${favorite.id}`;
    remove.setAttribute("aria-label", `Remove ${favorite.name} from saved stations`);
    remove.disabled = stationPending(favorite.station_id || favorite.id);
    remove.addEventListener("click", () => toggleStation(favorite.station_id, favorite.id).catch((err) => toast(err.message)));
    row.append(remove);
    return row;
  });
  $("saved-station-list").replaceChildren(...(rows.length ? rows : [el("p", "empty", "Find a station and press Save station to keep it here.")]));
}
function onSaveStation(station) {
  if (!user) {
    saveAfterSignIn = station;
    signIn().then((ok) => { if (!ok) saveAfterSignIn = null; }).catch((err) => { saveAfterSignIn = null; toast(err.message); });
    return;
  }
  toggleStation(station.id).catch((err) => toast(`Couldn't update your stations: ${err.message}`));
}
function stationOverview(station) {
  const head = el("section", "station-detail-head");
  head.append(el("h2", null, station.name), el("p", "meta", station.borough));
  const lines = el("div", "station-lines");
  station.lines.forEach((r) => { const link = el("a", "text-btn line-link"); link.href=`/lines/?route=${encodeURIComponent(r)}`; link.dataset.key=`station-line-${r}`; link.append(bullet(r)); link.setAttribute("aria-label",`View ${longName(r)} status`); lines.append(link); });
  head.append(lines);
  if (authOn) head.append(saveControl({saved:isStationSaved(station.id),pending:stationPending(station.id),label:"station",key:`save-station-${station.id}`,onClick:()=>onSaveStation(station)}));
  return head;
}
function renderStationDetails() {
  const {station,alerts,warning} = selected;
  const overview = el("div","detail-overview"); overview.append(stationOverview(station),accessibilityCard(station));
  const body = [overview,el("h3",null,"Alerts affecting this station’s lines"),el("p","meta","These are line-wide alerts and may not affect this specific station.")];
  if (warning) body.push(el("p","data-warning",warning));
  if (!alerts) body.push(el("p","empty",selected.error ? "Alert information is unavailable." : "Loading alerts…"));
  else body.push(alertColumns(alerts,`station-${station.id}`));
  els.details.replaceChildren(...body);
}
async function loadStationAlerts(station) {
  const target = selected;
  try {
    const data = await getJSON(ALERTS_URL);
    if (selected !== target) return;
    selected.alerts = stationAlerts(data.alerts, station);
    selected.warning = data.warning || "";
    selected.error = false;
  } catch (err) {
    if (selected !== target) return;
    selected.warning = `Couldn't refresh alerts (${err.message}). ${selected.alerts ? "Showing previously loaded alerts." : "Alert information is unavailable."}`;
    selected.error = true;
  }
  keepFocus(renderDetails);
}
function selectStation(station) {
  selected = { station, alerts: null, warning: "" };
  renderTiles(); renderDetails(); loadStationAlerts(station);
  scrollToDetails();
}
$("station-query").addEventListener("input", () => { if (catalogReady) renderStationSearch(); });
$("station-line").addEventListener("change", () => { if (catalogReady) renderStationSearch(); });
$("station-retry").addEventListener("click", loadStations);
if (page === "stations") loadStations();

const initialRoute = new URLSearchParams(window.location.search).get("route");
if (page === "lines" && (Object.hasOwn(LINE_COLORS, initialRoute) || ["6X", "7X"].includes(initialRoute))) selectLine(initialRoute);
