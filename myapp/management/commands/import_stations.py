"""Refresh the bundled catalog from an official MTA JSON export."""
import json
import urllib.request
from datetime import date
from django.core.management.base import BaseCommand, CommandError
from myapp.stations import CATALOG_PATH, catalog
from myapp.mta import SUBWAY_ROUTES

SOURCE = "https://data.ny.gov/resource/39hk-dx4f.json?$limit=1000"
BOROUGHS = {"M": "Manhattan", "Bk": "Brooklyn", "Q": "Queens", "Bx": "Bronx", "SI": "Staten Island"}

def normalize(rows):
    stations = []
    for row in rows:
        sid = str(row["station_id"])
        lines = []
        for route in row["daytime_routes"].split():
            if route == "S":
                route = "GS" if sid in ("468", "469") else "FS" if sid in ("42", "139", "141", "142") else "H"
            route = "SI" if route == "SIR" else route
            if route not in SUBWAY_ROUTES:
                raise ValueError(f"Unrecognized route: {route}")
            lines.append(route)
        notes = row.get("ada_notes", "")
        stations.append({"id": sid, "name": row["stop_name"],
            "borough": BOROUGHS[row["borough"]], "lines": lines,
            "gtfs_stop_ids": [row["gtfs_stop_id"]],
            "accessibility": {"0": "Not ADA accessible", "1": "ADA accessible", "2": "Partially ADA accessible"}.get(row.get("ada"), "Accessibility not reported"),
            "accessibility_notes": "" if notes == "NaN" else notes,
            "outage_names": [row["stop_name"]]})
    grouped = {}
    for station in stations:
        previous = grouped.get(station["id"])
        if previous:
            for key in ("lines", "gtfs_stop_ids"):
                previous[key] = sorted(set(previous[key] + station[key]))
        else:
            grouped[station["id"]] = station
    stations = list(grouped.values())
    if len(stations) < 400 or len({s["id"] for s in stations}) != len(stations):
        raise ValueError("Incomplete catalog or duplicate station IDs")
    return sorted(stations, key=lambda s: (s["name"], s["borough"], s["id"]))

class Command(BaseCommand):
    help = __doc__
    def add_arguments(self, parser):
        parser.add_argument("--source-file", help="Previously downloaded JSON export")
    def handle(self, *args, **options):
        try:
            if options["source_file"]:
                with open(options["source_file"]) as f:
                    rows = json.load(f)
            else:
                with urllib.request.urlopen(SOURCE, timeout=30) as response:
                    rows = json.load(response)
            stations = normalize(rows)
            if CATALOG_PATH.exists():
                previous = {s["id"]: s for s in json.loads(CATALOG_PATH.read_text())["stations"]}
                for station in stations:
                    aliases = previous.get(station["id"], {}).get("outage_names", [])
                    station["outage_names"] = list(dict.fromkeys([station["name"], *aliases]))
            data = {"source": SOURCE, "retrieved_at": date.today().isoformat(), "stations": stations}
        except (ValueError, KeyError, OSError) as exc:
            raise CommandError(str(exc)) from exc
        CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        CATALOG_PATH.write_text(json.dumps(data, indent=2) + "\n")
        catalog.cache_clear()
        self.stdout.write(f"Imported {len(data['stations'])} stations")
