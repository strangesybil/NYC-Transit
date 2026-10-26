"""Talks to the MTA: downloads live service alerts and saves them in our database."""
import json
import urllib.request
from datetime import datetime, timezone

from django.conf import settings
from django.db import transaction
from django.utils import timezone as dj_timezone

from .models import ServiceAlert

# Change it in settings.py (MTA_ALERTS_URL) if the MTA moves the feed.
DEFAULT_ALERTS_URL = (
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json"
)

# Every subway line we show on the status dashboard.
SUBWAY_ROUTES = [
    "1", "2", "3", "4", "5", "6", "7",
    "A", "C", "E", "B", "D", "F", "M",
    "G", "J", "Z", "L", "N", "Q", "R", "W", "S",
]


def fetch_alerts_payload():
    """Download the raw JSON from the MTA (network call)."""
    url = getattr(settings, "MTA_ALERTS_URL", DEFAULT_ALERTS_URL)
    request = urllib.request.Request(url, headers={"User-Agent": "nyc-transit-class-project"})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def _text(block):
    """MTA text comes as {"translation": [{"text": ..., "language": "en"}]}; return the English one."""
    translations = (block or {}).get("translation") or []
    for item in translations:
        if str(item.get("language", "en")).startswith("en"):
            return item.get("text", "")
    return translations[0].get("text", "") if translations else ""


def _timestamp(value):
    """Seconds-since-1970 (int or str) -> datetime, or None if missing/invalid."""
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def parse_alerts(payload):
    """Turn the MTA's JSON into a simple list of dicts. Never crashes on missing fields."""
    alerts = []
    for entity in (payload or {}).get("entity", []):
        alert = entity.get("alert")
        if not alert:
            continue
        routes = sorted(
            {e["route_id"] for e in alert.get("informed_entity", []) if e.get("route_id")}
        )
        mercury = alert.get("transit_realtime.mercury_alert") or {}
        period = (alert.get("active_period") or [{}])[0]
        alerts.append(
            {
                "alert_id": str(entity.get("id", "")),
                "alert_type": mercury.get("alert_type", ""),
                "header": _text(alert.get("header_text")),
                "description": _text(alert.get("description_text")),
                "routes": ",".join(routes),
                "start_time": _timestamp(period.get("start")),
                "end_time": _timestamp(period.get("end")),
            }
        )
    return alerts


@transaction.atomic
def save_alerts(parsed):
    """Store alerts; remove any the MTA no longer lists. Returns how many are stored."""
    ids = []
    for item in parsed:
        if not item["alert_id"]:
            continue
        ids.append(item["alert_id"])
        ServiceAlert.objects.update_or_create(
            alert_id=item["alert_id"],
            defaults={k: v for k, v in item.items() if k != "alert_id"},
        )
    ServiceAlert.objects.exclude(alert_id__in=ids).delete()
    return len(ids)


def sync_alerts():
    """Download + parse + save. This is what refreshes our live data."""
    return save_alerts(parse_alerts(fetch_alerts_payload()))


def route_statuses():
    """What is happening on each line RIGHT NOW.

    {'A': {'status': 'Delays', 'alerts': 2, 'upcoming': 5}, 'Z': {'status': 'Good Service', ...}}
    - alerts   = alerts active right now
    - upcoming = planned work that has not started yet (shown separately, not as the status)
    """
    now = dj_timezone.now()
    result = {r: {"status": "Good Service", "alerts": 0, "upcoming": 0} for r in SUBWAY_ROUTES}
    for alert in ServiceAlert.objects.all():
        if alert.is_expired(now):
            continue
        label = alert.alert_type or "Service Change"
        for route in alert.route_list:
            entry = result.setdefault(
                route, {"status": "Good Service", "alerts": 0, "upcoming": 0}
            )
            if alert.is_upcoming(now):
                entry["upcoming"] += 1
                continue
            entry["alerts"] += 1
            # Unplanned problems (Delays...) outrank planned work in the headline status.
            if entry["alerts"] == 1 or (
                entry["status"].startswith("Planned") and not label.startswith("Planned")
            ):
                entry["status"] = label
    return result
