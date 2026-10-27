from datetime import datetime, timezone as dt_timezone

from django.conf import settings
from django.db import models
from django.utils import timezone


def _to_datetime(epoch):
    return datetime.fromtimestamp(epoch, tz=dt_timezone.utc) if epoch is not None else None


class ServiceAlert(models.Model):
    """One live service alert published by the MTA (delay, reroute, planned work...)."""

    alert_id = models.CharField(max_length=200, unique=True)  # the MTA's own id
    alert_type = models.CharField(max_length=100, blank=True)  # e.g. "Delays"
    header = models.TextField()  # short headline
    description = models.TextField(blank=True)  # longer explanation
    routes = models.CharField(max_length=200, blank=True)  # affected lines, e.g. "A,C,E"
    start_time = models.DateTimeField(null=True, blank=True)  # earliest start (for sorting)
    end_time = models.DateTimeField(null=True, blank=True)  # latest end (for display)
    # EVERY time window the alert applies to: [[start_epoch, end_epoch], ...]
    # (planned work often lists many nights/weekends). None = open ended.
    periods = models.JSONField(default=list, blank=True)
    fetched_at = models.DateTimeField(auto_now=True)  # when WE last saved it

    class Meta:
        ordering = ["-start_time", "alert_id"]

    def __str__(self):
        return f"[{self.routes}] {self.header[:60]}"

    @property
    def route_list(self):
        return [r for r in self.routes.split(",") if r]

    def _windows(self):
        """All (start, end) windows. Falls back to start_time/end_time for older saved rows."""
        if self.periods:
            return [(_to_datetime(s), _to_datetime(e)) for s, e in self.periods]
        if self.start_time or self.end_time:
            return [(self.start_time, self.end_time)]
        return []

    def is_active(self, now=None):
        """True while ANY of the alert's time windows is happening right now."""
        now = now or timezone.now()
        windows = self._windows()
        if not windows:
            return True  # no schedule given -> treat as in effect
        return any(
            (start is None or start <= now) and (end is None or end >= now)
            for start, end in windows
        )

    def is_upcoming(self, now=None):
        """Not happening now, but at least one window is still to come."""
        now = now or timezone.now()
        if self.is_active(now):
            return False
        return any(start is not None and start > now for start, _ in self._windows())

    def is_expired(self, now=None):
        """Every window is over."""
        now = now or timezone.now()
        return not self.is_active(now) and not self.is_upcoming(now)


class Favorite(models.Model):
    """A route or station a signed-in user saved (used by the Favorites feature)."""

    ROUTE = "route"
    STATION = "station"
    KIND_CHOICES = [(ROUTE, "Route"), (STATION, "Station")]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="favorites"
    )
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    name = models.CharField(max_length=100)  # "A" or "Times Sq-42 St"
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "kind", "name")

    def __str__(self):
        return f"{self.user} - {self.kind}: {self.name}"
