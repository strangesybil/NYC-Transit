import time

from django.http import JsonResponse
from django.utils import timezone

from .models import ServiceAlert
from .mta import route_statuses, sync_alerts

CACHE_SECONDS = 60  # contact the MTA at most once a minute (even when it is failing)
_last_attempt = None  # when we last TRIED to refresh (success or failure)
_last_warning = None  # the problem from that attempt, if any


def _refresh_if_stale():
    """Refresh from the MTA at most once a minute. Returns a warning text or None."""
    global _last_attempt, _last_warning
    if _last_attempt is not None and time.monotonic() - _last_attempt < CACHE_SECONDS:
        return _last_warning  # still inside the cooldown: no slow retry
    _last_attempt = time.monotonic()  # set BEFORE the call so failures also cool down
    try:
        sync_alerts()
        _last_warning = None
    except Exception as exc:  # network down, empty feed, MTA changed format, etc.
        saved = (
            "showing the last saved data"
            if ServiceAlert.objects.exists()
            else "no saved data is available yet"
        )
        _last_warning = f"Could not refresh from the MTA ({exc}); {saved}."
    return _last_warning


def alerts_api(request):
    """GET /api/alerts/   /api/alerts/?route=A   /api/alerts/?active=1 (only happening now)"""
    warning = _refresh_if_stale()
    alerts = ServiceAlert.objects.all()
    route = request.GET.get("route", "").strip().upper()
    only_active = request.GET.get("active", "") in ("1", "true", "yes")
    now = timezone.now()
    data = [
        {
            "id": a.alert_id,
            "type": a.alert_type,
            "header": a.header,
            "description": a.description,
            "routes": a.route_list,
            "active": a.is_active(now),
            "start": a.start_time,
            "end": a.end_time,
        }
        for a in alerts
        if (not route or route in a.route_list) and (not only_active or a.is_active(now))
    ]
    return JsonResponse({"count": len(data), "warning": warning, "alerts": data})


def status_api(request):
    """GET /api/status/  -> one status per subway line (feeds the dashboard in Task 5)."""
    warning = _refresh_if_stale()
    return JsonResponse({"warning": warning, "routes": route_statuses()})
