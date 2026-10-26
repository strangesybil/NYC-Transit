import time

from django.http import JsonResponse
from django.utils import timezone

from .mta import route_statuses, sync_alerts
from .models import ServiceAlert

CACHE_SECONDS = 60  # don't hit the MTA more than once a minute
_last_sync = 0.0


def _refresh_if_stale():
    """Refresh from the MTA if our data is older than a minute. Returns an error text or None."""
    global _last_sync
    if time.monotonic() - _last_sync < CACHE_SECONDS:
        return None
    try:
        sync_alerts()
        _last_sync = time.monotonic()
        return None
    except Exception as exc:  # network down, MTA changed format, etc.
        return f"Could not reach the MTA ({exc}); showing the last saved data."


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
