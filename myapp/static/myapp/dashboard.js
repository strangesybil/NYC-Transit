// Service status dashboard (Task 5).
// Reads /api/status/ for the board and /api/alerts/?route=X for the details panel.

const STATUS_URL = "/api/status/";
const ALERTS_URL = "/api/alerts/";
const REFRESH_MS = 60 * 1000; // backend only re-pulls the MTA once a minute anyway
const GOOD_SERVICE = "Good Service";
const ISSUES_ONLY_KEY = "nyc-transit-issues-only";

// Lines grouped by trunk line, with the MTA's official bullet colors.
const LINE_GROUPS = [
  { name: "Broadway–7 Av", color: "#EE352E", routes: ["1", "2", "3"] },
  { name: "Lexington Av", color: "#00933C", routes: ["4", "5", "6"] },
  { name: "Flushing", color: "#B933AD", routes: ["7"] },
  { name: "8 Av", color: "#0039A6", routes: ["A", "C", "E"] },
  { name: "6 Av", color: "#FF6319", routes: ["B", "D", "F", "M"] },
  { name: "Crosstown", color: "#6CBE45", routes: ["G"] },
  { name: "Nassau St", color: "#996633", routes: ["J", "Z"] },
  { name: "14 St–Canarsie", color: "#A7A9AC", routes: ["L"] },
  { name: "Broadway", color: "#FCCC0A", darkText: true, routes: ["N", "Q", "R", "W"] },
  { name: "Shuttles", color: "#808183", routes: ["GS", "FS", "H"] },
  { name: "Staten Island Railway", color: "#0039A6", routes: ["SI"] },
];

// The feed uses ids like "GS"; riders know them as "S".
const DISPLAY_NAMES = { GS: "S", FS: "S", H: "S", SI: "SIR" };
const SHUTTLE_LABELS = { GS: "42 St", FS: "Franklin", H: "Rockaway" };

const els = {
  groups: document.getElementById("groups"),
  summary: document.getElementById("summary"),
  details: document.getElementById("details"),
  updated: document.getElementById("updated"),
  warning: document.getElementById("warning"),
  refresh: document.getElementById("refresh"),
  issuesOnly: document.getElementById("issues-only"),
};

let statuses = {};
let selectedRoute = null;

// ---------- helpers ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // textContent = no HTML injection from feed text
  return node;
}

function groupFor(route) {
  return LINE_GROUPS.find((g) => g.routes.includes(route)) || { color: "#555", routes: [route] };
}

function bullet(route) {
  const group = groupFor(route);
  const b = el("span", "bullet", DISPLAY_NAMES[route] || route);
  b.style.background = group.color;
  if (group.darkText) b.classList.add("dark-text");
  if ((DISPLAY_NAMES[route] || route).length > 2) b.classList.add("wide");
  return b;
}

function severity(status) {
  if (status === GOOD_SERVICE) return "good";
  if (status.startsWith("Planned")) return "planned";
  return "bad"; // Delays, Suspended, Service Change, etc.
}

function formatTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString([], {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function setWarning(text) {
  els.warning.hidden = !text;
  els.warning.textContent = text || "";
}

// ---------- board ----------

function renderSummary() {
  const counts = { good: 0, planned: 0, bad: 0 };
  Object.values(statuses).forEach((s) => counts[severity(s.status)]++);
  els.summary.replaceChildren(
    el("span", "pill good", `${counts.good} good service`),
    el("span", "pill planned", `${counts.planned} planned work`),
    el("span", "pill bad", `${counts.bad} with issues`),
  );
}

function lineCard(route) {
  const info = statuses[route] || { status: GOOD_SERVICE, alerts: 0, upcoming: 0 };
  const level = severity(info.status);

  const card = el("button", `line-card ${level}`);
  card.type = "button";
  card.dataset.route = route;
  if (route === selectedRoute) card.classList.add("selected");

  const text = el("div", "line-text");
  text.append(el("span", "line-status", info.status));
  const extra = [];
  if (info.alerts > 1) extra.push(`${info.alerts} alerts`);
  if (info.upcoming > 0) extra.push(`${info.upcoming} upcoming`);
  if (SHUTTLE_LABELS[route]) extra.unshift(SHUTTLE_LABELS[route]);
  if (extra.length) text.append(el("span", "line-extra", extra.join(" · ")));

  card.append(bullet(route), text);
  card.setAttribute("aria-label", `${DISPLAY_NAMES[route] || route} line: ${info.status}`);
  card.addEventListener("click", () => selectRoute(route));
  return card;
}

function renderBoard() {
  const issuesOnly = els.issuesOnly.checked;
  const known = new Set(LINE_GROUPS.flatMap((g) => g.routes));
  // Lines the API returns that we don't have a group for still get shown.
  const extras = Object.keys(statuses).filter((r) => !known.has(r));
  const groups = extras.length
    ? [...LINE_GROUPS, { name: "Other", color: "#555", routes: extras }]
    : LINE_GROUPS;

  const frag = document.createDocumentFragment();
  groups.forEach((group) => {
    const routes = group.routes.filter((r) => {
      if (!(r in statuses)) return false;
      return !issuesOnly || statuses[r].status !== GOOD_SERVICE || statuses[r].upcoming > 0;
    });
    if (!routes.length) return;

    const section = el("div", "group");
    section.append(el("h3", "group-name", group.name));
    const row = el("div", "group-lines");
    routes.forEach((r) => row.append(lineCard(r)));
    section.append(row);
    frag.append(section);
  });

  if (!frag.childNodes.length) {
    frag.append(el("p", "empty", "Good service on every line right now."));
  }
  els.groups.replaceChildren(frag);
  renderSummary();
}

async function loadStatus() {
  els.refresh.disabled = true;
  try {
    const res = await fetch(STATUS_URL);
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    const data = await res.json();
    statuses = data.routes || {};
    setWarning(data.warning);
    renderBoard();
    els.updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    if (selectedRoute) loadAlerts(selectedRoute);
  } catch (err) {
    setWarning(`Couldn't load service status (${err.message}). Trying again shortly.`);
    els.updated.textContent = "Update failed";
  } finally {
    els.refresh.disabled = false;
  }
}

// ---------- details panel ----------

function alertCard(alert) {
  const card = el("article", `alert ${alert.active ? "now" : "later"}`);
  const head = el("div", "alert-head");
  head.append(el("span", "alert-type", alert.type || "Service Change"));
  head.append(el("span", "alert-when", alert.active ? "In effect" : "Upcoming"));
  card.append(head);

  const routes = el("div", "alert-routes");
  alert.routes.forEach((r) => routes.append(bullet(r)));
  card.append(routes);

  card.append(el("p", "alert-header", alert.header));

  const start = formatTime(alert.start);
  const end = formatTime(alert.end);
  if (start || end) {
    card.append(el("p", "alert-time", `${start || "Now"} → ${end || "until further notice"}`));
  }

  if (alert.description) {
    const more = el("details", "alert-more");
    more.append(el("summary", null, "More details"));
    more.append(el("p", null, alert.description));
    card.append(more);
  }
  return card;
}

function renderDetails(route, alerts) {
  const info = statuses[route] || { status: GOOD_SERVICE };
  const head = el("div", "details-head");
  head.append(bullet(route));
  const title = el("div");
  title.append(el("h2", null, `${DISPLAY_NAMES[route] || route} line`));
  title.append(el("p", `details-status ${severity(info.status)}`, info.status));
  head.append(title);

  const now = alerts.filter((a) => a.active);
  const later = alerts.filter((a) => !a.active);
  const body = [head];

  if (!alerts.length) {
    body.push(el("p", "empty", "No alerts. Trains are running normally."));
  }
  if (now.length) {
    body.push(el("h3", "details-section", "Happening now"), ...now.map(alertCard));
  }
  if (later.length) {
    body.push(el("h3", "details-section", "Upcoming"), ...later.map(alertCard));
  }
  els.details.replaceChildren(...body);
}

async function loadAlerts(route) {
  try {
    const res = await fetch(`${ALERTS_URL}?route=${encodeURIComponent(route)}`);
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    const data = await res.json();
    if (route !== selectedRoute) return; // user clicked something else meanwhile
    renderDetails(route, data.alerts || []);
  } catch (err) {
    els.details.replaceChildren(el("p", "empty", `Couldn't load alerts (${err.message}).`));
  }
}

function selectRoute(route) {
  selectedRoute = route;
  document.querySelectorAll(".line-card").forEach((c) => {
    c.classList.toggle("selected", c.dataset.route === route);
  });
  els.details.replaceChildren(el("p", "empty", "Loading alerts…"));
  loadAlerts(route);
  if (window.matchMedia("(max-width: 860px)").matches) {
    els.details.scrollIntoView({ behavior: "smooth" });
  }
}

// ---------- start ----------

try {
  els.issuesOnly.checked = localStorage.getItem(ISSUES_ONLY_KEY) === "1";
} catch (_) { /* storage blocked: just use the default */ }

els.issuesOnly.addEventListener("change", () => {
  try { localStorage.setItem(ISSUES_ONLY_KEY, els.issuesOnly.checked ? "1" : "0"); } catch (_) {}
  renderBoard();
});
els.refresh.addEventListener("click", loadStatus);

loadStatus();
setInterval(loadStatus, REFRESH_MS);
