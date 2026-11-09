"""Elevator and escalator outages from the MTA (accessibility info).

The MTA publishes a JSON list of every elevator/escalator that's out of service,
no API key needed. We download it at most every few minutes and keep it in memory:
it's a small list that changes slowly, so there's no database table for it.

One outage from the MTA looks like:
  {"station": "Jamaica-179 St", "trainno": "F", "equipment": "EL433",
   "equipmenttype": "EL", "serving": "mezzanine to terminal platform", "ADA": "Y",
   "outagedate": "09/28/2026 10:00:00 PM", "estimatedreturntoservice": "09/29/2026 06:00:00 AM",
   "reason": "Maintenance", "isupcomingoutage": "Y", ...}
"""
import json
import time
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

from django.conf import settings

from .mta import SUBWAY_ROUTES

# Change it in settings.py (MTA_ELEVATORS_URL) if the MTA moves the feed.
DEFAULT_ELEVATORS_URL = (
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fnyct_ene.json"
)
CACHE_SECONDS = 5 * 60  # outages change slowly; don't hit the MTA more than this
FETCH_TIMEOUT_SECONDS = 15
NEW_YORK = ZoneInfo("America/New_York")
MTA_DATE_FORMAT = "%m/%d/%Y %I:%M:%S %p"  # e.g. "09/28/2026 10:00:00 PM", New York time
EQUIPMENT_TYPES = {"EL": "Elevator", "ES": "Escalator"}
# The feed writes every shuttle as "S" without saying which one, so it counts for all three.
SHUTTLES = ["GS", "FS", "H"]

_cache = {"outages": None, "fetched_at": None, "warning": None}


def fetch_payload():
    """Download the raw JSON list from the MTA (network call)."""
    url = getattr(settings, "MTA_ELEVATORS_URL", DEFAULT_ELEVATORS_URL)
    request = urllib.request.Request(url, headers={"User-Agent": "nyc-transit-class-project"})
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
        return json.load(response)


def parse_mta_date(text):
    """'09/28/2026 10:00:00 PM' (New York time) -> aware datetime, or None if blank/odd."""
    try:
        return datetime.strptime(str(text).strip(), MTA_DATE_FORMAT).replace(tzinfo=NEW_YORK)
    except ValueError:
        return None


def parse_lines(trainno):
    """'A/C/E/LIRR' -> ['A', 'C', 'E'] (only lines we show; 'S' means all three shuttles)."""
    lines = []
    for token in str(trainno or "").upper().split("/"):
        token = token.strip()
        for line in SHUTTLES if token == "S" else [token]:
            if line in SUBWAY_ROUTES and line not in lines:
                lines.append(line)
    return lines


def parse_outages(payload):
    """Turn the MTA's list into simple dicts. Skips anything that isn't a proper record."""
    outages = []
    for row in payload if isinstance(payload, list) else []:
        if not isinstance(row, dict) or not row.get("equipment") or not row.get("station"):
            continue
        outages.append(
            {
                "station": row["station"].strip(),
                "lines": parse_lines(row.get("trainno")),
                "equipment": row["equipment"],
                "type": EQUIPMENT_TYPES.get(row.get("equipmenttype"), "Equipment"),
                "serving": (row.get("serving") or "").strip(),
                # "Y" = this is the accessible route for wheelchair users
                "accessible_route": row.get("ADA") == "Y",
                "reason": (row.get("reason") or "").strip(),
                "since": parse_mta_date(row.get("outagedate")),
                "back": parse_mta_date(row.get("estimatedreturntoservice")),
                "upcoming": row.get("isupcomingoutage") == "Y",
            }
        )
    # Accessible elevators first (they matter most), then by station name.
    outages.sort(key=lambda o: (not o["accessible_route"], o["type"] != "Elevator", o["station"]))
    return outages


def get_outages():
    """(outages, warning). Refreshes at most every CACHE_SECONDS; keeps old data if the MTA fails."""
    fetched_at = _cache["fetched_at"]
    if fetched_at is None or time.monotonic() - fetched_at >= CACHE_SECONDS:
        _cache["fetched_at"] = time.monotonic()  # set first, so failures also wait
        try:
            outages = parse_outages(fetch_payload())
            if not outages and _cache["outages"]:
                raise ValueError("the feed came back empty")
            _cache["outages"], _cache["warning"] = outages, None
        except Exception as exc:  # network down, MTA changed format, etc.
            kept = "showing the last saved list" if _cache["outages"] else "no data yet"
            _cache["warning"] = f"Could not refresh elevator outages ({exc}); {kept}."
    return _cache["outages"] or [], _cache["warning"]


def reset_cache():
    """Forget what we downloaded (used by tests)."""
    _cache.update(outages=None, fetched_at=None, warning=None)
