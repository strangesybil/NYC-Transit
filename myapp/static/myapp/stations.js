// Pure station selection helpers, shared by the dashboard and regression tests.
export function searchStations(stations, query = "", route = "") {
  const text = query.trim().toLocaleLowerCase();
  return stations.filter((s) => s.name.toLocaleLowerCase().includes(text) && (!route || s.lines.includes(route)));
}
export function stationAlerts(alerts, station) {
  return [...new Map(alerts.filter((a) => a.routes.some((r) => station.lines.includes(r))).map((a) => [a.id, a])).values()];
}
export function stationOutages(outages, station) {
  // Exact catalog names and explicitly reviewed aliases only; never fuzzy matching.
  return outages.filter((o) => station.outage_names.includes(o.station) && o.lines.some((r) => station.lines.includes(r)))
    .sort((a, b) => Number(a.upcoming) - Number(b.upcoming));
}
