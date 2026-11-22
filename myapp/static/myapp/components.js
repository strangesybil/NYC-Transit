// Small DOM components shared across the existing vanilla JavaScript frontend.
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
// Official MTA line colors.
export const LINE_COLORS = {
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
export const DARK_TEXT_LINES = ["N", "Q", "R", "W"]; // yellow bullets need black letters
export const DISPLAY_NAMES = { GS: "S", FS: "S", H: "S", SI: "SIR" }; // the feed's ids vs what riders call them
export const LINE_NAMES = { GS: "42 St Shuttle", FS: "Franklin Av Shuttle", H: "Rockaway Park Shuttle", SI: "Staten Island Railway" };


export const shortName = (route) => DISPLAY_NAMES[route] || route;
export const longName = (route) => route === "6X" || route === "7X" ? `${route[0]} express` : LINE_NAMES[route] || `${route} line`;
export function icon(name) {
  const node = el("span", `icon icon-${name}`);
  node.setAttribute("aria-hidden", "true");
  node.style.setProperty("--icon", `url("${new URL(`./vendor/lucide/${name}.svg`, import.meta.url)}")`);
  return node;
}
export function bullet(route, size = "") {
  const express = route === "6X" || route === "7X";
  const base = express ? route[0] : route;
  const node = el("span", `bullet ${size}${express ? " express" : ""}`.trim());
  node.style.setProperty("--line", LINE_COLORS[base] || "#808183");
  if (DARK_TEXT_LINES.includes(base)) node.classList.add("dark-text");
  if (shortName(base).length > 1) node.classList.add("wide");
  node.append(el("span", "bullet-label", shortName(base)));
  node.setAttribute("role", "img");
  node.setAttribute("aria-label", express ? `${base} express` : longName(route));
  return node;
}
export function routeText(text) {
  const fragment = document.createDocumentFragment();
  for (const part of String(text).split(/(\[[^\]\r\n]+\])/g)) {
    const token = part.slice(1, -1).trim();
    const route = token.toUpperCase();
    const symbol = new Map([["shuttle bus icon", ["bus", "Shuttle bus"]], ["accessibility icon", ["accessibility", "Accessibility"]]]).get(token.toLowerCase().replace(/\s+/g, " "));
    if (part.startsWith("[") && symbol) {
      const label = el("span", "inline-symbol");
      label.append(icon(symbol[0]), document.createTextNode(symbol[1]));
      fragment.append(label);
    } else if (part.startsWith("[") && (Object.hasOwn(LINE_COLORS, route) || ["6X", "7X", "S", "SIR"].includes(route))) {
      fragment.append(bullet(route === "S" ? "GS" : route === "SIR" ? "SI" : route, "text-bullet"));
    } else fragment.append(document.createTextNode(part));
  }
  return fragment;
}
export function accessibilityText(status) {
  const descriptions = {
    "ADA accessible": "Step-free access is available at this station.",
    "Partially ADA accessible": "Step-free access is available only for some platforms or directions.",
    "Not ADA accessible": "This station is not listed as having a step-free route to its platforms.",
  };
  return Object.hasOwn(descriptions, status) ? descriptions[status] : "Step-free access information is not available for this station.";
}
export function saveControl({saved, pending, label, key, onClick}) {
  const button = el("button", `save${saved ? " on" : ""}`);
  button.type = "button"; button.dataset.key = key;
  button.disabled = pending;
  button.setAttribute("aria-pressed", String(saved));
  button.setAttribute("aria-busy", String(pending));
  button.append(icon("star"), document.createTextNode(saved ? `Saved ${label}` : `Save ${label}`));
  button.addEventListener("click", onClick);
  return button;
}
export const expansion = new Map();
export function alertPreview(title, alerts, key, renderItem, empty) {
  const section = el("section", "alert-preview");
  section.append(el("h3", null, `${title} (${alerts.length})`));
  const list = el("div", "alert-items");
  list.id = `alerts-${key.replace(/[^a-zA-Z0-9-]/g, "-")}`;
  const expanded = expansion.get(key) || false;
  list.append(...(alerts.length ? alerts.slice(0, expanded ? alerts.length : 2).map(renderItem) : [el("p", "empty", empty)]));
  section.append(list);
  if (alerts.length > 2) {
    const button = el("button", "text-btn disclosure");
    button.type = "button"; button.dataset.key = `expand-${key}`;
    button.setAttribute("aria-controls", list.id);
    const update = () => {
      const open = expansion.get(key) || false;
      button.setAttribute("aria-expanded", String(open));
      button.replaceChildren(icon(open ? "minus" : "plus"), document.createTextNode(open ? "See less" : `See more (${alerts.length - 2})`));
      list.replaceChildren(...alerts.slice(0, open ? alerts.length : 2).map(renderItem));
    };
    button.addEventListener("click", () => { expansion.set(key, !expansion.get(key)); update(); });
    update(); section.append(button);
  }
  return section;
}
export function equipmentReport(o, when) {
  const item = el("article", `outage${o.accessible_route ? " accessible" : ""}`);
  const heading = el("h4");
  heading.append(icon(o.type === "Elevator" ? "arrow-up-down" : "move-up-right"), document.createTextNode(`${o.type}${o.equipment ? ` · ${o.equipment}` : ""}`));
  item.append(heading, el("p", null, o.station));
  if (o.serving) item.append(el("p", null, `Location: ${o.serving}`));
  if (o.reason) item.append(el("p", null, `Reason: ${o.reason}`));
  const notes = [];
  if (o.accessible_route) notes.push("Serves a step-free route");
  if (o.since) notes.push(`${o.upcoming ? "Scheduled start" : "Out since"}: ${when(o.since)}`);
  notes.push(o.back ? `${new Date(o.back) < new Date() ? "Was due back" : "Estimated return"}: ${when(o.back)}` : "Return time unknown");
  item.append(el("p", "meta", notes.join(". ")));
  return item;
}
